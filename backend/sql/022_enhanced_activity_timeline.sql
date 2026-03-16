-- Enhanced Activity Timeline
-- Adds filtering, email integration, and activity templates

-- Add new columns to activity_log
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS activity_subtype VARCHAR(50);
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(100);
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS related_entity_id UUID;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Email activities (links activity_log to email_queue)
CREATE TABLE IF NOT EXISTS activity_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID REFERENCES activity_log(id) ON DELETE CASCADE,
    email_queue_id UUID REFERENCES email_queue(id) ON DELETE SET NULL,
    subject VARCHAR(500),
    from_address VARCHAR(255),
    to_addresses TEXT[],
    cc_addresses TEXT[],
    bcc_addresses TEXT[],
    body_preview TEXT,
    has_attachments BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity templates
CREATE TABLE IF NOT EXISTS activity_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    activity_type VARCHAR(50) NOT NULL,
    activity_subtype VARCHAR(50),
    title_template TEXT NOT NULL,
    description_template TEXT,
    metadata_template JSONB,
    severity VARCHAR(20) DEFAULT 'info',
    is_public BOOLEAN DEFAULT false,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity attachments (for files linked to activities)
CREATE TABLE IF NOT EXISTS activity_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID REFERENCES activity_log(id) ON DELETE CASCADE,
    file_id UUID REFERENCES uploaded_files(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(activity_id, file_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_log_subtype ON activity_log(activity_subtype);
CREATE INDEX IF NOT EXISTS idx_activity_log_related ON activity_log(related_entity_type, related_entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_pinned ON activity_log(is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_activity_log_tags ON activity_log USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity_created ON activity_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_emails_activity ON activity_emails(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_emails_queue ON activity_emails(email_queue_id);
CREATE INDEX IF NOT EXISTS idx_activity_templates_type ON activity_templates(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_attachments_activity ON activity_attachments(activity_id);

-- Insert default activity templates
INSERT INTO activity_templates (name, description, activity_type, title_template, description_template, severity, is_public)
VALUES
    ('Статус изменен', 'Шаблон для изменения статуса', 'status_change', 'Статус изменен на {{newStatus}}', 'Статус изменен с {{oldStatus}} на {{newStatus}}', 'info', true),
    ('Комментарий добавлен', 'Шаблон для добавления комментария', 'comment', 'Добавлен комментарий', '{{comment}}', 'info', true),
    ('Файл загружен', 'Шаблон для загрузки файла', 'file_upload', 'Загружен файл {{fileName}}', 'Файл {{fileName}} ({{fileSize}}) загружен', 'info', true),
    ('Назначение изменено', 'Шаблон для изменения исполнителя', 'assignment', 'Назначен исполнитель {{assigneeName}}', 'Исполнитель изменен на {{assigneeName}}', 'info', true),
    ('Email отправлен', 'Шаблон для отправки email', 'email', 'Email отправлен: {{subject}}', 'Email отправлен на {{recipients}}', 'info', true),
    ('Дедлайн приближается', 'Шаблон для напоминания о дедлайне', 'deadline_reminder', 'Дедлайн через {{timeRemaining}}', 'Дедлайн {{deadline}} приближается', 'warning', true),
    ('Дедлайн просрочен', 'Шаблон для просроченного дедлайна', 'deadline_overdue', 'Дедлайн просрочен', 'Дедлайн {{deadline}} был просрочен', 'error', true)
ON CONFLICT DO NOTHING;

-- Create function to automatically create activity for emails
CREATE OR REPLACE FUNCTION create_email_activity()
RETURNS TRIGGER AS $$
DECLARE
    v_activity_id UUID;
    v_entity_type VARCHAR(100);
    v_entity_id UUID;
    v_subject VARCHAR(500);
    v_to_addresses TEXT[];
BEGIN
    -- Extract entity info from metadata
    v_entity_type := NEW.metadata->>'entityType';
    v_entity_id := (NEW.metadata->>'entityId')::UUID;
    v_subject := COALESCE(NEW.subject, 'Без темы');
    v_to_addresses := ARRAY[NEW.to_email];

    -- Create activity log entry
    INSERT INTO activity_log (
        entity_type,
        entity_id,
        activity_type,
        activity_subtype,
        actor_user_id,
        actor_name,
        severity,
        title,
        description,
        metadata,
        created_at
    )
    VALUES (
        COALESCE(v_entity_type, 'email'),
        v_entity_id,
        'email',
        CASE
            WHEN NEW.status = 'sent' THEN 'sent'
            WHEN NEW.status = 'failed' THEN 'failed'
            ELSE 'queued'
        END,
        NEW.created_by_user_id,
        COALESCE((SELECT name FROM users WHERE id = NEW.created_by_user_id), 'Система'),
        CASE
            WHEN NEW.status = 'failed' THEN 'error'
            ELSE 'info'
        END,
        'Email: ' || v_subject,
        'Email отправлен на ' || NEW.to_email,
        jsonb_build_object(
            'emailQueueId', NEW.id,
            'subject', v_subject,
            'toEmail', NEW.to_email,
            'status', NEW.status
        ),
        NEW.created_at
    )
    RETURNING id INTO v_activity_id;

    -- Create email activity record
    INSERT INTO activity_emails (
        activity_id,
        email_queue_id,
        subject,
        from_address,
        to_addresses,
        body_preview,
        created_at
    )
    VALUES (
        v_activity_id,
        NEW.id,
        v_subject,
        NEW.from_email,
        v_to_addresses,
        LEFT(NEW.body_text, 200),
        NEW.created_at
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for email activities (only if email_queue table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_queue') THEN
        DROP TRIGGER IF EXISTS trigger_create_email_activity ON email_queue;
        CREATE TRIGGER trigger_create_email_activity
            AFTER INSERT ON email_queue
            FOR EACH ROW
            WHEN (NEW.status IN ('sent', 'queued'))
            EXECUTE FUNCTION create_email_activity();
    END IF;
END $$;

-- Add full-text search to activity_log
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_activity_log_search ON activity_log USING GIN(search_vector);

-- Function to update search vector
CREATE OR REPLACE FUNCTION activity_log_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('russian', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('russian', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('russian', COALESCE(NEW.actor_name, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for search vector
DROP TRIGGER IF EXISTS trigger_activity_log_search_vector ON activity_log;
CREATE TRIGGER trigger_activity_log_search_vector
    BEFORE INSERT OR UPDATE ON activity_log
    FOR EACH ROW
    EXECUTE FUNCTION activity_log_search_vector_update();

-- Update existing records
UPDATE activity_log SET search_vector =
    setweight(to_tsvector('russian', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('russian', COALESCE(description, '')), 'B') ||
    setweight(to_tsvector('russian', COALESCE(actor_name, '')), 'C')
WHERE search_vector IS NULL;

COMMENT ON TABLE activity_emails IS 'Email activities linked to activity log';
COMMENT ON TABLE activity_templates IS 'Templates for creating consistent activity entries';
COMMENT ON TABLE activity_attachments IS 'File attachments linked to activities';
COMMENT ON COLUMN activity_log.activity_subtype IS 'Subtype for more granular activity classification';
COMMENT ON COLUMN activity_log.related_entity_type IS 'Related entity type for cross-entity references';
COMMENT ON COLUMN activity_log.related_entity_id IS 'Related entity ID for cross-entity references';
COMMENT ON COLUMN activity_log.is_pinned IS 'Whether activity is pinned to top of timeline';
COMMENT ON COLUMN activity_log.tags IS 'Tags for activity categorization and filtering';
COMMENT ON COLUMN activity_log.search_vector IS 'Full-text search vector for activity search';
