-- Module System Tables
-- Stores module definitions, configurations, and lifecycle state

-- Module registry table
CREATE TABLE IF NOT EXISTS modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    description TEXT,
    version VARCHAR(50) NOT NULL,
    author VARCHAR(200),
    category VARCHAR(50), -- 'core', 'business', 'integration', 'utility'
    status VARCHAR(20) NOT NULL DEFAULT 'disabled', -- 'enabled', 'disabled', 'installing', 'uninstalling'
    is_core BOOLEAN DEFAULT false, -- Core modules cannot be uninstalled
    config JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}', -- Additional module metadata
    installed_at TIMESTAMPTZ,
    enabled_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Module dependencies
CREATE TABLE IF NOT EXISTS module_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    depends_on_module_id UUID NOT NULL REFERENCES modules(id) ON DELETE RESTRICT,
    version_constraint VARCHAR(50), -- e.g., '>=1.0.0', '^2.0.0'
    is_optional BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(module_id, depends_on_module_id)
);

-- Module permissions
CREATE TABLE IF NOT EXISTS module_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    permission_name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50), -- 'read', 'write', 'admin', 'execute'
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(module_id, permission_name)
);

-- Module hooks registry
CREATE TABLE IF NOT EXISTS module_hooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    hook_name VARCHAR(100) NOT NULL,
    hook_type VARCHAR(50) NOT NULL, -- 'action', 'filter', 'event'
    priority INTEGER DEFAULT 10,
    handler_path VARCHAR(500) NOT NULL, -- Path to handler function
    is_active BOOLEAN DEFAULT true,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Module settings (user-configurable)
CREATE TABLE IF NOT EXISTS module_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    setting_key VARCHAR(100) NOT NULL,
    setting_value JSONB,
    setting_type VARCHAR(50), -- 'string', 'number', 'boolean', 'json', 'secret'
    is_encrypted BOOLEAN DEFAULT false,
    description TEXT,
    default_value JSONB,
    validation_rules JSONB, -- JSON schema for validation
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(module_id, setting_key)
);

-- Module routes (API endpoints registered by modules)
CREATE TABLE IF NOT EXISTS module_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    method VARCHAR(10) NOT NULL, -- 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'
    path VARCHAR(500) NOT NULL,
    handler_path VARCHAR(500) NOT NULL,
    middleware JSONB DEFAULT '[]', -- Array of middleware names
    permissions JSONB DEFAULT '[]', -- Required permissions
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(module_id, method, path)
);

-- Module UI components (frontend components registered by modules)
CREATE TABLE IF NOT EXISTS module_ui_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    component_name VARCHAR(100) NOT NULL,
    component_type VARCHAR(50) NOT NULL, -- 'page', 'widget', 'menu', 'tab', 'action'
    mount_point VARCHAR(100), -- Where to mount the component
    component_path VARCHAR(500) NOT NULL,
    props JSONB DEFAULT '{}',
    permissions JSONB DEFAULT '[]',
    order_index INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(module_id, component_name)
);

