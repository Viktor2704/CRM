// Module System Types

export interface Module {
    id: string;
    name: string;
    display_name: string;
    description?: string;
    version: string;
    author?: string;
    category: 'core' | 'business' | 'integration' | 'utility';
    status: 'enabled' | 'disabled' | 'installing' | 'uninstalling';
    is_core: boolean;
    config: Record<string, any>;
    metadata: Record<string, any>;
    installed_at?: Date;
    enabled_at?: Date;
    disabled_at?: Date;
    created_at: Date;
    updated_at: Date;
}

export interface ModuleDependency {
    id: string;
    module_id: string;
    depends_on_module_id: string;
    version_constraint?: string;
    is_optional: boolean;
    created_at: Date;
}

export interface ModulePermission {
    id: string;
    module_id: string;
    permission_name: string;
    description?: string;
    category: 'read' | 'write' | 'admin' | 'execute';
    created_at: Date;
}

export interface ModuleHook {
    id: string;
    module_id: string;
    hook_name: string;
    hook_type: 'action' | 'filter' | 'event';
    priority: number;
    handler_path: string;
    is_active: boolean;
    config: Record<string, any>;
    created_at: Date;
    updated_at: Date;
}

export interface ModuleSetting {
    id: string;
    module_id: string;
    setting_key: string;
    setting_value: any;
    setting_type: 'string' | 'number' | 'boolean' | 'json' | 'secret';
    is_encrypted: boolean;
    description?: string;
    default_value?: any;
    validation_rules?: Record<string, any>;
    created_at: Date;
    updated_at: Date;
}

export interface ModuleRoute {
    id: string;
    module_id: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    handler_path: string;
    middleware: string[];
    permissions: string[];
    is_public: boolean;
    created_at: Date;
}

export interface ModuleUIComponent {
    id: string;
    module_id: string;
    component_name: string;
    component_type: 'page' | 'widget' | 'menu' | 'tab' | 'action';
    mount_point?: string;
    component_path: string;
    props: Record<string, any>;
    permissions: string[];
    order_index: number;
    is_active: boolean;
    created_at: Date;
}

export interface ModuleEvent {
    id: string;
    module_id?: string;
    event_type: 'installed' | 'enabled' | 'disabled' | 'uninstalled' | 'updated' | 'error';
    event_data: Record<string, any>;
    user_id?: string;
    created_at: Date;
}

export interface PluginMarketplaceEntry {
    id: string;
    module_name: string;
    display_name: string;
    description?: string;
    author?: string;
    author_url?: string;
    repository_url?: string;
    documentation_url?: string;
    icon_url?: string;
    latest_version: string;
    min_platform_version?: string;
    category?: string;
    tags: string[];
    downloads: number;
    rating?: number;
    is_verified: boolean;
    is_featured: boolean;
    metadata: Record<string, any>;
    created_at: Date;
    updated_at: Date;
}

// Module Definition (for module developers)
export interface ModuleDefinition {
    name: string;
    display_name: string;
    description?: string;
    version: string;
    author?: string;
    category: 'core' | 'business' | 'integration' | 'utility';
    dependencies?: ModuleDependencyDefinition[];
    permissions?: ModulePermissionDefinition[];
    hooks?: ModuleHookDefinition[];
    settings?: ModuleSettingDefinition[];
    routes?: ModuleRouteDefinition[];
    uiComponents?: ModuleUIComponentDefinition[];
    onInstall?: () => Promise<void>;
    onUninstall?: () => Promise<void>;
    onEnable?: () => Promise<void>;
    onDisable?: () => Promise<void>;
}

export interface ModuleDependencyDefinition {
    module: string;
    version?: string;
    optional?: boolean;
}

export interface ModulePermissionDefinition {
    name: string;
    description?: string;
    category: 'read' | 'write' | 'admin' | 'execute';
}

export interface ModuleHookDefinition {
    name: string;
    type: 'action' | 'filter' | 'event';
    priority?: number;
    handler: string;
    config?: Record<string, any>;
}

export interface ModuleSettingDefinition {
    key: string;
    type: 'string' | 'number' | 'boolean' | 'json' | 'secret';
    defaultValue?: any;
    description?: string;
    encrypted?: boolean;
    validation?: Record<string, any>;
}

export interface ModuleRouteDefinition {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    handler: string;
    middleware?: string[];
    permissions?: string[];
    public?: boolean;
}

export interface ModuleUIComponentDefinition {
    name: string;
    type: 'page' | 'widget' | 'menu' | 'tab' | 'action';
    mountPoint?: string;
    component: string;
    props?: Record<string, any>;
    permissions?: string[];
    order?: number;
}

// Hook System Types
export type HookHandler<T = any> = (data: T, context?: HookContext) => Promise<T> | T;

export interface HookContext {
    module: string;
    user?: any;
    metadata?: Record<string, any>;
}

export interface HookRegistration {
    module: string;
    hookName: string;
    handler: HookHandler;
    priority: number;
}
