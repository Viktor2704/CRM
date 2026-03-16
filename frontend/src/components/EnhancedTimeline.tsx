import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import {
  Clock,
  FileUp,
  MessageSquare,
  UserPlus,
  AlertCircle,
  CheckCircle,
  Info,
  AlertTriangle,
  Pin,
  Tag,
  Edit2,
  Search,
  Mail,
  Paperclip,
} from 'lucide-react';

interface EnhancedActivity {
  id: string;
  entityType: string;
  entityId: string;
  activityType: string;
  activitySubtype?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actorUserId?: string;
  actorName: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  title: string;
  description: string;
  metadata?: Record<string, any>;
  isPinned: boolean;
  tags: string[];
  createdAt: string;
  email?: {
    subject: string;
    from: string;
    to: string[];
    preview: string;
    hasAttachments: boolean;
  };
  attachmentCount: number;
}

interface EnhancedTimelineProps {
  entityType?: string;
  entityId?: string;
  showFilters?: boolean;
  showSearch?: boolean;
  allowInlineEdit?: boolean;
}

const activityIcons: Record<string, any> = {
  status_change: AlertCircle,
  comment: MessageSquare,
  file_upload: FileUp,
  file_delete: FileUp,
  assignment: UserPlus,
  unassignment: UserPlus,
  notification: Info,
  created: CheckCircle,
  updated: Info,
  deleted: AlertTriangle,
  stage_change: AlertCircle,
  priority_change: AlertCircle,
  deadline_change: Clock,
  field_change: Info,
  relation_added: UserPlus,
  relation_removed: UserPlus,
  email: Mail,
};

const severityColors: Record<string, string> = {
  info: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30',
  success: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30',
  warning: 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30',
  error: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30',
};

const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'только что';
  if (diffMins < 60) return `${diffMins} мин назад`;
  if (diffHours < 24) return `${diffHours} ч назад`;
  if (diffDays < 7) return `${diffDays} дн назад`;

  return date.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function EnhancedTimeline({
  entityType,
  entityId,
  showFilters = true,
  showSearch = true,
  allowInlineEdit = false,
}: EnhancedTimelineProps) {
  const [activities, setActivities] = useState<EnhancedActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, _setSelectedTags] = useState<string[]>([]);
  const [selectedSeverity, setSelectedSeverity] = useState<string[]>([]);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [editingActivity, setEditingActivity] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    fetchActivities();
  }, [entityType, entityId, searchQuery, selectedTags, selectedSeverity, showPinnedOnly]);

  const fetchActivities = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();

      if (entityType) params.append('entityType', entityType);
      if (entityId) params.append('entityId', entityId);
      if (searchQuery) params.append('searchQuery', searchQuery);
      if (selectedTags.length > 0) params.append('tags', selectedTags.join(','));
      if (selectedSeverity.length > 0) params.append('severity', selectedSeverity.join(','));
      if (showPinnedOnly) params.append('isPinned', 'true');

      const data = await api.get(`/timeline?${params.toString()}`) as any;
      setActivities(data.activities);
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setLoading(false);
    }
  };

  const togglePin = async (activityId: string, isPinned: boolean) => {
    try {
      await api.patch(`/timeline/${activityId}/pin`, { isPinned: !isPinned });
      fetchActivities();
    } catch (error) {
      console.error('Failed to toggle pin:', error);
    }
  };

  const startEdit = (activity: EnhancedActivity) => {
    setEditingActivity(activity.id);
    setEditTitle(activity.title);
    setEditDescription(activity.description);
  };

  const saveEdit = async (activityId: string) => {
    try {
      await api.patch(`/timeline/${activityId}`, {
        title: editTitle,
        description: editDescription,
      });
      setEditingActivity(null);
      fetchActivities();
    } catch (error) {
      console.error('Failed to save edit:', error);
    }
  };

  const cancelEdit = () => {
    setEditingActivity(null);
    setEditTitle('');
    setEditDescription('');
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      {(showSearch || showFilters) && (
        <div className="space-y-3">
          {showSearch && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Поиск по активности..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          )}

          {showFilters && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowPinnedOnly(!showPinnedOnly)}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  showPinnedOnly
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                }`}
              >
                <Pin size={12} />
                Закрепленные
              </button>

              {['info', 'success', 'warning', 'error'].map((severity) => (
                <button
                  key={severity}
                  onClick={() => {
                    setSelectedSeverity((prev) =>
                      prev.includes(severity) ? prev.filter((s) => s !== severity) : [...prev, severity]
                    );
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedSeverity.includes(severity)
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                  }`}
                >
                  {severity}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Clock size={48} className="mb-3 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Нет активности</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">История действий появится здесь</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activities.map((activity, index) => {
            const Icon = activityIcons[activity.activityType] || Info;
            const isLast = index === activities.length - 1;
            const isEditing = editingActivity === activity.id;

            return (
              <div key={activity.id} className="relative flex gap-3">
                {/* Timeline line */}
                {!isLast && (
                  <div className="absolute left-5 top-10 h-full w-px bg-slate-200 dark:bg-slate-700" />
                )}

                {/* Icon */}
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    severityColors[activity.severity] || severityColors.info
                  }`}
                >
                  <Icon size={18} />
                </div>

                {/* Content */}
                <div className="flex-1 pb-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                            />
                            <textarea
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              rows={3}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveEdit(activity.id)}
                                className="rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600"
                              >
                                Сохранить
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="rounded bg-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300"
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start gap-2">
                              <p className="flex-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                {activity.title}
                              </p>
                              {activity.isPinned && (
                                <Pin size={14} className="text-blue-500" fill="currentColor" />
                              )}
                            </div>
                            {activity.description && (
                              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                                {activity.description}
                              </p>
                            )}
                          </>
                        )}

                        {/* Email preview */}
                        {activity.email && (
                          <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
                            <div className="flex items-center gap-2 text-xs">
                              <Mail size={12} />
                              <span className="font-medium">{activity.email.subject}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">{activity.email.preview}</p>
                          </div>
                        )}

                        {/* Tags */}
                        {activity.tags && activity.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {activity.tags.map((tag) => (
                              <span
                                key={tag}
                                className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                              >
                                <Tag size={10} />
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Attachments */}
                        {activity.attachmentCount > 0 && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                            <Paperclip size={12} />
                            <span>{activity.attachmentCount} вложений</span>
                          </div>
                        )}

                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
                          <span>{activity.actorName}</span>
                          <span>•</span>
                          <span>{formatRelativeTime(activity.createdAt)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-1">
                        <button
                          onClick={() => togglePin(activity.id, activity.isPinned)}
                          className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700"
                          title={activity.isPinned ? 'Открепить' : 'Закрепить'}
                        >
                          <Pin size={14} className={activity.isPinned ? 'text-blue-500' : 'text-slate-400'} />
                        </button>
                        {allowInlineEdit && !isEditing && (
                          <button
                            onClick={() => startEdit(activity)}
                            className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700"
                            title="Редактировать"
                          >
                            <Edit2 size={14} className="text-slate-400" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