-- Module events log
CREATE TABLE IF NOT EXISTS module_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID REFERENCES modules(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL, -- 'installed', 'enabled', 'disabled', 'uninstalled', 'updated', 'error'
    event_data JSONB DEFAULT '{}',
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Plugin marketplace (for future plugin discovery)
CREATE TABLE IF NOT EXISTS plugin_marketplace (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    description TEXT,
    author VARCHAR(200),
    author_url VARCHAR(500),
    repository_url VARCHAR(500),
    documentation_url VARCHAR(500),
    icon_url VARCHAR(500),
    latest_version VARCHAR(50) NOT NULL,
    min_platform_version VARCHAR(50),
    category VARCHAR(50),
    tags JSONB DEFAULT '[]',
    downloads INTEGER DEFAULT 0,
    rating DECIMAL(3,2),
    is_verified BOOLEAN DEFAULT false,
    is_featured BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_modules_status ON modules(status);
CREATE INDEX IF NOT EXISTS idx_modules_category ON modules(category);
CREATE INDEX IF NOT EXISTS idx_modules_is_core ON modules(is_core);
CREATE INDEX IF NOT EXISTS idx_module_dependencies_module ON module_dependencies(module_id);
CREATE INDEX IF NOT EXISTS idx_module_dependencies_depends ON module_dependencies(depends_on_module_id);
CREATE INDEX IF NOT EXISTS idx_module_hooks_module ON module_hooks(module_id);
CREATE INDEX IF NOT EXISTS idx_module_hooks_name ON module_hooks(hook_name);
CREATE INDEX IF NOT EXISTS idx_module_hooks_active ON module_hooks(is_active);
CREATE INDEX IF NOT EXISTS idx_module_settings_module ON module_settings(module_id);
CREATE INDEX IF NOT EXISTS idx_module_routes_module ON module_routes(module_id);
CREATE INDEX IF NOT EXISTS idx_module_ui_components_module ON module_ui_components(module_id);
CREATE INDEX IF NOT EXISTS idx_module_ui_components_type ON module_ui_components(component_type);
CREATE INDEX IF NOT EXISTS idx_module_events_module ON module_events(module_id);
CREATE INDEX IF NOT EXISTS idx_module_events_type ON module_events(event_type);
CREATE INDEX IF NOT EXISTS idx_module_events_created ON module_events(created_at);
CREATE INDEX IF NOT EXISTS idx_plugin_marketplace_category ON plugin_marketplace(category);
CREATE INDEX IF NOT EXISTS idx_plugin_marketplace_featured ON plugin_marketplace(is_featured);

-- Insert core modules
INSERT INTO modules (name, display_name, description, version, category, status, is_core, installed_at, enabled_at) VALUES
('core.projects', 'Projects', 'Project management module', '1.0.0', 'core', 'enabled', true, now(), now()),
('core.installations', 'Installations', 'Installation tracking and management', '1.0.0', 'core', 'enabled', true, now(), now()),
('core.service_requests', 'Service Requests', 'Service request and ticket management', '1.0.0', 'core', 'enabled', true, now(), now()),
('core.tenants', 'Tenants', 'Multi-tenant management', '1.0.0', 'core', 'enabled', true, now(), now()),
('core.users', 'Users & Authentication', 'User management and authentication', '1.0.0', 'core', 'enabled', true, now(), now()),
('core.files', 'File Management', 'File upload and storage', '1.0.0', 'core', 'enabled', true, now(), now())
ON CONFLICT (name) DO NOTHING;

-- Insert module permissions for core modules
INSERT INTO module_permissions (module_id, permission_name, description, category)
SELECT m.id, 'projects.read', 'View projects', 'read' FROM modules m WHERE m.name = 'core.projects'
UNION ALL
SELECT m.id, 'projects.write', 'Create and edit projects', 'write' FROM modules m WHERE m.name = 'core.projects'
UNION ALL
SELECT m.id, 'projects.delete', 'Delete projects', 'admin' FROM modules m WHERE m.name = 'core.projects'
UNION ALL
SELECT m.id, 'installations.read', 'View installations', 'read' FROM modules m WHERE m.name = 'core.installations'
UNION ALL
SELECT m.id, 'installations.write', 'Create and edit installations', 'write' FROM modules m WHERE m.name = 'core.installations'
UNION ALL
SELECT m.id, 'installations.delete', 'Delete installations', 'admin' FROM modules m WHERE m.name = 'core.installations'
UNION ALL
SELECT m.id, 'service_requests.read', 'View service requests', 'read' FROM modules m WHERE m.name = 'core.service_requests'
UNION ALL
SELECT m.id, 'service_requests.write', 'Create and edit service requests', 'write' FROM modules m WHERE m.name = 'core.service_requests'
UNION ALL
SELECT m.id, 'service_requests.delete', 'Delete service requests', 'admin' FROM modules m WHERE m.name = 'core.service_requests'
UNION ALL
SELECT m.id, 'tenants.read', 'View tenants', 'read' FROM modules m WHERE m.name = 'core.tenants'
UNION ALL
SELECT m.id, 'tenants.write', 'Create and edit tenants', 'write' FROM modules m WHERE m.name = 'core.tenants'
UNION ALL
SELECT m.id, 'tenants.delete', 'Delete tenants', 'admin' FROM modules m WHERE m.name = 'core.tenants'
ON CONFLICT (module_id, permission_name) DO NOTHING;
