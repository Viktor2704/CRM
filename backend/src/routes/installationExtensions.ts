/**
 * Extended installation routes: procurement, stage deadlines, gating, chat pin.
 * Registered AFTER the base installation routes from installations.ts.
 */
import { randomUUID } from 'node:crypto';

export const registerInstallationExtensionRoutes = (params) => {
    const {
        app,
        requireAuth,
        asyncHandler,
        ensureInstallationExtendedSchema,
        ensureProjectSchema,
        ApiError,
        dbQuery,
        withTx,
        normalizeText,
        isUuidValue,
        parseUuidPath,
        randomUUID: genUUID,
        logger,
        serializeError,
        mapProjectRow,
        mapProjectEventRow,
        mapProjectChatMessageRow,
        insertProjectEventTx,
        sendProjectNotificationBestEffort,
        pushProjectInAppNotification,
        // roles
        projectCreateRoles,
        projectUpdateRoles,
        projectDeleteRoles,
        projectAdminRoles,
        projectOpsRoles,
        projectClientRoles,
        projectFilesEditRoles,
        projectChatWriteRoles,
        installationProcurementRoles,
        installationStageEditRoles,
        installationDeadlineEditRoles,
        // installation helpers
        installationStageSet,
        installationStageLabelMap,
        installationStageTransitionMap,
        installationDeadlineStageSet,
        installationCancelReasonSet,
        normalizeInstallationStage,
        assertInstallationStageTransition,
        normalizeProcurementItemStatus,
        resolveInstallationNotificationEventType,
        buildProcurementSummary,
        // schemas
        installationStageUpdateSchema,
        installationStageDeadlinesUpdateSchema,
        procurementItemCreateSchema,
        procurementItemUpdateSchema,
        chatMessagePinSchema,
        // mappers
        mapProcurementItemRow,
        mapStageDeadlineRow,
        appendProjectScopeCondition,
        projectSelectColumnsSql,
    } = params;

    const uuid = genUUID ?? randomUUID;

    // ── Helper: ensure schemas ──────────────────────────────────────
    const ensureSchemas = async () => {
        await ensureProjectSchema();
        await ensureInstallationExtendedSchema();
    };

    // ── Helper: load installation row ───────────────────────────────
    const loadInstallation = async (installationId: string, queryFn = dbQuery) => {
        const result = await queryFn(
            `SELECT ${projectSelectColumnsSql},
                    paused_from_stage, cancel_reason, cancel_comment, pause_reason,
                    coalesce(is_overdue, false) as is_overdue
             FROM requests r
             WHERE r.id = $1::uuid
               AND r.type = 'installation'
               AND r.is_project = false
               AND r.deleted_at IS NULL`,
            [installationId],
        );
        return result.rows[0] ?? null;
    };

    // ═══════════════════════════════════════════════════════════════
    //  GET /installations/:id/extended — full card with deadlines, procurement summary
    // ═══════════════════════════════════════���═══════════════════════
    app.get('/installations/:installationId/extended', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const installationId = parseUuidPath(request.params.installationId);
        const row = await loadInstallation(installationId);
        if (!row) throw new ApiError(404, 'NOT_FOUND', 'Installation not found');

        const mapped = mapProjectRow(row);

        // Stage deadlines
        const deadlinesResult = await dbQuery(
            `SELECT stage, due_date FROM installation_stage_deadlines WHERE installation_id = $1::uuid ORDER BY due_date`,
            [installationId],
        );
        const stageDeadlines: Record<string, string> = {};
        for (const dr of deadlinesResult.rows) {
            const mapped2 = mapStageDeadlineRow(dr);
            if (mapped2.stage) stageDeadlines[mapped2.stage] = mapped2.dueDate;
        }

        // Procurement summary
        const procResult = await dbQuery(
            `SELECT status FROM installation_procurement_items WHERE installation_id = $1::uuid`,
            [installationId],
        );
        const procurementSummary = buildProcurementSummary(procResult.rows);

        // Overdue stages
        const today = new Date().toISOString().slice(0, 10);
        const overdueStages: string[] = [];
        const terminalStatuses = new Set(['completed', 'cancelled']);
        if (!terminalStatuses.has(mapped.status)) {
            for (const [stage, dueDate] of Object.entries(stageDeadlines)) {
                if (dueDate < today) overdueStages.push(stage);
            }
        }

        // Counters
        const [eventsCount, chatCount, filesCount] = await Promise.all([
            dbQuery(`SELECT count(*)::int as c FROM project_events WHERE project_id = $1::uuid`, [installationId]),
            dbQuery(`SELECT count(*)::int as c FROM project_chat_messages WHERE project_id = $1::uuid AND deleted_at IS NULL`, [installationId]),
            Promise.resolve({ rows: [{ c: Array.isArray(row.files) ? row.files.length : 0 }] }),
        ]);

        response.status(200).json({
            ...mapped,
            stageDeadlines,
            procurementSummary,
            pausedFromStage: normalizeText(row.paused_from_stage) || null,
            isOverdue: row.is_overdue === true || overdueStages.length > 0,
            overdueStages,
            counters: {
                events: Number(eventsCount.rows[0]?.c ?? 0),
                chatMessages: Number(chatCount.rows[0]?.c ?? 0),
                procurementItems: procurementSummary.total,
                files: Number(filesCount.rows[0]?.c ?? 0),
            },
        });
    }));

    // ═══════════════════════════════════════════════════════════════
    //  PATCH /installations/:id/installation-stage — extended stage change with gating
    // ═══════════════════════════════════════════════════════════════
    app.patch('/installations/:installationId/installation-stage', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const actorRole = request.authUser?.role ?? '';
        const actorId = request.authUser?.id ?? '';
        if (!installationStageEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав для смены статуса');
        }

        const installationId = parseUuidPath(request.params.installationId);
        const body = installationStageUpdateSchema.parse(request.body);
        const nextStage = normalizeInstallationStage(body.stage);

        const row = await loadInstallation(installationId);
        if (!row) throw new ApiError(404, 'NOT_FOUND', 'Installation not found');

        const currentStage = normalizeText(row.status) || 'new';
        assertInstallationStageTransition(currentStage, nextStage);

        // ── Gating: procurement → in_progress ──
        if (currentStage === 'procurement' && nextStage === 'in_progress') {
            const procResult = await dbQuery(
                `SELECT status FROM installation_procurement_items WHERE installation_id = $1::uuid`,
                [installationId],
            );
            const summary = buildProcurementSummary(procResult.rows);
            if (!summary.allReceived && summary.total > 0) {
                if (!body.overrideReason || body.overrideReason.trim().length < 10) {
                    throw new ApiError(422, 'PROCUREMENT_NOT_COMPLETE',
                        'Не все позиции закупки получены. Укажите overrideReason (мин. 10 символов) для обхода.');
                }
            }
        }

        // ── Gating: → cancelled ──
        if (nextStage === 'cancelled') {
            if (!body.cancelReason) {
                throw new ApiError(422, 'CANCEL_REASON_REQUIRED', 'Укажите причину отмены (cancelReason)');
            }
            if (!installationCancelReasonSet.has(body.cancelReason)) {
                throw new ApiError(422, 'VALIDATION_ERROR', `Недопустимая причина отмены: ${body.cancelReason}`);
            }
        }

        // ── Gating: → paused ──
        if (nextStage === 'paused') {
            if (!body.pauseReason || body.pauseReason.trim().length < 5) {
                throw new ApiError(422, 'PAUSE_REASON_REQUIRED', 'Укажите причину паузы (мин. 5 символов)');
            }
        }

        // ── Gating: → completed (checklist) ──
        if (nextStage === 'completed') {
            const files = Array.isArray(row.files) ? row.files : [];
            if (files.length === 0) {
                throw new ApiError(422, 'COMPLETION_CHECKLIST', 'Для завершения необходимо прикрепить хотя бы 1 файл');
            }
        }

        // ── Apply transition ──
        await withTx(async (tx) => {
            const updates: string[] = [`status = $2::text`, `updated_at = now()`];
            const values: any[] = [installationId, nextStage];

            if (nextStage === 'paused') {
                values.push(currentStage, body.pauseReason);
                updates.push(`paused_from_stage = $${values.length - 1}::text`);
                updates.push(`pause_reason = $${values.length}::text`);
            } else if (nextStage === 'cancelled') {
                values.push(body.cancelReason || '', body.cancelComment || '');
                updates.push(`cancel_reason = $${values.length - 1}::text`);
                updates.push(`cancel_comment = $${values.length}::text`);
            } else if (currentStage === 'paused') {
                // Resuming — clear pause fields
                updates.push(`paused_from_stage = null`, `pause_reason = null`);
            }

            await tx.query(`UPDATE requests SET ${updates.join(', ')} WHERE id = $1::uuid`, values);

            // Event
            const eventPayload: any = {
                fromStage: currentStage,
                toStage: nextStage,
                fromLabel: installationStageLabelMap[currentStage] || currentStage,
                toLabel: installationStageLabelMap[nextStage] || nextStage,
            };
            if (body.reason) eventPayload.reason = body.reason;
            if (body.overrideReason) eventPayload.overrideReason = body.overrideReason;
            if (body.cancelReason) eventPayload.cancelReason = body.cancelReason;
            if (body.cancelComment) eventPayload.cancelComment = body.cancelComment;
            if (body.pauseReason) eventPayload.pauseReason = body.pauseReason;

            const severity = body.overrideReason ? 'warning' : 'info';

            await insertProjectEventTx({
                client: tx,
                projectId: installationId,
                eventType: 'installation_stage_changed',
                severity,
                actorUserId: actorId,
                payload: eventPayload,
            });

            // System chat message
            const fromLabel = installationStageLabelMap[currentStage] || currentStage;
            const toLabel = installationStageLabelMap[nextStage] || nextStage;
            let systemMsg = `Статус изменён: ${fromLabel} → ${toLabel}`;
            if (body.reason) systemMsg += `. Причина: ${body.reason}`;
            if (body.overrideReason) systemMsg += `. Override: ${body.overrideReason}`;
            if (body.pauseReason) systemMsg += `. Причина паузы: ${body.pauseReason}`;
            if (body.cancelComment) systemMsg += `. Комментарий: ${body.cancelComment}`;

            await tx.query(
                `INSERT INTO project_chat_messages (id, project_id, author_id, visibility, text, created_at)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, 'client-visible', $4, now())`,
                [uuid(), installationId, actorId || null, systemMsg],
            );
        });

        // Auto-create СППЗ journal entry on completion
        if (nextStage === 'completed') {
            try {
                const instRow = await loadInstallation(installationId);
                const sppzId = uuid();
                const nowIso = new Date().toISOString();
                await dbQuery(
                    `INSERT INTO sppz_journal_entries
                     (id, direction_id, contractor_id, object_key, event_datetime, entry_timestamp, status,
                      section, record_type, entry_data, created_by, text_created_by_id)
                     VALUES ($1, $2, $3, $4, $5, $5, 'draft', 'installation', 'completion',
                             $6::jsonb, $7, $8)
                     ON CONFLICT DO NOTHING`,
                    [
                        sppzId,
                        instRow?.direction_id || null,
                        instRow?.tenant_id || null,
                        normalizeText(instRow?.title || ''),
                        nowIso,
                        JSON.stringify({
                            objectName: normalizeText(instRow?.title || ''),
                            description: `Монтаж завершён: ${normalizeText(instRow?.title || '')}`,
                            executorName: actorId,
                            installationId,
                        }),
                        actorId || null,
                        actorId || null,
                    ],
                );
                logger.info('SPPZ journal entry auto-created for completed installation', { installationId, sppzId });
            } catch (err) {
                logger.error('Failed to auto-create SPPZ journal entry', { error: serializeError(err), installationId });
            }
        }

        // Notification (best effort)
        try {
            const eventType = resolveInstallationNotificationEventType(nextStage);
            await sendProjectNotificationBestEffort({
                request,
                projectId: installationId,
                eventType,
                actorUserId: actorId,
                meta: { stage: nextStage, fromStage: currentStage },
            });
        } catch (err) {
            logger.error('Installation stage notification failed', { error: serializeError(err) });
        }

        const updated = await loadInstallation(installationId);
        response.status(200).json({
            ...mapProjectRow(updated),
            stageTransition: { from: currentStage, to: nextStage },
        });
    }));

    // ═══════════════════════════════════════════════════════════════
    //  GET/PUT /installations/:id/stage-deadlines
    // ═══════════════════════════════════════════════════════════════
    app.get('/installations/:installationId/stage-deadlines', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const installationId = parseUuidPath(request.params.installationId);
        const result = await dbQuery(
            `SELECT stage, due_date FROM installation_stage_deadlines WHERE installation_id = $1::uuid ORDER BY due_date`,
            [installationId],
        );
        const deadlines = result.rows.map(mapStageDeadlineRow);
        response.status(200).json({
            items: deadlines,
            deadlines,
        });
    }));

    app.put('/installations/:installationId/stage-deadlines', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const actorRole = request.authUser?.role ?? '';
        const actorId = request.authUser?.id ?? '';
        if (!installationDeadlineEditRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав для изменения дедлайнов');
        }

        const installationId = parseUuidPath(request.params.installationId);
        const body = installationStageDeadlinesUpdateSchema.parse(request.body);

        // Validate stages
        for (const d of body.deadlines) {
            if (!installationDeadlineStageSet.has(d.stage)) {
                throw new ApiError(422, 'VALIDATION_ERROR', `Недопустимый этап для дедлайна: ${d.stage}`);
            }
        }

        // Load old deadlines for history
        const oldResult = await dbQuery(
            `SELECT stage, due_date FROM installation_stage_deadlines WHERE installation_id = $1::uuid`,
            [installationId],
        );
        const oldMap: Record<string, string> = {};
        for (const r of oldResult.rows) {
            oldMap[normalizeText(r.stage)] = r.due_date instanceof Date
                ? r.due_date.toISOString().slice(0, 10)
                : String(r.due_date).slice(0, 10);
        }

        await withTx(async (tx) => {
            for (const d of body.deadlines) {
                await tx.query(
                    `INSERT INTO installation_stage_deadlines (installation_id, stage, due_date, updated_at)
                     VALUES ($1::uuid, $2, $3::date, now())
                     ON CONFLICT (installation_id, stage)
                     DO UPDATE SET due_date = $3::date, updated_at = now()`,
                    [installationId, d.stage, d.dueDate],
                );
            }

            // Event for each changed deadline
            for (const d of body.deadlines) {
                const oldDate = oldMap[d.stage] || null;
                if (oldDate === d.dueDate) continue;

                await insertProjectEventTx({
                    client: tx,
                    projectId: installationId,
                    eventType: 'installation_deadline_changed',
                    severity: 'info',
                    actorUserId: actorId,
                    payload: {
                        stage: d.stage,
                        oldDate,
                        newDate: d.dueDate,
                        reason: body.reason,
                    },
                });

                // System chat message
                const stageLabel = installationStageLabelMap[d.stage] || d.stage;
                const msg = oldDate
                    ? `Дедлайн этапа «${stageLabel}» изменён: ${oldDate} → ${d.dueDate}. Причина: ${body.reason}`
                    : `Установлен дедлайн этапа «${stageLabel}��: ${d.dueDate}. Причина: ${body.reason}`;

                await tx.query(
                    `INSERT INTO project_chat_messages (id, project_id, author_id, visibility, text, created_at)
                     VALUES ($1::uuid, $2::uuid, $3::uuid, 'client-visible', $4, now())`,
                    [uuid(), installationId, actorId || null, msg],
                );
            }

            await tx.query(`UPDATE requests SET updated_at = now() WHERE id = $1::uuid`, [installationId]);
        });

        // Notification
        try {
            await sendProjectNotificationBestEffort({
                request,
                projectId: installationId,
                eventType: 'installation_deadline_changed',
                actorUserId: actorId,
                meta: { deadlines: body.deadlines, reason: body.reason },
            });
        } catch (err) {
            logger.error('Installation deadline notification failed', { error: serializeError(err) });
        }

        const result = await dbQuery(
            `SELECT stage, due_date FROM installation_stage_deadlines WHERE installation_id = $1::uuid ORDER BY due_date`,
            [installationId],
        );
        response.status(200).json({
            deadlines: result.rows.map(mapStageDeadlineRow),
        });
    }));

    // ═══════════════════════════════════════════════════════════════
    //  CRUD /installations/:id/procurement
    // ═══════════════════════════════════════════════════════════════
    app.get('/installations/:installationId/procurement', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const installationId = parseUuidPath(request.params.installationId);
        const result = await dbQuery(
            `SELECT * FROM installation_procurement_items
             WHERE installation_id = $1::uuid
             ORDER BY created_at ASC`,
            [installationId],
        );
        const items = result.rows.map(mapProcurementItemRow);
        const summary = buildProcurementSummary(result.rows);
        response.status(200).json({ items, summary });
    }));

    app.post('/installations/:installationId/procurement', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const actorRole = request.authUser?.role ?? '';
        const actorId = request.authUser?.id ?? '';
        if (!installationProcurementRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав для управления закупкой');
        }

        const installationId = parseUuidPath(request.params.installationId);
        const body = procurementItemCreateSchema.parse(request.body);

        const id = uuid();
        await dbQuery(
            `INSERT INTO installation_procurement_items
             (id, installation_id, name, quantity, unit, comment, link, responsible_user_id, files, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), now())`,
            [
                id, installationId, body.name, body.quantity, body.unit,
                body.comment, body.link,
                body.responsibleUserId || null,
                JSON.stringify(body.files),
            ],
        );

        // Event
        await withTx(async (tx) => {
            await insertProjectEventTx({
                client: tx,
                projectId: installationId,
                eventType: 'installation_procurement_changed',
                severity: 'info',
                actorUserId: actorId,
                payload: { action: 'added', itemId: id, name: body.name, quantity: body.quantity },
            });
            await tx.query(`UPDATE requests SET updated_at = now() WHERE id = $1::uuid`, [installationId]);
        });

        const row = await dbQuery(`SELECT * FROM installation_procurement_items WHERE id = $1::uuid`, [id]);
        response.status(201).json(mapProcurementItemRow(row.rows[0]));
    }));

    app.patch('/installations/:installationId/procurement/:itemId', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const actorRole = request.authUser?.role ?? '';
        const actorId = request.authUser?.id ?? '';
        if (!installationProcurementRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав для управления закупкой');
        }

        const installationId = parseUuidPath(request.params.installationId);
        const itemId = parseUuidPath(request.params.itemId);
        const body = procurementItemUpdateSchema.parse(request.body);

        // Check item exists
        const existing = await dbQuery(
            `SELECT * FROM installation_procurement_items WHERE id = $1::uuid AND installation_id = $2::uuid`,
            [itemId, installationId],
        );
        if (existing.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Позиция закупки не найдена');
        }

        const sets: string[] = ['updated_at = now()'];
        const vals: any[] = [itemId];
        let idx = 2;

        if (body.name !== undefined) { vals.push(body.name); sets.push(`name = $${idx++}`); }
        if (body.quantity !== undefined) { vals.push(body.quantity); sets.push(`quantity = $${idx++}`); }
        if (body.unit !== undefined) { vals.push(body.unit); sets.push(`unit = $${idx++}`); }
        if (body.comment !== undefined) { vals.push(body.comment); sets.push(`comment = $${idx++}`); }
        if (body.link !== undefined) { vals.push(body.link); sets.push(`link = $${idx++}`); }
        if (body.responsibleUserId !== undefined) { vals.push(body.responsibleUserId || null); sets.push(`responsible_user_id = $${idx++}`); }
        if (body.files !== undefined) { vals.push(JSON.stringify(body.files)); sets.push(`files = $${idx++}::jsonb`); }
        if (body.status !== undefined) {
            const normalizedStatus = normalizeProcurementItemStatus(body.status);
            vals.push(normalizedStatus);
            sets.push(`status = $${idx++}`);
        }

        await dbQuery(`UPDATE installation_procurement_items SET ${sets.join(', ')} WHERE id = $1::uuid`, vals);

        // Event
        await withTx(async (tx) => {
            await insertProjectEventTx({
                client: tx,
                projectId: installationId,
                eventType: 'installation_procurement_changed',
                severity: 'info',
                actorUserId: actorId,
                payload: { action: 'updated', itemId, changes: body },
            });
            await tx.query(`UPDATE requests SET updated_at = now() WHERE id = $1::uuid`, [installationId]);
        });

        // Check if all received → notify
        if (body.status === 'received') {
            const allResult = await dbQuery(
                `SELECT status FROM installation_procurement_items WHERE installation_id = $1::uuid`,
                [installationId],
            );
            const summary = buildProcurementSummary(allResult.rows);
            if (summary.allReceived) {
                // System chat message
                await dbQuery(
                    `INSERT INTO project_chat_messages (id, project_id, author_id, visibility, text, created_at)
                     VALUES ($1::uuid, $2::uuid, $3::uuid, 'client-visible', 'Закупка: все позиции получены', now())`,
                    [uuid(), installationId, actorId || null],
                );

                try {
                    await pushProjectInAppNotification({
                        projectId: installationId,
                        eventType: 'installation_procurement_completed',
                        title: 'Закупка завершена',
                        body: 'Все позиции закупки получены. Можно переводить в работу.',
                    });
                } catch (err) {
                    logger.error('Procurement completion notification failed', { error: serializeError(err) });
                }
            }
        }

        const row = await dbQuery(`SELECT * FROM installation_procurement_items WHERE id = $1::uuid`, [itemId]);
        response.status(200).json(mapProcurementItemRow(row.rows[0]));
    }));

    app.delete('/installations/:installationId/procurement/:itemId', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const actorRole = request.authUser?.role ?? '';
        const actorId = request.authUser?.id ?? '';
        if (!installationProcurementRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав для управления закупкой');
        }

        const installationId = parseUuidPath(request.params.installationId);
        const itemId = parseUuidPath(request.params.itemId);

        const existing = await dbQuery(
            `SELECT name FROM installation_procurement_items WHERE id = $1::uuid AND installation_id = $2::uuid`,
            [itemId, installationId],
        );
        if (existing.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Позиция закупки не найдена');
        }

        await dbQuery(`DELETE FROM installation_procurement_items WHERE id = $1::uuid`, [itemId]);

        await withTx(async (tx) => {
            await insertProjectEventTx({
                client: tx,
                projectId: installationId,
                eventType: 'installation_procurement_changed',
                severity: 'info',
                actorUserId: actorId,
                payload: { action: 'deleted', itemId, name: normalizeText(existing.rows[0]?.name) },
            });
            await tx.query(`UPDATE requests SET updated_at = now() WHERE id = $1::uuid`, [installationId]);
        });

        response.status(204).end();
    }));

    // ═══════════════════════════════════════════════════════════════
    //  PATCH /installations/:id/chat/messages/:messageId/pin
    // ═══════════════════════════════════════════════════════════════
    app.patch('/installations/:installationId/chat/messages/:messageId/pin', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const actorRole = request.authUser?.role ?? '';
        if (!projectChatWriteRoles.has(actorRole)) {
            throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав');
        }

        const installationId = parseUuidPath(request.params.installationId);
        const messageId = parseUuidPath(request.params.messageId);
        const body = chatMessagePinSchema.parse(request.body);

        const result = await dbQuery(
            `UPDATE project_chat_messages
             SET is_pinned = $3, edited_at = now()
             WHERE id = $1::uuid AND project_id = $2::uuid AND deleted_at IS NULL
             RETURNING *`,
            [messageId, installationId, body.pinned],
        );

        if (result.rows.length === 0) {
            throw new ApiError(404, 'NOT_FOUND', 'Сообщение не найдено');
        }

        response.status(200).json(mapProjectChatMessageRow(result.rows[0]));
    }));

    // ═══════════════════════════════════════════════════════════════
    //  GET /installations/:id/chat/pinned — pinned messages
    // ═══════════════════════════════════════════════════════════════
    app.get('/installations/:installationId/chat/pinned', requireAuth, asyncHandler(async (request, response) => {
        await ensureSchemas();
        const installationId = parseUuidPath(request.params.installationId);
        const result = await dbQuery(
            `SELECT * FROM project_chat_messages
             WHERE project_id = $1::uuid AND is_pinned = true AND deleted_at IS NULL
             ORDER BY created_at DESC`,
            [installationId],
        );
        response.status(200).json({
            items: result.rows.map(mapProjectChatMessageRow),
        });
    }));
};
