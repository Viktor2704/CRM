-- Performance Indexes for Novinzhstroy
-- Agent 23: Performance Optimization

-- Tenants table indexes
CREATE INDEX IF NOT EXISTS idx_tenants_deleted_at ON tenants(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_inn ON tenants(inn) WHERE deleted_at IS NULL;

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE deleted_at IS NULL;

-- App users table indexes
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_status ON app_users(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role) WHERE deleted_at IS NULL;

-- Service requests indexes
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_priority ON service_requests(priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_due_date ON service_requests(due_date_preliminary) WHERE deleted_at IS NULL AND due_date_preliminary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_created_at ON service_requests(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_tenant_id ON service_requests(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_assigned_to ON service_requests(assigned_to) WHERE deleted_at IS NULL;

-- Composite index for common service request queries
CREATE INDEX IF NOT EXISTS idx_service_requests_status_priority ON service_requests(status, priority, created_at DESC) WHERE deleted_at IS NULL;

-- Maintenance items indexes
CREATE INDEX IF NOT EXISTS idx_maintenance_items_tenant_id ON maintenance_items(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_items_direction_id ON maintenance_items(direction_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_items_deleted_at ON maintenance_items(deleted_at) WHERE deleted_at IS NULL;

-- Directions indexes
CREATE INDEX IF NOT EXISTS idx_directions_tenant_id ON directions(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_directions_deleted_at ON directions(deleted_at) WHERE deleted_at IS NULL;

-- Projects indexes
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at) WHERE deleted_at IS NULL;

-- Installations indexes
CREATE INDEX IF NOT EXISTS idx_installations_project_id ON installations(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_installations_status ON installations(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_installations_deleted_at ON installations(deleted_at) WHERE deleted_at IS NULL;

-- Contracts indexes
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_id ON contracts(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_deleted_at ON contracts(deleted_at) WHERE deleted_at IS NULL;

-- Activity log indexes
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_log_entity_type_id ON activity_log(entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id) WHERE deleted_at IS NULL;

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC) WHERE deleted_at IS NULL;

-- Composite index for unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE deleted_at IS NULL AND read_at IS NULL;

-- App user bindings indexes
CREATE INDEX IF NOT EXISTS idx_app_user_bindings_user_id ON app_user_bindings(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_user_bindings_counterparty_id ON app_user_bindings(counterparty_id) WHERE deleted_at IS NULL;

-- Email queue indexes (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_queue') THEN
        CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled_at ON email_queue(scheduled_at) WHERE deleted_at IS NULL AND status = 'pending';
        CREATE INDEX IF NOT EXISTS idx_email_queue_created_at ON email_queue(created_at DESC);
    END IF;
END $$;

-- Telegram notifications history indexes (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'telegram_notifications_history') THEN
        CREATE INDEX IF NOT EXISTS idx_telegram_notifications_status ON telegram_notifications_history(status);
        CREATE INDEX IF NOT EXISTS idx_telegram_notifications_created_at ON telegram_notifications_history(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_telegram_notifications_chat_id ON telegram_notifications_history(chat_id);
    END IF;
END $$;

-- Knowledge base indexes (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'knowledge_base_articles') THEN
        CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON knowledge_base_articles(category) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_kb_articles_created_at ON knowledge_base_articles(created_at DESC) WHERE deleted_at IS NULL;
    END IF;
END $$;

-- Scheduled reports indexes (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_reports') THEN
        CREATE INDEX IF NOT EXISTS idx_scheduled_reports_enabled ON scheduled_reports(enabled) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next_run ON scheduled_reports(next_run_at) WHERE deleted_at IS NULL AND enabled = true;
    END IF;
END $$;

-- Analyze tables to update statistics
ANALYZE tenants;
ANALYZE users;
ANALYZE app_users;
ANALYZE service_requests;
ANALYZE maintenance_items;
ANALYZE directions;
ANALYZE projects;
ANALYZE installations;
ANALYZE contracts;
ANALYZE activity_log;
ANALYZE notifications;
ANALYZE app_user_bindings;
