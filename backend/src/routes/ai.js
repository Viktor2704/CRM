import { extractTextFromFiles } from '../helpers/textExtractor.js';
import { logger } from '../logger.js';
const AI_INPUT_MAX_LENGTH = 2000;
const assertAiInputTextLength = (value, fieldName, ApiError) => {
    if (typeof value !== 'string') {
        return;
    }
    if (value.trim().length > AI_INPUT_MAX_LENGTH) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} must be at most ${AI_INPUT_MAX_LENGTH} characters`);
    }
};
export const registerMockAiRoutes = (params) => {
    const { app, requireAuth, ApiError, normalizeText, localMockUsers, localMockServiceRequests, localMockNotifications, getLocalMockBodyObject, emptyAiSuggestionResponse, buildAiSuggestionResponse, } = params;
    app.post('/ai/suggest-request-fields', requireAuth, (request, response) => {
        const body = getLocalMockBodyObject(request.body);
        assertAiInputTextLength(body.description, 'description', ApiError);
        const description = normalizeText(body.description).toLowerCase();
        if (!description) {
            response.status(200).json({
                ...emptyAiSuggestionResponse(),
                _meta: { source: 'none', provider: 'mock' },
            });
            return;
        }
        let type = '';
        let systemType = '';
        let priority = '';
        let typeConfidence = 'medium';
        let systemConfidence = 'medium';
        let priorityConfidence = 'medium';
        if (/(пожар|дым|горит|авар|затоп|угроз)/i.test(description)) {
            type = 'emergency';
            priority = 'critical';
            typeConfidence = 'high';
            priorityConfidence = 'high';
        }
        else if (/(осмотр|планов|то |техобслуж|регламент|ппр)/i.test(description)) {
            type = 'maintenance_planned';
            priority = 'low';
            typeConfidence = 'high';
            priorityConfidence = 'medium';
        }
        else if (/(не работает|полом|ошибк|отказ|сбой|камера|датчик)/i.test(description)) {
            type = 'operation';
            priority = 'medium';
            typeConfidence = 'high';
        }
        else {
            type = 'general';
            priority = 'medium';
            typeConfidence = 'low';
            priorityConfidence = 'low';
        }
        if (/(камера|видео|регистратор|наблюден)/i.test(description)) {
            systemType = 'svn';
            systemConfidence = 'high';
        }
        else if (/(доступ|турникет|домофон|карта|замок)/i.test(description)) {
            systemType = 'skud';
            systemConfidence = 'high';
        }
        else if (/(пожар|дым|извещател|апс)/i.test(description)) {
            systemType = 'aps';
            systemConfidence = 'high';
        }
        else if (/(соуэ|оповещ|эвакуац|сирен)/i.test(description)) {
            systemType = 'soue';
            systemConfidence = 'high';
        }
        else if (/(пожаротуш|аупт|спринклер|дренчер)/i.test(description)) {
            systemType = 'aupt';
            systemConfidence = 'high';
        }
        else if (/(водопровод|впв|гидрант|кран)/i.test(description)) {
            systemType = 'vpv';
            systemConfidence = 'medium';
        }
        else if (/(огнетуш)/i.test(description)) {
            systemType = 'fireExtinguishers';
            systemConfidence = 'medium';
        }
        else if (/(табло|выход|аварийн)/i.test(description)) {
            systemType = 'exitSigns';
            systemConfidence = 'medium';
        }
        else if (/(газ|баллон)/i.test(description)) {
            systemType = 'gas';
            systemConfidence = 'medium';
        }
        else if (/(кабель|скс|патч|розетк)/i.test(description)) {
            systemType = 'sks';
            systemConfidence = 'medium';
        }
        else if (/(асу|scada|контроллер)/i.test(description)) {
            systemType = 'asutp';
            systemConfidence = 'medium';
        }
        else if (/(охран|сотс|периметр)/i.test(description)) {
            systemType = 'sots';
            systemConfidence = 'medium';
        }
        response.status(200).json({
            ...buildAiSuggestionResponse({
                type,
                systemType,
                priority,
                typeConfidence,
                systemConfidence,
                priorityConfidence,
            }),
            _meta: { source: 'rules', provider: 'mock' },
        });
    });
    app.post('/ai/suggest-executor', requireAuth, (request, response) => {
        const body = getLocalMockBodyObject(request.body);
        assertAiInputTextLength(body.title, 'title', ApiError);
        assertAiInputTextLength(body.description, 'description', ApiError);
        const title = normalizeText(body.title).toLowerCase();
        const description = normalizeText(body.description).toLowerCase();
        const systemType = normalizeText(body.systemType).toLowerCase();
        const directionId = normalizeText(body.directionId);
        if (!title || !description) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'title и description обязательны');
        }
        const executors = Array.isArray(localMockUsers)
            ? localMockUsers.filter((user) => normalizeText(user?.role) === 'executor' && normalizeText(user?.status) !== 'blocked')
            : [];
        if (executors.length === 0) {
            response.status(200).json({
                executorId: null,
                executorName: null,
                reason: 'Нет активных исполнителей.',
                _meta: { source: 'none', provider: 'mock' },
            });
            return;
        }
        const scored = executors
            .map((user) => {
            const fullName = normalizeText(user?.fullName).toLowerCase();
            let score = 0;
            if (/(пожар|дым|апс|соуэ|огнетуш|аупт)/i.test(`${title} ${description} ${systemType}`) && /(пожар|апс|соуэ)/i.test(fullName)) {
                score += 3;
            }
            if (/(камера|видео|свн)/i.test(`${title} ${description} ${systemType}`) && /(видео|свн|камер)/i.test(fullName)) {
                score += 3;
            }
            if (/(доступ|скуд|турникет|домофон)/i.test(`${title} ${description} ${systemType}`) && /(скуд|доступ|турникет)/i.test(fullName)) {
                score += 3;
            }
            if (directionId && normalizeText(user?.directionId) === directionId) {
                score += 2;
            }
            return {
                id: normalizeText(user?.id),
                name: normalizeText(user?.fullName) || normalizeText(user?.email) || normalizeText(user?.id),
                score,
            };
        })
            .filter((entry) => entry.id)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));
        const selected = scored[0];
        if (!selected) {
            response.status(200).json({
                executorId: null,
                executorName: null,
                reason: 'Нет подходящих исполнителей.',
                _meta: { source: 'none', provider: 'mock' },
            });
            return;
        }
        response.status(200).json({
            executorId: selected.id,
            executorName: selected.name,
            reason: selected.score > 0
                ? 'Подобран по совпадению с типом системы и текстом заявки.'
                : 'Подобран первый доступный исполнитель.',
            _meta: { source: 'rules', provider: 'mock' },
        });
    });
    app.post('/ai/summarize-chat', requireAuth, (request, response) => {
        const body = getLocalMockBodyObject(request.body);
        const projectId = normalizeText(body.projectId);
        if (!projectId) {
            response.status(200).json({
                summary: null,
                _meta: { source: 'none', provider: 'mock' },
            });
            return;
        }
        const summaryLines = localMockServiceRequests.slice(0, 5).map((item, index) => `${index + 1}. ${normalizeText(item.title) || 'Заявка'} — статус ${normalizeText(item.status) || 'new'}`);
        response.status(200).json({
            summary: summaryLines.length > 0 ? summaryLines.join('\n') : null,
            _meta: { source: 'rules', provider: 'mock' },
        });
    });
    app.post('/ai/summarize-notifications', requireAuth, (request, response) => {
        const userId = normalizeText(request.authUser?.id);
        const unread = localMockNotifications.filter((item) => item.userId === userId && item.isRead !== true).slice(0, 50);
        if (unread.length === 0) {
            response.status(200).json({
                summary: null,
                groups: [],
                _meta: { source: 'none', provider: 'mock' },
            });
            return;
        }
        const grouped = unread.reduce((accumulator, item) => {
            const key = normalizeText(item.eventType) || 'other';
            if (!accumulator[key]) {
                accumulator[key] = {
                    label: key,
                    count: 0,
                    ids: [],
                };
            }
            accumulator[key].count += 1;
            accumulator[key].ids.push(normalizeText(item.id));
            return accumulator;
        }, {});
        const groups = Object.values(grouped).slice(0, 7);
        const summary = groups.map((group, index) => `${index + 1}. ${group.label}: ${group.count}`).join('\n');
        response.status(200).json({
            summary,
            groups,
            _meta: { source: 'rules', provider: 'mock' },
        });
    });
    app.post('/ai/similar-requests', requireAuth, (request, response) => {
        const body = getLocalMockBodyObject(request.body);
        assertAiInputTextLength(body.title, 'title', ApiError);
        assertAiInputTextLength(body.description, 'description', ApiError);
        const title = normalizeText(body.title).toLowerCase();
        const description = normalizeText(body.description).toLowerCase();
        const systemType = normalizeText(body.systemType);
        if (!title && !description) {
            response.status(200).json({
                suggestions: [],
                _meta: { source: 'none', provider: 'mock' },
            });
            return;
        }
        const tokens = new Set(`${title} ${description}`.split(/\s+/).map((token) => token.trim()).filter((token) => token.length > 2));
        const candidates = localMockServiceRequests
            .filter((item) => {
            if (systemType && normalizeText(item.systemType) && normalizeText(item.systemType) !== systemType) {
                return false;
            }
            return ['done', 'closed', 'assigned', 'in_progress'].includes(normalizeText(item.status).toLowerCase());
        })
            .map((item) => {
            const text = `${normalizeText(item.title)} ${normalizeText(item.description)}`.toLowerCase();
            let overlap = 0;
            for (const token of tokens) {
                if (text.includes(token)) {
                    overlap += 1;
                }
            }
            return { item, overlap };
        })
            .filter((entry) => entry.overlap > 0)
            .sort((a, b) => b.overlap - a.overlap)
            .slice(0, 3)
            .map((entry) => ({
            requestId: normalizeText(entry.item.id),
            title: normalizeText(entry.item.title) || 'Заявка',
            resolution: normalizeText(entry.item?.resolution?.text) || normalizeText(entry.item.description) || 'Решение не указано',
            similarity: entry.overlap >= 3 ? 'high' : entry.overlap === 2 ? 'medium' : 'low',
        }));
        response.status(200).json({
            suggestions: candidates,
            _meta: { source: 'rules', provider: 'mock' },
        });
    });
    app.post('/ai/generate-installation', requireAuth, (_request, response) => {
        response.status(200).json({
            plan: 'AI недоступен в тестовом режиме. Переключитесь на реальный бэкенд.',
            _meta: { source: 'none', provider: 'mock' },
        });
    });
    app.post('/ai/expand-search', requireAuth, (request, response) => {
        const body = getLocalMockBodyObject(request.body);
        const query = normalizeText(body.query).toLowerCase();
        if (!query) {
            response.status(200).json({
                expandedTerms: [],
                systemTypes: [],
                originalQuery: '',
                _meta: { source: 'none', provider: 'mock' },
            });
            return;
        }
        const expandedTerms = new Set();
        const systemTypes = new Set();
        if (/(пожар|пожарка|дым|извещ)/i.test(query)) {
            ['АПС', 'АУПТ', 'пожарная сигнализация', 'пожаротушение', 'датчик дыма'].forEach((term) => expandedTerms.add(term));
            systemTypes.add('aps');
            systemTypes.add('aupt');
        }
        if (/(камера|видео|регистратор|наблюден)/i.test(query)) {
            ['СВН', 'видеонаблюдение', 'камера'].forEach((term) => expandedTerms.add(term));
            systemTypes.add('svn');
        }
        if (/(доступ|турникет|домофон|замок)/i.test(query)) {
            ['СКУД', 'контроль доступа', 'турникет'].forEach((term) => expandedTerms.add(term));
            systemTypes.add('skud');
        }
        if (expandedTerms.size === 0) {
            const words = query.split(/\s+/).filter((value) => value.length > 2).slice(0, 6);
            words.forEach((word) => expandedTerms.add(word));
        }
        response.status(200).json({
            expandedTerms: Array.from(expandedTerms),
            systemTypes: Array.from(systemTypes),
            originalQuery: normalizeText(body.query),
            _meta: { source: 'rules', provider: 'mock' },
        });
    });
};
export const registerAiRoutes = (params) => {
    const { app, requireAuth, asyncHandler, ensureProjectSchema, ensureNotificationSchema, ApiError, dbQuery, normalizeText, isUuidValue, parseUuidPath, callLLM, callLLMWithFallback, aiChatSummarySystemPrompt, aiNotificationSummarySystemPrompt, aiExpandSearchSystemPrompt, aiChatSystemPrompt, parseAiJson, normalizeAiSystemType, aiSystemTypeValues, ensureActorHasProjectAccess, ensureAiFeedbackSchema, } = params;
    app.post('/ai/suggest-request-fields', requireAuth, asyncHandler(async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const description = normalizeText(body.description);
        const files = Array.isArray(body.files) ? body.files : [];
        // Extract text from attached files
        let filesText = '';
        if (files.length > 0) {
            const fileEntries = files.slice(0, 5).map((f) => {
                if (!f || typeof f !== 'object')
                    return null;
                // Derive storageKey from url: /uploads/2026/02/uuid-name.pdf -> 2026/02/uuid-name.pdf
                const url = normalizeText(f.url);
                const name = normalizeText(f.name);
                if (!url)
                    return null;
                const uploadsIdx = url.indexOf('/uploads/');
                const storageKey = uploadsIdx >= 0 ? url.slice(uploadsIdx + '/uploads/'.length) : '';
                if (!storageKey)
                    return null;
                // Determine mime from file extension
                const ext = (name || url).split('.').pop()?.toLowerCase() || '';
                const mimeMap = {
                    pdf: 'application/pdf',
                    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    doc: 'application/msword',
                    txt: 'text/plain',
                    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    xls: 'application/vnd.ms-excel',
                };
                const mimeType = mimeMap[ext] || '';
                if (!mimeType)
                    return null;
                return { storage_key: storageKey, mime_type: mimeType };
            }).filter(Boolean);
            if (fileEntries.length > 0) {
                filesText = await extractTextFromFiles(fileEntries);
            }
        }
        const combinedText = [description, filesText].filter(Boolean).join('\n\n');
        if (!combinedText || combinedText.trim().length < 3) {
            response.status(200).json({
                type: null, systemType: null, priority: null,
                _meta: { source: 'none', provider: 'none' },
            });
            return;
        }
        const systemPrompt = `Ты - ассистент системы обслуживания Новинжстрой.
