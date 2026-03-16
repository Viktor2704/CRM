-- Metadata-Driven Custom Fields System
-- Enables UI-driven custom field creation without code changes

-- Entity metadata
CREATE TABLE IF NOT EXISTS entity_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(100) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    plural_label VARCHAR(255) NOT NULL,
    icon VARCHAR(50),
    description TEXT,
    is_custom BOOLEAN DEFAULT false,
    table_name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Field metadata
CREATE TABLE IF NOT EXISTS field_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(100) NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    field_type VARCHAR(50) NOT NULL, -- text, number, date, datetime, select, multi_select, checkbox, link, email, phone, url, textarea, currency
    label VARCHAR(255) NOT NULL,
    description TEXT,
    is_required BOOLEAN DEFAULT false,
    is_readonly BOOLEAN DEFAULT false,
    is_custom BOOLEAN DEFAULT false,
    is_system BOOLEAN DEFAULT false,
    default_value JSONB,
    validation_rules JSONB, -- {min: 0, max: 100, pattern: "regex", minLength: 5, maxLength: 255}
    field_options JSONB, -- For select fields: {options: [{value: "a", label: "A"}], allowCustom: false}
    display_order INTEGER DEFAULT 0,
    group_name VARCHAR(100), -- For field grouping in forms
    help_text TEXT,
    placeholder TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entity_type, field_name)
);

-- Field dependencies (show/hide fields based on other field values)
CREATE TABLE IF NOT EXISTS field_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id UUID REFERENCES field_metadata(id) ON DELETE CASCADE,
    depends_on_field_id UUID REFERENCES field_metadata(id) ON DELETE CASCADE,
    condition JSONB NOT NULL, -- {operator: "equals", value: "something"}
    action VARCHAR(50) NOT NULL, -- show, hide, require, readonly, enable, disable
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_field_metadata_entity ON field_metadata(entity_type);
CREATE INDEX IF NOT EXISTS idx_field_metadata_custom ON field_metadata(is_custom) WHERE is_custom = true;
CREATE INDEX IF NOT EXISTS idx_field_metadata_type ON field_metadata(field_type);
CREATE INDEX IF NOT EXISTS idx_field_dependencies_field ON field_dependencies(field_id);
CREATE INDEX IF NOT EXISTS idx_field_dependencies_depends_on ON field_dependencies(depends_on_field_id);

-- Insert entity metadata for existing entities
INSERT INTO entity_metadata (entity_type, label, plural_label, icon, table_name, is_custom)
VALUES
    ('tenants', 'Контрагент', 'Контрагенты', 'building-2', 'tenants', false),
    ('service_requests', 'Заявка ПО ТО', 'Заявки ПО ТО', 'clipboard-list', 'service_requests', false),
    ('installations', 'Монтаж', 'Монтажи', 'wrench', 'installations', false),
    ('projects', 'Проект', 'Проекты', 'folder', 'projects', false),
    ('maintenance_items', 'Объект', 'Объекты', 'map-pin', 'maintenance_items', false),
    ('users', 'Пользователь', 'Пользователи', 'user', 'users', false)
ON CONFLICT (entity_type) DO NOTHING;

-- Insert field metadata for tenants
INSERT INTO field_metadata (entity_type, field_name, field_type, label, is_required, is_system, display_order, group_name)
VALUES
    ('tenants', 'name', 'text', 'Название', true, true, 1, 'basic'),
    ('tenants', 'brandName', 'text', 'Бренд', false, true, 2, 'basic'),
    ('tenants', 'inn', 'text', 'ИНН', false, true, 3, 'basic'),
    ('tenants', 'type', 'select', 'Тип', true, true, 4, 'basic'),
    ('tenants', 'email', 'email', 'Email', false, true, 5, 'contacts'),
    ('tenants', 'phone', 'phone', 'Телефон', false, true, 6, 'contacts')
ON CONFLICT (entity_type, field_name) DO NOTHING;

-- Update type field with options
UPDATE field_metadata
SET field_options = '{"options": [{"value": "tenant", "label": "Арендатор"}, {"value": "contractor", "label": "Заказчик"}], "allowCustom": false}'::jsonb
WHERE entity_type = 'tenants' AND field_name = 'type';

