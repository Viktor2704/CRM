import { dbQuery } from '../db.js';
let ensureInstallationExtendedSchemaPromise = null;
export const ensureInstallationExtendedSchema = async () => {
    if (ensureInstallationExtendedSchemaPromise) {
        return ensureInstallationExtendedSchemaPromise;
    }
    ensureInstallationExtendedSchemaPromise = (async () => {
        // ── Extra columns on requests for installations ──
        await dbQuery(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS paused_from_stage text`);
        await dbQuery(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS cancel_reason text`);
        await dbQuery(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS cancel_comment text`);
        await dbQuery(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS pause_reason text`);
        // ── Stage deadlines per installation ──
        await dbQuery(`CREATE TABLE IF NOT EXISTS installation_stage_deadlines (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            installation_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            stage text NOT NULL,
            due_date date NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(installation_id, stage)
        )`);
        await dbQuery(`CREATE INDEX IF NOT EXISTS idx_inst_stage_deadlines_inst
            ON installation_stage_deadlines(installation_id)`);
        await dbQuery(`CREATE INDEX IF NOT EXISTS idx_inst_stage_deadlines_due
            ON installation_stage_deadlines(due_date)`);
        // ── Procurement items ──
        await dbQuery(`CREATE TABLE IF NOT EXISTS installation_procurement_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            installation_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            name text NOT NULL DEFAULT '',
            quantity integer NOT NULL DEFAULT 1,
            unit text NOT NULL DEFAULT 'шт',
            comment text NOT NULL DEFAULT '',
            link text NOT NULL DEFAULT '',
            status text NOT NULL DEFAULT 'needed',
            responsible_user_id uuid,
            files jsonb NOT NULL DEFAULT '[]'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await dbQuery(`CREATE INDEX IF NOT EXISTS idx_inst_procurement_items_inst
            ON installation_procurement_items(installation_id)`);
        await dbQuery(`CREATE INDEX IF NOT EXISTS idx_inst_procurement_items_status
            ON installation_procurement_items(installation_id, status)`);
        // ── Chat pin support ──
        await dbQuery(`ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false`);
        // ── Indexes for installation list queries ──
        await dbQuery(`CREATE INDEX IF NOT EXISTS idx_requests_installations_status
            ON requests(status, created_at DESC)
            WHERE type = 'installation' AND is_project = false AND deleted_at IS NULL`);
    })().catch((error) => {
        ensureInstallationExtendedSchemaPromise = null;
        throw error;
    });
    return ensureInstallationExtendedSchemaPromise;
};
