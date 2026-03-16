-- Advanced Saved Views System
-- Implements filter groups, advanced operators, view visibility, and column customization

-- Enhanced saved views table
CREATE TABLE IF NOT EXISTS saved_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    entity_type VARCHAR(100) NOT NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'private', -- private, public, shared
    created_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT false,
    is_pinned BOOLEAN DEFAULT false,
    is_system BOOLEAN DEFAULT false, -- System-provided views
    sort_field VARCHAR(100),
    sort_direction VARCHAR(10), -- asc, desc
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Filter groups (AND/OR logic)
CREATE TABLE IF NOT EXISTS view_filter_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    view_id UUID REFERENCES saved_views(id) ON DELETE CASCADE,
    parent_group_id UUID REFERENCES view_filter_groups(id) ON DELETE CASCADE,
    logic_operator VARCHAR(10) NOT NULL DEFAULT 'AND', -- AND, OR
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual filters
CREATE TABLE IF NOT EXISTS view_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filter_group_id UUID REFERENCES view_filter_groups(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    operator VARCHAR(50) NOT NULL, -- equals, not_equals, contains, in, not_in, greater_than, less_than, is_null, is_not_null, starts_with, ends_with
    value JSONB,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Column configuration
CREATE TABLE IF NOT EXISTS view_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    view_id UUID REFERENCES saved_views(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    label VARCHAR(255),
    width INTEGER,
    is_visible BOOLEAN DEFAULT true,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- View sharing
CREATE TABLE IF NOT EXISTS view_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    view_id UUID REFERENCES saved_views(id) ON DELETE CASCADE,
    shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    can_edit BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(view_id, shared_with_user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_saved_views_entity_type ON saved_views(entity_type);
CREATE INDEX IF NOT EXISTS idx_saved_views_created_by ON saved_views(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_visibility ON saved_views(visibility);
CREATE INDEX IF NOT EXISTS idx_saved_views_pinned ON saved_views(is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_view_filter_groups_view ON view_filter_groups(view_id);
CREATE INDEX IF NOT EXISTS idx_view_filter_groups_parent ON view_filter_groups(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_view_filters_group ON view_filters(filter_group_id);
CREATE INDEX IF NOT EXISTS idx_view_columns_view ON view_columns(view_id);
CREATE INDEX IF NOT EXISTS idx_view_shares_view ON view_shares(view_id);
CREATE INDEX IF NOT EXISTS idx_view_shares_user ON view_shares(shared_with_user_id);

-- Insert default system views for tenants
INSERT INTO saved_views (name, description, entity_type, visibility, is_system, is_default, created_at)
VALUES
    ('Все контрагенты', 'Все контрагенты без фильтров', 'tenants', 'public', true, true, NOW()),
    ('Арендаторы', 'Только арендаторы', 'tenants', 'public', true, false, NOW()),
    ('Заказчики', 'Только заказчики (монтаж)', 'tenants', 'public', true, false, NOW())
ON CONFLICT DO NOTHING;

-- Create filter groups for system views
DO $$
DECLARE
    v_tenants_view_id UUID;
    v_contractors_view_id UUID;
    v_filter_group_id UUID;
BEGIN
    -- Get view IDs
    SELECT id INTO v_tenants_view_id FROM saved_views WHERE entity_type = 'tenants' AND name = 'Арендаторы' AND is_system = true;
    SELECT id INTO v_contractors_view_id FROM saved_views WHERE entity_type = 'tenants' AND name = 'Заказчики' AND is_system = true;

    -- Create filter group for Арендаторы view
    IF v_tenants_view_id IS NOT NULL THEN
        INSERT INTO view_filter_groups (view_id, logic_operator, position)
        VALUES (v_tenants_view_id, 'AND', 0)
        RETURNING id INTO v_filter_group_id;

        INSERT INTO view_filters (filter_group_id, field_name, operator, value, position)
        VALUES (v_filter_group_id, 'type', 'equals', '"tenant"'::jsonb, 0);
    END IF;

    -- Create filter group for Заказчики view
    IF v_contractors_view_id IS NOT NULL THEN
        INSERT INTO view_filter_groups (view_id, logic_operator, position)
        VALUES (v_contractors_view_id, 'AND', 0)
        RETURNING id INTO v_filter_group_id;

        INSERT INTO view_filters (filter_group_id, field_name, operator, value, position)
        VALUES (v_filter_group_id, 'type', 'equals', '"contractor"'::jsonb, 0);
    END IF;
END $$;

-- Insert default system views for service requests
INSERT INTO saved_views (name, description, entity_type, visibility, is_system, is_default, created_at)
VALUES
    ('Все заявки', 'Все заявки ПО ТО', 'service_requests', 'public', true, true, NOW()),
    ('Новые заявки', 'Заявки со статусом "Новая"', 'service_requests', 'public', true, false, NOW()),
    ('В работе', 'Заявки в работе', 'service_requests', 'public', true, false, NOW()),
    ('Просроченные', 'Заявки с просроченным дедлайном', 'service_requests', 'public', true, false, NOW())
ON CONFLICT DO NOTHING;

-- Create filter groups for service request views
DO $$
DECLARE
    v_new_view_id UUID;
    v_in_progress_view_id UUID;
    v_overdue_view_id UUID;
    v_filter_group_id UUID;
BEGIN
    SELECT id INTO v_new_view_id FROM saved_views WHERE entity_type = 'service_requests' AND name = 'Новые заявки' AND is_system = true;
    SELECT id INTO v_in_progress_view_id FROM saved_views WHERE entity_type = 'service_requests' AND name = 'В работе' AND is_system = true;
    SELECT id INTO v_overdue_view_id FROM saved_views WHERE entity_type = 'service_requests' AND name = 'Просроченные' AND is_system = true;

    IF v_new_view_id IS NOT NULL THEN
        INSERT INTO view_filter_groups (view_id, logic_operator, position)
        VALUES (v_new_view_id, 'AND', 0)
        RETURNING id INTO v_filter_group_id;

        INSERT INTO view_filters (filter_group_id, field_name, operator, value, position)
        VALUES (v_filter_group_id, 'status', 'equals', '"new"'::jsonb, 0);
    END IF;

    IF v_in_progress_view_id IS NOT NULL THEN
        INSERT INTO view_filter_groups (view_id, logic_operator, position)
        VALUES (v_in_progress_view_id, 'AND', 0)
        RETURNING id INTO v_filter_group_id;

        INSERT INTO view_filters (filter_group_id, field_name, operator, value, position)
        VALUES (v_filter_group_id, 'status', 'equals', '"in_progress"'::jsonb, 0);
    END IF;

    IF v_overdue_view_id IS NOT NULL THEN
        INSERT INTO view_filter_groups (view_id, logic_operator, position)
        VALUES (v_overdue_view_id, 'AND', 0)
        RETURNING id INTO v_filter_group_id;

        INSERT INTO view_filters (filter_group_id, field_name, operator, value, position)
        VALUES (v_filter_group_id, 'deadline', 'less_than', 'NOW()'::jsonb, 0);
    END IF;
END $$;

COMMENT ON TABLE saved_views IS 'User-defined and system views with filters and column configuration';
COMMENT ON TABLE view_filter_groups IS 'Filter groups supporting AND/OR logic and nesting';
COMMENT ON TABLE view_filters IS 'Individual filters with advanced operators';
COMMENT ON TABLE view_columns IS 'Column configuration per view (visibility, width, order)';
COMMENT ON TABLE view_shares IS 'View sharing between users';