-- Insert field metadata for service_requests
INSERT INTO field_metadata (entity_type, field_name, field_type, label, is_required, is_system, display_order, group_name)
VALUES
    ('service_requests', 'title', 'text', 'Название', true, true, 1, 'basic'),
    ('service_requests', 'description', 'textarea', 'Описание', false, true, 2, 'basic'),
    ('service_requests', 'status', 'select', 'Статус', true, true, 3, 'basic'),
    ('service_requests', 'priority', 'select', 'Приоритет', false, true, 4, 'basic'),
    ('service_requests', 'type', 'select', 'Тип', true, true, 5, 'basic'),
    ('service_requests', 'deadline', 'datetime', 'Дедлайн', false, true, 6, 'scheduling'),
    ('service_requests', 'estimatedHours', 'number', 'Оценка (часы)', false, true, 7, 'scheduling')
ON CONFLICT (entity_type, field_name) DO NOTHING;

-- Update status field with options
UPDATE field_metadata
SET field_options = '{"options": [
    {"value": "new", "label": "Новая"},
    {"value": "in_progress", "label": "В работе"},
    {"value": "done", "label": "Выполнена"},
    {"value": "closed", "label": "Закрыта"},
    {"value": "cancelled", "label": "Отменена"}
], "allowCustom": false}'::jsonb
WHERE entity_type = 'service_requests' AND field_name = 'status';

-- Update priority field with options
UPDATE field_metadata
SET field_options = '{"options": [
    {"value": "low", "label": "Низкий"},
    {"value": "medium", "label": "Средний"},
    {"value": "high", "label": "Высокий"},
    {"value": "urgent", "label": "Срочный"}
], "allowCustom": false}'::jsonb
WHERE entity_type = 'service_requests' AND field_name = 'priority';

-- Update type field with options
UPDATE field_metadata
SET field_options = '{"options": [
    {"value": "maintenance", "label": "Обслуживание"},
    {"value": "repair", "label": "Ремонт"},
    {"value": "inspection", "label": "Проверка"},
    {"value": "emergency", "label": "Аварийная"}
], "allowCustom": false}'::jsonb
WHERE entity_type = 'service_requests' AND field_name = 'type';

-- Insert field metadata for installations
INSERT INTO field_metadata (entity_type, field_name, field_type, label, is_required, is_system, display_order, group_name)
VALUES
    ('installations', 'title', 'text', 'Название', true, true, 1, 'basic'),
    ('installations', 'description', 'textarea', 'Описание', false, true, 2, 'basic'),
    ('installations', 'status', 'select', 'Статус', true, true, 3, 'basic'),
    ('installations', 'type', 'select', 'Тип', true, true, 4, 'basic'),
    ('installations', 'isProject', 'checkbox', 'Это проект', false, true, 5, 'basic'),
    ('installations', 'startDate', 'date', 'Дата начала', false, true, 6, 'scheduling'),
    ('installations', 'endDate', 'date', 'Дата окончания', false, true, 7, 'scheduling')
ON CONFLICT (entity_type, field_name) DO NOTHING;

-- Add validation rules examples
UPDATE field_metadata
SET validation_rules = '{"minLength": 3, "maxLength": 255}'::jsonb
WHERE field_type = 'text' AND field_name IN ('name', 'title');

UPDATE field_metadata
SET validation_rules = '{"min": 0, "max": 1000}'::jsonb
WHERE field_name = 'estimatedHours';

UPDATE field_metadata
SET validation_rules = '{"pattern": "^[0-9]{10,12}$", "message": "ИНН должен содержать 10 или 12 цифр"}'::jsonb
WHERE field_name = 'inn';

-- Add help text
UPDATE field_metadata
SET help_text = 'Юридическое название организации'
WHERE entity_type = 'tenants' AND field_name = 'name';

UPDATE field_metadata
SET help_text = 'Коммерческое название бренда'
WHERE entity_type = 'tenants' AND field_name = 'brandName';

UPDATE field_metadata
SET help_text = 'Идентификационный номер налогоплательщика (10 или 12 цифр)'
WHERE entity_type = 'tenants' AND field_name = 'inn';

-- Add placeholders
UPDATE field_metadata
SET placeholder = 'ООО «Компания»'
WHERE entity_type = 'tenants' AND field_name = 'name';

UPDATE field_metadata
SET placeholder = '1234567890'
WHERE entity_type = 'tenants' AND field_name = 'inn';

UPDATE field_metadata
SET placeholder = 'info@example.com'
WHERE field_type = 'email';

UPDATE field_metadata
SET placeholder = '+7 (495) 000-00-00'
WHERE field_type = 'phone';

COMMENT ON TABLE entity_metadata IS 'Metadata definitions for all entities in the system';
COMMENT ON TABLE field_metadata IS 'Field definitions with types, validation rules, and display configuration';
COMMENT ON TABLE field_dependencies IS 'Field dependencies for conditional display and validation';
