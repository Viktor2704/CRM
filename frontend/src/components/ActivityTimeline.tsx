import { Clock, FileUp, MessageSquare, UserPlus, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

interface ActivityLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  activityType: string;
  actorUserId?: string;
  actorName: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  title: string;
  description: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

interface ActivityTimelineProps {
  activities: ActivityLogEntry[];
  loading?: boolean;
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

export default function ActivityTimeline({ activities, loading }: ActivityTimelineProps) {
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

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock size={48} className="mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Нет активности</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">История действий появится здесь</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activities.map((activity, index) => {
        const Icon = activityIcons[activity.activityType] || Info;
        const isLast = index === activities.length - 1;

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
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {activity.title}
                  </p>
                  {activity.description && (
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {activity.description}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
                    <span>{activity.actorName}</span>
                    <span>•</span>
                    <span>{formatRelativeTime(activity.createdAt)}</span>
                  </div>
                </div>
              </div>

              {/* Metadata display */}
              {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
                  {activity.activityType === 'status_change' && activity.metadata.oldStatus && activity.metadata.newStatus && (
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-200 px-2 py-0.5 dark:bg-slate-700">
                        {activity.metadata.oldStatus}
                      </span>
                      <span>→</span>
                      <span className="rounded bg-slate-200 px-2 py-0.5 dark:bg-slate-700">
                        {activity.metadata.newStatus}
                      </span>
                    </div>
                  )}
                  {activity.activityType === 'file_upload' && activity.metadata.fileName && (
                    <div className="flex items-center gap-2">
                      <FileUp size={14} />
                      <span className="font-medium">{activity.metadata.fileName}</span>
                      {activity.metadata.fileSize && (
                        <span className="text-slate-500">
                          ({Math.round(activity.metadata.fileSize / 1024)} KB)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
