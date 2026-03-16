import { dbQuery } from '../db.js';
import { logger } from '../logger.js';

let schemaReady = false;

export const ensureAiWeeklyReportSchema = async () => {
    if (schemaReady) {
        return;
    }
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS ai_weekly_reports (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                report_key text NOT NULL,
                period_start date NOT NULL,
                period_end date NOT NULL,
                anomalies_count integer NOT NULL DEFAULT 0,
                requests_created integer NOT NULL DEFAULT 0,
                requests_completed integer NOT NULL DEFAULT 0,
                requests_overdue integer NOT NULL DEFAULT 0,
                anomalies_data jsonb DEFAULT '[]'::jsonb,
                request_stats jsonb DEFAULT '{}'::jsonb,
                report_text text NOT NULL DEFAULT '',
                sent_via_telegram boolean NOT NULL DEFAULT false,
                sent_via_email boolean NOT NULL DEFAULT false,
                recipient_count integer NOT NULL DEFAULT 0,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ai_weekly_reports_report_key_unique UNIQUE (report_key)
            )
        `);
        await dbQuery(`CREATE INDEX IF NOT EXISTS idx_ai_weekly_reports_created_at ON ai_weekly_reports (created_at DESC)`);
        schemaReady = true;
    } catch (error) {
        logger.warn('ensureAiWeeklyReportSchema: migration skipped or failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        schemaReady = true; // don't block on schema errors
    }
};