Определи по описанию заявки и приложенным документам поля:
1) type: emergency|operation|maintenance_planned|general
2) systemType: aps|soue|aupt|vpv|fireExtinguishers|exitSigns|gas|skud|sks|svn|asutp|sots
3) priority: critical|high|medium|low

Верни только JSON без markdown:
{"type":"...","systemType":"...","priority":"...","typeConfidence":"high|medium|low","systemConfidence":"high|medium|low","priorityConfidence":"high|medium|low"}
Если поле не удалось определить, верни null.
/no_think`;
        const result = await callLLMWithFallback(systemPrompt, combinedText.slice(0, 6000), {
            maxTokens: 2048,
            temperature: 0.2,
        });
        if (!result.content) {
            response.status(200).json({
                type: null, systemType: null, priority: null,
                _meta: { source: result.source, provider: result.provider, error: result.error },
            });
            return;
        }
        const parsed = parseAiJson(result.content);
        const parsedObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        const { buildAiSuggestionResponse } = await import('../helpers/aiConstants.js');
        response.status(200).json({
            ...buildAiSuggestionResponse(parsedObject),
            _meta: { source: result.source, provider: result.provider },
        });
    }));
    app.post('/ai/chat', requireAuth, asyncHandler(async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (messages.length === 0) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'messages обязателен');
        }
        // Validate messages format
        const validMessages = messages
            .filter((m) => m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && normalizeText(m.content))
            .slice(-20) // last 20 messages max
            .map((m) => ({ role: m.role, content: normalizeText(m.content) }));
        if (validMessages.length === 0 || validMessages[validMessages.length - 1].role !== 'user') {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Последнее сообщение должно быть от пользователя');
        }
        const userQuery = validMessages[validMessages.length - 1].content;
        // Gather context from DB
        let contextBlock = '';
        try {
            const [reqStats, projStats, recentReqs, directionsData, itemsData, tenantsData, executorsData] = await Promise.all([
                dbQuery(`SELECT status, count(*)::int as cnt FROM requests WHERE type='service_request' AND deleted_at IS NULL GROUP BY status ORDER BY cnt DESC LIMIT 10`),
                dbQuery(`SELECT status, count(*)::int as cnt FROM requests WHERE type IN ('project','installation') AND deleted_at IS NULL GROUP BY status ORDER BY cnt DESC LIMIT 10`),
                dbQuery(`SELECT id::text, title, status, priority, created_at FROM requests WHERE type='service_request' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`),
                dbQuery(`SELECT d.id::text, d.name FROM directions d ORDER BY d.name LIMIT 50`),
                dbQuery(`SELECT mi.id::text, mi.name, d.name as direction_name FROM maintenance_items mi LEFT JOIN directions d ON mi.direction_id = d.id ORDER BY d.name, mi.name LIMIT 100`),
                dbQuery(`SELECT t.id::text, t.name FROM tenants t ORDER BY t.name LIMIT 50`),
                dbQuery(`SELECT u.id::text, coalesce(nullif(trim(u.full_name), ''), u.email) as name, u.role::text FROM app_users u WHERE u.status = 'active' ORDER BY u.full_name LIMIT 50`),
            ]);
            const reqSummary = reqStats.rows.map((r) => `${r.status}: ${r.cnt}`).join(', ');
            const projSummary = projStats.rows.map((r) => `${r.status}: ${r.cnt}`).join(', ');
            const recentList = recentReqs.rows.map((r) => `[id:${r.id}] "${normalizeText(r.title) || 'Без названия'}" — ${r.status}, приоритет: ${r.priority || 'не указан'}`).join('\n');
            const directionsList = directionsData.rows.map((r) => `[id:${r.id}] ${normalizeText(r.name)}`).join('\n');
            const itemsList = itemsData.rows.map((r) => `[id:${r.id}] ${normalizeText(r.name)} (направление: ${normalizeText(r.direction_name) || '—'})`).join('\n');
            const tenantsList = tenantsData.rows.map((r) => `[id:${r.id}] ${normalizeText(r.name)}`).join('\n');
            const executorsList = executorsData.rows.map((r) => `${normalizeText(r.name)} — ${r.role}`).join('\n');
            contextBlock = `\n\n--- Текущие данные системы ---`
                + `\nЗаявки по статусам: ${reqSummary || 'нет данных'}`
                + `\nПроекты/инсталляции по статусам: ${projSummary || 'нет данных'}`
                + `\nПоследние заявки:\n${recentList || 'нет данных'}`
                + `\n\nНаправления:\n${directionsList || 'нет данных'}`
                + `\nОбъекты ТО:\n${itemsList || 'нет данных'}`
                + `\nКонтрагенты:\n${tenantsList || 'нет данных'}`
                + `\nАктивные сотрудники:\n${executorsList || 'нет данных'}`;
        }
        catch {
            // context is best-effort
        }
        const systemPrompt = aiChatSystemPrompt + contextBlock;
        // Build conversation for LLM (multi-turn)
        // callLLM supports single turn; for multi-turn we pass history in user prompt
        let conversationText = '';
        if (validMessages.length > 1) {
            const history = validMessages.slice(0, -1);
            conversationText = history.map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`).join('\n') + '\n\nПользователь: ' + userQuery;
        }
        else {
            conversationText = userQuery;
        }
        const result = await callLLMWithFallback(systemPrompt, conversationText, { maxTokens: 2048, temperature: 0.5 });
        if (!result.content) {
            response.status(200).json({
                reply: 'AI временно недоступен. Попробуйте позже.',
                _meta: { source: result.source, provider: result.provider, error: result.error },
            });
            return;
        }
        response.status(200).json({
            reply: normalizeText(result.content),
            _meta: { source: result.source, provider: result.provider },
        });
    }));
    app.post('/ai/suggest-executor', requireAuth, asyncHandler(async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        assertAiInputTextLength(body.title, 'title', ApiError);
        assertAiInputTextLength(body.description, 'description', ApiError);
        const title = normalizeText(body.title);
        const description = normalizeText(body.description);
        const systemType = normalizeText(body.systemType);
        const directionId = normalizeText(body.directionId);
        if (!title || !description) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'title и description обязательны');
        }
        let candidateRows = [];
        {
            const usersResult = await dbQuery(`SELECT id::text as id,
         coalesce(nullif(trim(full_name), ''), email)::text as full_name,
         role::text as role
       FROM app_users
       WHERE status::text = 'active'`);
            candidateRows = usersResult.rows;
        }
        const candidates = candidateRows
            .map((row) => ({
            id: normalizeText(row.id),
            name: normalizeText(row.full_name) || normalizeText(row.id),
            role: normalizeText(row.role),
        }))
            .filter((row) => row.id);
        if (candidates.length === 0) {
            response.status(200).json({
                executorId: null,
                executorName: null,
                reason: 'Нет активных пользователей для назначения.',
                _meta: { source: 'none', provider: null },
            });
            return;
        }
        const candidatesText = candidates
            .map((candidate, index) => `${index + 1}. id=${candidate.id}; name=${candidate.name}; role=${candidate.role || '-'}`)
            .join('\n');
        const systemPrompt = `Ты помощник диспетчера сервисных заявок.
Твоя задача — выбрать одного наилучшего исполнителя из списка кандидатов.
Учитывай текст заявки, systemType и directionId.
Разрешено выбирать только id из переданного списка.
Ответ верни строго JSON-объект:
{"executorId":"...","executorName":"...","reason":"..."}
Без markdown, без дополнительного текста.`;
        const userPrompt = [
            'Данные заявки:',
            `title=${title}`,
            `description=${description}`,
            `systemType=${systemType || '-'}`,
            `directionId=${directionId || '-'}`,
            '',
            'Кандидаты:',
            candidatesText,
        ].join('\n');
        const suggestionResult = await callLLMWithFallback(systemPrompt, userPrompt, {
            maxTokens: 2048,
            temperature: 0.2,
        });
        if (!suggestionResult.content) {
            response.status(200).json({
                executorId: null,
                executorName: null,
                reason: 'AI временно недоступен. Попробуйте позже.',
                _meta: { source: suggestionResult.source, provider: suggestionResult.provider, error: suggestionResult.error },
            });
            return;
        }
        const parsed = parseAiJson(suggestionResult.content);
        const parsedObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        const suggestedExecutorId = normalizeText(parsedObject.executorId);
        const suggestedExecutorName = normalizeText(parsedObject.executorName);
        const reason = normalizeText(parsedObject.reason);
        let selectedCandidate = candidates.find((candidate) => candidate.id === suggestedExecutorId);
        if (!selectedCandidate && suggestedExecutorName) {
            const normalizedTargetName = suggestedExecutorName.toLowerCase();
            selectedCandidate = candidates.find((candidate) => candidate.name.toLowerCase() === normalizedTargetName);
        }
        if (!selectedCandidate) {
            response.status(200).json({
                executorId: null,
                executorName: null,
                reason: reason || 'AI не смог выбрать исполнителя из списка кандидатов.',
                _meta: { source: suggestionResult.source, provider: suggestionResult.provider, error: 'invalid_executor' },
            });
            return;
        }
        response.status(200).json({
            executorId: selectedCandidate.id,
            executorName: selectedCandidate.name,
            reason: reason || 'Исполнитель выбран по содержанию заявки.',
            _meta: { source: suggestionResult.source, provider: suggestionResult.provider },
        });
    }));
    app.post('/ai/summarize-chat', requireAuth, asyncHandler(async (request, response) => {
        await ensureProjectSchema();
        const actorRole = normalizeText(request.authUser?.role);
        const actorUserId = normalizeText(request.authUser?.id);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const projectId = parseUuidPath(body.projectId);
        await ensureActorHasProjectAccess({
            actorUserId,
            actorRole,
            projectId,
        });
        const messagesResult = await dbQuery(`select
       text,
       author_id,
       created_at
     from project_chat_messages
     where project_id = $1::uuid
       and deleted_at is null
     order by created_at desc
     limit 100`, [projectId]);
        if (messagesResult.rows.length === 0) {
            response.status(200).json({
                summary: null,
                _meta: { source: 'none', provider: null },
            });
            return;
        }
        const authorIds = Array.from(new Set(messagesResult.rows
            .map((row) => normalizeText(row.author_id))
            .filter(Boolean)));
        let authorNamesById = {};
        if (authorIds.length > 0) {
            const authorsResult = await dbQuery(`select id::text as id, coalesce(nullif(trim(full_name), ''), email) as full_name
         from app_users
         where id::text = any($1::text[])`, [authorIds]);
            authorNamesById = authorsResult.rows.reduce((accumulator, row) => {
                const id = normalizeText(row.id);
                if (id) {
                    accumulator[id] = normalizeText(row.full_name) || id;
                }
                return accumulator;
            }, {});
        }
        const transcript = [...messagesResult.rows]
            .reverse()
            .map((row) => {
            const authorId = normalizeText(row.author_id);
            const authorName = authorNamesById[authorId] ?? authorId ?? 'Unknown';
            const createdAt = row.created_at ? new Date(row.created_at).toISOString() : '';
            return `[${createdAt}] ${authorName}: ${normalizeText(row.text)}`;
        })
            .join('\n');
        const summaryResult = await callLLMWithFallback(aiChatSummarySystemPrompt, transcript, { maxTokens: 2048, temperature: 0.2 });
        const summary = normalizeText(summaryResult.content);
        response.status(200).json({
            summary: summary || null,
            _meta: { source: summaryResult.source, provider: summaryResult.provider, error: summary ? undefined : summaryResult.error },
        });
    }));
    app.post('/ai/summarize-notifications', requireAuth, asyncHandler(async (request, response) => {
        await ensureNotificationSchema();
        const userId = normalizeText(request.authUser?.id);
        if (!isUuidValue(userId)) {
            response.status(200).json({
                summary: null,
                groups: [],
                _meta: { source: 'none', provider: null },
            });
            return;
        }
        const unreadResult = await dbQuery(`select
       id::text as id,
       event_type,
       title,
       body
     from app_notifications
     where user_id = $1::uuid
       and is_read = false
     order by created_at desc
     limit 50`, [userId]);
        if (unreadResult.rows.length === 0) {
            response.status(200).json({
                summary: null,
                groups: [],
                _meta: { source: 'none', provider: null },
            });
            return;
        }
        const sourceIds = new Set(unreadResult.rows.map((row) => normalizeText(row.id)).filter(Boolean));
        const sourceText = unreadResult.rows
            .map((row) => `[id=${normalizeText(row.id)}][${normalizeText(row.event_type)}] ${normalizeText(row.title)}: ${normalizeText(row.body)}`)
            .join('\n');
        const llmResult = await callLLMWithFallback(aiNotificationSummarySystemPrompt, sourceText, { maxTokens: 2048, temperature: 0.2 });
        if (!llmResult.content) {
            response.status(200).json({
                summary: null,
                groups: [],
                _meta: { source: llmResult.source, provider: llmResult.provider, error: llmResult.error },
            });
            return;
        }
        const parsed = parseAiJson(llmResult.content);
        const parsedObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        const groupsInput = Array.isArray(parsedObject.groups) ? parsedObject.groups : [];
        const groups = groupsInput
            .map((group) => {
            const item = group && typeof group === 'object' ? group : {};
            const ids = Array.isArray(item.ids)
                ? item.ids.map((idValue) => normalizeText(idValue)).filter((idValue) => sourceIds.has(idValue))
                : [];
            const uniqueIds = Array.from(new Set(ids));
            const countValue = Number(item.count ?? uniqueIds.length);
            return {
                label: normalizeText(item.label) || 'Группа уведомлений',
                count: Number.isFinite(countValue) && countValue > 0 ? countValue : uniqueIds.length,
                ids: uniqueIds,
            };
        })
            .filter((group) => group.ids.length > 0)
            .slice(0, 7);
        const summary = normalizeText(parsedObject.summary);
        response.status(200).json({
            summary: summary || null,
            groups,
            _meta: { source: llmResult.source, provider: llmResult.provider },
        });
    }));
    app.post('/ai/generate-installation', requireAuth, asyncHandler(async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        assertAiInputTextLength(body.projectTitle, 'title', ApiError);
        assertAiInputTextLength(body.projectDescription, 'description', ApiError);
        const projectTitle = normalizeText(body.projectTitle);
        const projectDescription = normalizeText(body.projectDescription);
        const address = normalizeText(body.address);
        let filesText = normalizeText(body.filesText); // extracted text from uploaded files
        // Extract text from attached files if provided
        const files = Array.isArray(body.files) ? body.files : [];
        if (files.length > 0 && !filesText) {
            const fileEntries = files.slice(0, 5).map((f) => {
                if (!f || typeof f !== 'object')
                    return null;
                const url = normalizeText(f.url);
                const name = normalizeText(f.name);
                if (!url)
                    return null;
                const uploadsIdx = url.indexOf('/uploads/');
                const storageKey = uploadsIdx >= 0 ? url.slice(uploadsIdx + '/uploads/'.length) : '';
                if (!storageKey)
                    return null;
                const ext = (name || url).split('.').pop()?.toLowerCase() || '';
                const mimeMap = {
                    pdf: 'application/pdf',
                    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    doc: 'application/msword',
                    txt: 'text/plain',
                    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    xls: 'application/vnd.ms-excel',
                };
                const mimeType = mimeMap[ext] || '';
                if (!mimeType)
                    return null;
                return { storage_key: storageKey, mime_type: mimeType };
            }).filter(Boolean);
            if (fileEntries.length > 0) {
                try {
                    filesText = await extractTextFromFiles(fileEntries);
                }
                catch { /* ignore */ }
            }
        }
        if (!projectTitle && !projectDescription && !filesText) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Необходимо указать описание проекта или загрузить файлы');
        }
        const systemPrompt = `Ты — эксперт по монтажу инженерных систем безопасности (СВН, СКУД, АПС, АУПТ, СОУЭ, ВПВ, СКС и др.).
На основе названия монтажа и дополнительных данных составь КРАТКОЕ структурированное описание для карточки монтажа.

Описание должно содержать:
- Краткое описание объёма работ (2-3 предложения)
- Перечень систем, которые предположительно будут монтироваться (на основе названия)
- Основные этапы работ (кратко, списком, без подробностей)

ВАЖНО:
- Пиши КРАТКО и КОНКРЕТНО, привязываясь к названию монтажа.
- НЕ пиши общие фразы типа "изучение проектной документации", "согласование графика".
- НЕ пиши про требования к персоналу, сроки, материалы — только суть работ.
- Если из названия непонятно какие системы — спроси уточнение, не выдумывай.
- Формат: HTML (можно использовать <b>, <ul>, <li>, <p>). Без заголовков <h1>-<h6>.
- Максимум 150 слов.`;
        const userPrompt = [
            projectTitle ? `Название монтажа: ${projectTitle}` : '',
            address ? `Адрес: ${address}` : '',
            projectDescription ? `Текущее описание: ${projectDescription}` : '',
            filesText ? `Данные из файлов:\n${filesText.slice(0, 6000)}` : '',
        ].filter(Boolean).join('\n');
        const planResult = await callLLMWithFallback(systemPrompt, userPrompt, { maxTokens: 2048, temperature: 0.3 });
        if (!planResult.content) {
            response.status(200).json({
                plan: 'AI временно недоступен. Попробуйте позже.',
                _meta: { source: planResult.source, provider: planResult.provider, error: planResult.error },
            });
            return;
        }
        response.status(200).json({
            plan: normalizeText(planResult.content),
            _meta: { source: planResult.source, provider: planResult.provider },
        });
    }));
    app.post('/ai/generate-maintenance-description', requireAuth, asyncHandler(async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        assertAiInputTextLength(body.planName, 'planName', ApiError);
        const planName = normalizeText(body.planName);
        const systemType = normalizeText(body.systemType);
        const frequency = normalizeText(body.frequency);
        const currentDescription = normalizeText(body.currentDescription);
        let filesText = normalizeText(body.filesText);
        // Extract text from attached files if provided
        const files = Array.isArray(body.files) ? body.files : [];
        if (files.length > 0 && !filesText) {
            const fileEntries = files.slice(0, 5).map((f) => {
                if (!f || typeof f !== 'object')
                    return null;
                const url = normalizeText(f.url);
                const name = normalizeText(f.name);
                if (!url)
                    return null;
                const uploadsIdx = url.indexOf('/uploads/');
                const storageKey = uploadsIdx >= 0 ? url.slice(uploadsIdx + '/uploads/'.length) : '';
                if (!storageKey)
                    return null;
                const ext = (name || url).split('.').pop()?.toLowerCase() || '';
                const mimeMap = {
                    pdf: 'application/pdf',
                    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    doc: 'application/msword',
                    txt: 'text/plain',
                    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    xls: 'application/vnd.ms-excel',
                };
                const mimeType = mimeMap[ext] || '';
                if (!mimeType)
                    return null;
                return { storage_key: storageKey, mime_type: mimeType };
            }).filter(Boolean);
            if (fileEntries.length > 0) {
                try {
                    filesText = await extractTextFromFiles(fileEntries);
                }
                catch { /* ignore */ }
            }
        }
        if (!planName && !filesText) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Необходимо указать название плана ТО или загрузить файлы');
        }
        const systemPrompt = `Ты — эксперт по техническому обслуживанию инженерных систем безопасности (СВН, СКУД, АПС, АУПТ, СОУЭ, ВПВ, СКС и др.).
На основе названия плана ТО и дополнительных данных составь КРАТКОЕ структурированное описание для карточки плана технического обслуживания.

Описание должно содержать:
- Краткое описание объёма работ по ТО (2-3 предложения)
- Перечень типовых работ для указанной системы (кратко, списком)
- Периодичность и ключевые моменты обслуживания

ВАЖНО:
- Пиши КРАТКО и КОНКРЕТНО, привязываясь к названию плана и типу системы.
- НЕ пиши общие фразы.
- Формат: HTML (можно использовать <b>, <ul>, <li>, <p>). Без заголовков <h1>-<h6>.
- Максимум 150 слов.`;
        const userPrompt = [
            planName ? `Название плана ТО: ${planName}` : '',
            systemType ? `Тип системы: ${systemType}` : '',
            frequency ? `Периодичность: ${frequency}` : '',
            currentDescription ? `Текущее описание: ${currentDescription}` : '',
            filesText ? `Данные из файлов:\n${filesText.slice(0, 6000)}` : '',
        ].filter(Boolean).join('\n');
        const planResult = await callLLMWithFallback(systemPrompt, userPrompt, { maxTokens: 2048, temperature: 0.3 });
        if (!planResult.content) {
            response.status(200).json({
                plan: 'AI временно недоступен. Попробуйте позже.',
                _meta: { source: planResult.source, provider: planResult.provider, error: planResult.error },
            });
            return;
        }
        response.status(200).json({
            plan: normalizeText(planResult.content),
            _meta: { source: planResult.source, provider: planResult.provider },
        });
    }));
    app.post('/ai/generate-project-description', requireAuth, asyncHandler(async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const projectTitle = normalizeText(body.projectTitle);
        const projectDescription = normalizeText(body.projectDescription);
        const filesText = normalizeText(body.filesText);
        if (!projectTitle && !projectDescription && !filesText) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Необходимо указать название проекта или загрузить файлы');
        }
        // Extract text from attached files if provided
        let extractedFilesText = filesText || '';
        const files = Array.isArray(body.files) ? body.files : [];
        if (files.length > 0 && !extractedFilesText) {
            logger.info('AI project description: processing files', { fileCount: files.length, files: files.map((f) => ({ url: f?.url, name: f?.name })) });
            const fileEntries = files.slice(0, 5).map((f) => {
                if (!f || typeof f !== 'object')
                    return null;
                const url = normalizeText(f.url);
                const name = normalizeText(f.name);
                if (!url)
                    return null;
                const uploadsIdx = url.indexOf('/uploads/');
                const storageKey = uploadsIdx >= 0 ? url.slice(uploadsIdx + '/uploads/'.length) : '';
                if (!storageKey)
                    return null;
                const ext = (name || url).split('.').pop()?.toLowerCase() || '';
                const mimeMap = {
                    pdf: 'application/pdf',
                    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    doc: 'application/msword',
                    txt: 'text/plain',
                    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    xls: 'application/vnd.ms-excel',
                };
                const mimeType = mimeMap[ext] || '';
                if (!mimeType)
                    return null;
                return { storage_key: storageKey, mime_type: mimeType };
            }).filter(Boolean);
            logger.info('AI project description: file entries resolved', { entries: fileEntries });
            if (fileEntries.length > 0) {
                try {
                    extractedFilesText = await extractTextFromFiles(fileEntries);
                    logger.info('AI project description: extracted text', { textLength: extractedFilesText.length });
                }
                catch (err) {
                    logger.warn('AI project description: file extraction failed', { error: err instanceof Error ? err.message : String(err) });
                }
            }
        }
        const systemPrompt = `Ты — эксперт по управлению проектами в сфере инженерных систем безопасности.
На основе названия проекта, загруж��нных документов и дополнительных данных составь КРАТКОЕ структурированное описание для карточки проекта.

Описание должно содержать:
- Краткое описание проекта (2-3 предложения)
- Перечень основных задач и работ
- Ключевые системы, если применимо
- Конкретные данные из файлов (суммы, позиции, оборудование, количество) — если есть

ВАЖНО:
- Пиши КРАТКО и КОНКРЕТНО.
- НЕ пиши общие фразы.
- Обязательно используй данные из ВСЕХ листов загруженных файлов.
- Если в файле есть конкретные позиции, оборудование, суммы — упомяни их.
- Формат: обычный текст, без HTML.
- Максимум 200 слов.
/no_think`;
        const userPrompt = [
            projectTitle ? `Название проекта: ${projectTitle}` : '',
            projectDescription ? `Текущее описание: ${projectDescription}` : '',
            extractedFilesText ? `Данные из файлов:\n${extractedFilesText.slice(0, 12000)}` : '',
        ].filter(Boolean).join('\n');
        const result = await callLLMWithFallback(systemPrompt, userPrompt, { maxTokens: 2048, temperature: 0.3 });
        if (!result.content) {
            response.status(200).json({
                description: 'AI временно недоступен. Попробуйте позже.',
                _meta: { source: result.source, provider: result.provider, error: result.error },
            });
            return;
        }
        response.status(200).json({
            description: normalizeText(result.content),
            _meta: { source: result.source, provider: result.provider },
        });
    }));
    app.post('/ai/expand-search', requireAuth, asyncHandler(async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const originalQuery = normalizeText(body.query);
        if (!originalQuery) {
            response.status(200).json({
                expandedTerms: [],
                systemTypes: [],
                originalQuery: '',
                _meta: { source: 'none', provider: null },
            });
            return;
        }
        const llmResult = await callLLMWithFallback(aiExpandSearchSystemPrompt, `query: ${originalQuery}`, { maxTokens: 2048, temperature: 0.2 });
        if (!llmResult.content) {
            response.status(200).json({
                expandedTerms: [],
                systemTypes: [],
                originalQuery,
                _meta: { source: llmResult.source, provider: llmResult.provider, error: llmResult.error },
            });
            return;
        }
        const parsed = parseAiJson(llmResult.content);
        const parsedObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        const expandedTerms = Array.isArray(parsedObject.expandedTerms)
            ? Array.from(new Set(parsedObject.expandedTerms
                .map((term) => normalizeText(term))
                .filter(Boolean)))
            : [];
        const systemTypes = Array.isArray(parsedObject.systemTypes)
            ? Array.from(new Set(parsedObject.systemTypes
                .map((code) => normalizeAiSystemType(code))
                .filter((code) => aiSystemTypeValues.has(code))))
            : [];
        response.status(200).json({
            expandedTerms,
            systemTypes,
            originalQuery,
            _meta: { source: llmResult.source, provider: llmResult.provider },
        });
    }));
    // AI Feedback endpoint
    app.post('/ai/feedback', requireAuth, asyncHandler(async (request, response) => {
        await ensureAiFeedbackSchema();
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const userId = normalizeText(request.authUser?.id);
        const endpoint = normalizeText(body.endpoint);
        const entityId = normalizeText(body.entityId) || null;
        const rating = normalizeText(body.rating);
        const source = normalizeText(body.source) || null;
        const provider = normalizeText(body.provider) || null;
        if (!endpoint || !rating || !['positive', 'negative'].includes(rating)) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'endpoint и rating (positive/negative) обязательны');
        }
        if (!isUuidValue(userId)) {
            throw new ApiError(401, 'AUTH_ERROR', 'Не авторизован');
        }
        await dbQuery(`INSERT INTO ai_feedback (user_id, endpoint, entity_id, rating, source, provider)
             VALUES ($1::uuid, $2, $3, $4, $5, $6)`, [userId, endpoint, entityId, rating, source, provider]);
        response.status(200).json({ ok: true });
    }));
};
