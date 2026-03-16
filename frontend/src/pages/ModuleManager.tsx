import { useState, useEffect } from 'react';
import { Search, Package, Power, PowerOff, Settings, Trash2, CheckCircle, Loader } from 'lucide-react';
import { api } from '@/api/client';

interface Module {
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
    installed_at?: string;
    enabled_at?: string;
    disabled_at?: string;
    created_at: string;
    updated_at: string;
}

const categoryColors = {
    core: 'bg-blue-100 text-blue-800',
    business: 'bg-green-100 text-green-800',
    integration: 'bg-purple-100 text-purple-800',
    utility: 'bg-gray-100 text-gray-800',
};

const statusIcons = {
    enabled: <CheckCircle className="w-5 h-5 text-green-600" />,
    disabled: <PowerOff className="w-5 h-5 text-gray-400" />,
    installing: <Loader className="w-5 h-5 text-blue-600 animate-spin" />,
    uninstalling: <Loader className="w-5 h-5 text-red-600 animate-spin" />,
};

export default function ModuleManager() {
    const [modules, setModules] = useState<Module[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState<string>('all');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [selectedModule, setSelectedModule] = useState<Module | null>(null);
    const [showSettings, setShowSettings] = useState(false);

    useEffect(() => {
        fetchModules();
    }, [filterCategory, filterStatus]);

    const fetchModules = async () => {
        try {
            const params = new URLSearchParams();
            if (filterCategory !== 'all') params.append('category', filterCategory);
            if (filterStatus !== 'all') params.append('status', filterStatus);

            const data = await api.get(`/modules?${params}`) as any;
            setModules(data.modules);
        } catch (error) {
            console.error('Failed to fetch modules:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleEnableModule = async (moduleId: string) => {
        try {
            await api.post(`/modules/${moduleId}/enable`);
            fetchModules();
        } catch (error: any) {
            console.error('Failed to enable module:', error);
            alert(`Failed to enable module: ${error.message || 'Unknown error'}`);
        }
    };

    const handleDisableModule = async (moduleId: string) => {
        if (!confirm('Are you sure you want to disable this module?')) return;

        try {
            await api.post(`/modules/${moduleId}/disable`);
            fetchModules();
        } catch (error: any) {
            console.error('Failed to disable module:', error);
            alert(`Failed to disable module: ${error.message || 'Unknown error'}`);
        }
    };

    const handleUninstallModule = async (moduleId: string) => {
        if (!confirm('Are you sure you want to uninstall this module? This action cannot be undone.')) return;

        try {
            await api.delete(`/modules/${moduleId}`);
            fetchModules();
        } catch (error: any) {
            console.error('Failed to uninstall module:', error);
            alert(`Failed to uninstall module: ${error.message || 'Unknown error'}`);
        }
    };

    const filteredModules = modules.filter(module =>
        module.display_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        module.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        module.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Управление модулями</h1>
                <p className="text-gray-600">Управление установленными модулями и плагинами</p>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="Поиск модулей..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        <option value="all">Все категории</option>
                        <option value="core">Основные</option>
                        <option value="business">Бизнес</option>
                        <option value="integration">Интеграции</option>
                        <option value="utility">Утилиты</option>
                    </select>

                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        <option value="all">Все статусы</option>
                        <option value="enabled">Включён</option>
                        <option value="disabled">Отключён</option>
                    </select>
                </div>
            </div>

            {/* Module Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredModules.map((module) => (
                    <div
                        key={module.id}
                        className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
                    >
                        <div className="p-6">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center space-x-3">
                                    <div className="p-2 bg-blue-100 rounded-lg">
                                        <Package className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{module.display_name}</h3>
                                        <p className="text-sm text-gray-500">v{module.version}</p>
                                    </div>
                                </div>
                                {statusIcons[module.status]}
                            </div>

                            <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                                {module.description || 'Описание отсутствует'}
                            </p>

                            <div className="flex items-center justify-between mb-4">
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${categoryColors[module.category]}`}>
                                    {module.category}
                                </span>
                                {module.is_core && (
                                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
                                        Core
                                    </span>
                                )}
                            </div>

                            {module.author && (
                                <p className="text-xs text-gray-500 mb-4">By {module.author}</p>
                            )}

                            {/* Actions */}
                            <div className="flex items-center space-x-2">
                                {module.status === 'disabled' && (
                                    <button
                                        onClick={() => handleEnableModule(module.id)}
                                        className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                                    >
                                        <Power className="w-4 h-4" />
                                        <span>Включить</span>
                                    </button>
                                )}

                                {module.status === 'enabled' && !module.is_core && (
                                    <button
                                        onClick={() => handleDisableModule(module.id)}
                                        className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
                                    >
                                        <PowerOff className="w-4 h-4" />
                                        <span>Отключить</span>
                                    </button>
                                )}

                                <button
                                    onClick={() => {
                                        setSelectedModule(module);
                                        setShowSettings(true);
                                    }}
                                    className="px-3 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                                    title="Settings"
                                >
                                    <Settings className="w-4 h-4" />
                                </button>

                                {!module.is_core && module.status === 'disabled' && (
                                    <button
                                        onClick={() => handleUninstallModule(module.id)}
                                        className="px-3 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                                        title="Uninstall"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {filteredModules.length === 0 && (
                <div className="text-center py-12">
                    <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Модули не найдены</h3>
                    <p className="text-gray-600">Попробуйте изменить параметры поиска или фильтры</p>
                </div>
            )}

            {/* Settings Modal */}
            {showSettings && selectedModule && (
                <ModuleSettingsModal
                    module={selectedModule}
                    onClose={() => {
                        setShowSettings(false);
                        setSelectedModule(null);
                    }}
                    onUpdate={fetchModules}
                />
            )}
        </div>
    );
}

interface ModuleSettingsModalProps {
    module: Module;
    onClose: () => void;
    onUpdate: () => void;
}

function ModuleSettingsModal({ module, onClose, onUpdate: _onUpdate }: ModuleSettingsModalProps) {
    const [settings, setSettings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSettings();
    }, [module.id]);

    const fetchSettings = async () => {
        try {
            const data = await api.get(`/modules/${module.id}/settings`) as any;
            setSettings(data.settings);
        } catch (error) {
            console.error('Failed to fetch settings:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900">Настройки: {module.display_name}</h2>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600"
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader className="w-6 h-6 animate-spin text-blue-600" />
                        </div>
                    ) : settings.length > 0 ? (
                        <div className="space-y-4">
                            {settings.map((setting) => (
                                <div key={setting.id} className="border-b border-gray-200 pb-4">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {setting.setting_key}
                                    </label>
                                    {setting.description && (
                                        <p className="text-xs text-gray-500 mb-2">{setting.description}</p>
                                    )}
                                    <div className="text-sm text-gray-600">
                                        {JSON.stringify(setting.setting_value)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <Settings className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                            <p className="text-gray-600">Нет доступных настроек для этого модуля</p>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-gray-200 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
}
