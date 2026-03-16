-- Advanced Relationship Management
-- Implements many-to-many relations, polymorphic relations, relationship metadata, and history tracking

-- Entity relationships table (polymorphic many-to-many)
CREATE TABLE IF NOT EXISTS entity_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_entity_type VARCHAR(100) NOT NULL,
    source_entity_id UUID NOT NULL,
    target_entity_type VARCHAR(100) NOT NULL,
    target_entity_id UUID NOT NULL,
    relationship_type VARCHAR(100) NOT NULL, -- e.g., 'parent_child', 'related_to', 'depends_on', 'blocks', 'duplicates'
    relationship_strength INTEGER DEFAULT 50, -- 0-100 scale for visualization
    is_bidirectional BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT unique_relationship UNIQUE(source_entity_type, source_entity_id, target_entity_type, target_entity_id, relationship_type)
);

-- Relationship history tracking
CREATE TABLE IF NOT EXISTS relationship_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id UUID REFERENCES entity_relationships(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- 'created', 'updated', 'deleted', 'restored'
    changed_fields JSONB,
    old_values JSONB,
    new_values JSONB,
    changed_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
    changed_by_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relationship types configuration
CREATE TABLE IF NOT EXISTS relationship_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    source_entity_types TEXT[], -- allowed source entity types
    target_entity_types TEXT[], -- allowed target entity types
    is_bidirectional BOOLEAN DEFAULT true,
    default_strength INTEGER DEFAULT 50,
    icon VARCHAR(50),
    color VARCHAR(50),
    is_system BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relationship insights/analytics
CREATE TABLE IF NOT EXISTS relationship_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    total_relationships INTEGER DEFAULT 0,
    incoming_relationships INTEGER DEFAULT 0,
    outgoing_relationships INTEGER DEFAULT 0,
    relationship_types_count JSONB DEFAULT '{}'::jsonb, -- count by type
    most_connected_entities JSONB DEFAULT '[]'::jsonb,
    last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entity_type, entity_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_relationships_source ON entity_relationships(source_entity_type, source_entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relationships_target ON entity_relationships(target_entity_type, target_entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relationships_type ON entity_relationships(relationship_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relationships_created ON entity_relationships(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationships_bidirectional ON entity_relationships(is_bidirectional) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relationship_history_rel ON relationship_history(relationship_id);
CREATE INDEX IF NOT EXISTS idx_relationship_history_created ON relationship_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationship_insights_entity ON relationship_insights(entity_type, entity_id);

-- Insert default relationship types
INSERT INTO relationship_types (name, display_name, description, source_entity_types, target_entity_types, is_bidirectional, default_strength, icon, color, is_system)
VALUES
    ('related_to', 'Связан с', 'Общая связь между объектами', ARRAY['*'], ARRAY['*'], true, 50, 'link', 'blue', true),
    ('parent_child', 'Родитель-потомок', 'Иерархическая связь', ARRAY['*'], ARRAY['*'], false, 80, 'git-branch', 'purple', true),
    ('depends_on', 'Зависит от', 'Зависимость между объектами', ARRAY['*'], ARRAY['*'], false, 70, 'arrow-right', 'orange', true),
    ('blocks', 'Блокирует', 'Блокирующая связь', ARRAY['*'], ARRAY['*'], false, 90, 'alert-circle', 'red', true),
    ('duplicates', 'Дубликат', 'Дублирующие записи', ARRAY['*'], ARRAY['*'], true, 100, 'copy', 'yellow', true),
    ('references', 'Ссылается на', 'Ссылка на другой объект', ARRAY['*'], ARRAY['*'], false, 40, 'external-link', 'green', true),
    ('assigned_to', 'Назначен на', 'Назначение объекта', ARRAY['service_request', 'project', 'maintenance_plan'], ARRAY['app_users'], false, 60, 'user', 'indigo', true),
    ('part_of', 'Часть', 'Является частью', ARRAY['*'], ARRAY['*'], false, 75, 'package', 'teal', true),
    ('follows', 'Следует за', 'Последовательная связь', ARRAY['*'], ARRAY['*'], false, 55, 'arrow-down', 'cyan', true),
    ('similar_to', 'Похож на', 'Схожие объекты', ARRAY['*'], ARRAY['*'], true, 30, 'shuffle', 'gray', true)
ON CONFLICT (name) DO NOTHING;

-- Function to track relationship changes
CREATE OR REPLACE FUNCTION track_relationship_change()
RETURNS TRIGGER AS $$
DECLARE
    v_action VARCHAR(50);
    v_changed_fields JSONB := '{}'::jsonb;
    v_old_values JSONB := '{}'::jsonb;
    v_new_values JSONB := '{}'::jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'created';
        v_new_values := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'updated';

        -- Track changed fields
        IF OLD.relationship_type != NEW.relationship_type THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('relationship_type', true);
            v_old_values := v_old_values || jsonb_build_object('relationship_type', OLD.relationship_type);
            v_new_values := v_new_values || jsonb_build_object('relationship_type', NEW.relationship_type);
        END IF;

        IF OLD.relationship_strength != NEW.relationship_strength THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('relationship_strength', true);
            v_old_values := v_old_values || jsonb_build_object('relationship_strength', OLD.relationship_strength);
            v_new_values := v_new_values || jsonb_build_object('relationship_strength', NEW.relationship_strength);
        END IF;

        IF OLD.metadata != NEW.metadata THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('metadata', true);
            v_old_values := v_old_values || jsonb_build_object('metadata', OLD.metadata);
            v_new_values := v_new_values || jsonb_build_object('metadata', NEW.metadata);
        END IF;

        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
            v_action := 'deleted';
        ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
            v_action := 'restored';
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'deleted';
        v_old_values := to_jsonb(OLD);
    END IF;

    -- Insert history record
    INSERT INTO relationship_history (
        relationship_id,
        action,
        changed_fields,
        old_values,
        new_values,
        changed_by_user_id,
        changed_by_name
    ) VALUES (
        COALESCE(NEW.id, OLD.id),
        v_action,
        v_changed_fields,
        v_old_values,
        v_new_values,
        COALESCE(NEW.created_by_user_id, OLD.created_by_user_id),
        (SELECT name FROM app_users WHERE id = COALESCE(NEW.created_by_user_id, OLD.created_by_user_id))
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for relationship history
DROP TRIGGER IF EXISTS trigger_track_relationship_change ON entity_relationships;
CREATE TRIGGER trigger_track_relationship_change
    AFTER INSERT OR UPDATE OR DELETE ON entity_relationships
    FOR EACH ROW
    EXECUTE FUNCTION track_relationship_change();

-- Function to update relationship insights
CREATE OR REPLACE FUNCTION update_relationship_insights(
    p_entity_type VARCHAR(100),
    p_entity_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_total INTEGER;
    v_incoming INTEGER;
    v_outgoing INTEGER;
    v_types_count JSONB;
    v_most_connected JSONB;
BEGIN
    -- Count total relationships
    SELECT COUNT(*) INTO v_total
    FROM entity_relationships
    WHERE deleted_at IS NULL
    AND (
        (source_entity_type = p_entity_type AND source_entity_id = p_entity_id)
        OR (target_entity_type = p_entity_type AND target_entity_id = p_entity_id)
    );

    -- Count incoming relationships
    SELECT COUNT(*) INTO v_incoming
    FROM entity_relationships
    WHERE deleted_at IS NULL
    AND target_entity_type = p_entity_type
    AND target_entity_id = p_entity_id;

    -- Count outgoing relationships
    SELECT COUNT(*) INTO v_outgoing
    FROM entity_relationships
    WHERE deleted_at IS NULL
    AND source_entity_type = p_entity_type
    AND source_entity_id = p_entity_id;

    -- Count by relationship type
    SELECT jsonb_object_agg(relationship_type, cnt) INTO v_types_count
    FROM (
        SELECT relationship_type, COUNT(*) as cnt
        FROM entity_relationships
        WHERE deleted_at IS NULL
        AND (
            (source_entity_type = p_entity_type AND source_entity_id = p_entity_id)
            OR (target_entity_type = p_entity_type AND target_entity_id = p_entity_id)
        )
        GROUP BY relationship_type
    ) sub;

    -- Get most connected entities
    SELECT jsonb_agg(row_to_json(t)) INTO v_most_connected
    FROM (
        SELECT
            CASE
                WHEN source_entity_type = p_entity_type AND source_entity_id = p_entity_id
                THEN target_entity_type
                ELSE source_entity_type
            END as entity_type,
            CASE
                WHEN source_entity_type = p_entity_type AND source_entity_id = p_entity_id
                THEN target_entity_id
                ELSE source_entity_id
            END as entity_id,
            COUNT(*) as connection_count
        FROM entity_relationships
        WHERE deleted_at IS NULL
        AND (
            (source_entity_type = p_entity_type AND source_entity_id = p_entity_id)
            OR (target_entity_type = p_entity_type AND target_entity_id = p_entity_id)
        )
        GROUP BY entity_type, entity_id
        ORDER BY connection_count DESC
        LIMIT 10
    ) t;

    -- Upsert insights
    INSERT INTO relationship_insights (
        entity_type,
        entity_id,
        total_relationships,
        incoming_relationships,
        outgoing_relationships,
        relationship_types_count,
        most_connected_entities,
        last_calculated_at
    ) VALUES (
        p_entity_type,
        p_entity_id,
        v_total,
        v_incoming,
        v_outgoing,
        COALESCE(v_types_count, '{}'::jsonb),
        COALESCE(v_most_connected, '[]'::jsonb),
        NOW()
    )
    ON CONFLICT (entity_type, entity_id)
    DO UPDATE SET
        total_relationships = EXCLUDED.total_relationships,
        incoming_relationships = EXCLUDED.incoming_relationships,
        outgoing_relationships = EXCLUDED.outgoing_relationships,
        relationship_types_count = EXCLUDED.relationship_types_count,
        most_connected_entities = EXCLUDED.most_connected_entities,
        last_calculated_at = EXCLUDED.last_calculated_at;
END;
$$ LANGUAGE plpgsql;

-- Function to find related records (recursive)
CREATE OR REPLACE FUNCTION find_related_records(
    p_entity_type VARCHAR(100),
    p_entity_id UUID,
    p_max_depth INTEGER DEFAULT 2
)
RETURNS TABLE(
    entity_type VARCHAR(100),
    entity_id UUID,
    relationship_type VARCHAR(100),
    depth INTEGER,
    path TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE related AS (
        -- Base case: direct relationships
        SELECT
            r.target_entity_type as entity_type,
            r.target_entity_id as entity_id,
            r.relationship_type,
            1 as depth,
            ARRAY[p_entity_type || ':' || p_entity_id::text, r.target_entity_type || ':' || r.target_entity_id::text] as path
        FROM entity_relationships r
        WHERE r.source_entity_type = p_entity_type
        AND r.source_entity_id = p_entity_id
        AND r.deleted_at IS NULL

        UNION ALL

        SELECT
            r.source_entity_type as entity_type,
            r.source_entity_id as entity_id,
            r.relationship_type,
            1 as depth,
            ARRAY[p_entity_type || ':' || p_entity_id::text, r.source_entity_type || ':' || r.source_entity_id::text] as path
        FROM entity_relationships r
        WHERE r.target_entity_type = p_entity_type
        AND r.target_entity_id = p_entity_id
        AND r.is_bidirectional = true
        AND r.deleted_at IS NULL

        UNION ALL

        -- Recursive case: relationships of related entities
        SELECT
            r.target_entity_type,
            r.target_entity_id,
            r.relationship_type,
            rel.depth + 1,
            rel.path || (r.target_entity_type || ':' || r.target_entity_id::text)
        FROM related rel
        JOIN entity_relationships r ON (
            r.source_entity_type = rel.entity_type
            AND r.source_entity_id = rel.entity_id
            AND r.deleted_at IS NULL
        )
        WHERE rel.depth < p_max_depth
        AND NOT (r.target_entity_type || ':' || r.target_entity_id::text) = ANY(rel.path)
    )
    SELECT DISTINCT ON (entity_type, entity_id)
        entity_type,
        entity_id,
        relationship_type,
        depth,
        path
    FROM related
    ORDER BY entity_type, entity_id, depth;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE entity_relationships IS 'Polymorphic many-to-many relationships between entities';
COMMENT ON TABLE relationship_history IS 'History tracking for relationship changes';
COMMENT ON TABLE relationship_types IS 'Configuration for relationship types';
COMMENT ON TABLE relationship_insights IS 'Cached analytics for entity relationships';
COMMENT ON FUNCTION update_relationship_insights IS 'Updates relationship analytics for an entity';
COMMENT ON FUNCTION find_related_records IS 'Recursively finds related records up to specified depth';
