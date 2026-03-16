import { useState, useEffect } from 'react';
import axios from 'axios';

interface Activity {
  id: string;
  activity_type: string;
  entity_type: string;
  entity_id: string;
  user_name?: string;
  title: string;
  description?: string;
  created_at: string;
}

interface TeamActivityFeedProps {
  teamId?: string;
  limit?: number;
}

export default function TeamActivityFeed({ teamId, limit = 50 }: TeamActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadActivities();
    const interval = setInterval(loadActivities, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [teamId, limit]);

  const loadActivities = async () => {
    try {
      const params: any = { limit };
      if (teamId) params.team_id = teamId;

      const response = await axios.get('/api/activity', { params });
      setActivities(response.data.activities);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (type: string) => {
    const icons: Record<string, string> = {
      created: '➕',
      updated: '✏️',
      commented: '💬',
      assigned: '👤',
      completed: '✅',
      deleted: '🗑️',
      shared: '🔗',
      mentioned: '@',
    };
    return icons[type] || '📌';
  };

  const getActivityColor = (type: string) => {
    const colors: Record<string, string> = {
      created: '#10b981',
      updated: '#3b82f6',
      commented: '#8b5cf6',
      assigned: '#f59e0b',
      completed: '#059669',
      deleted: '#ef4444',
      shared: '#06b6d4',
      mentioned: '#ec4899',
    };
    return colors[type] || '#6b7280';
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'только что';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч назад`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} дн назад`;
    return date.toLocaleDateString('ru-RU');
  };

  if (loading) {
    return (
      <div className="activity-feed loading">
        <div className="loading-spinner">Загрузка...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="activity-feed error">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="activity-feed">
      <div className="feed-header">
        <h3>Активность команды</h3>
        <button onClick={loadActivities} className="refresh-btn" title="Обновить">
          🔄
        </button>
      </div>

      <div className="feed-content">
        {activities.length === 0 ? (
          <div className="empty-state">
            <p>Нет активности</p>
          </div>
        ) : (
          <div className="activity-list">
            {activities.map((activity) => (
              <div key={activity.id} className="activity-item">
                <div
                  className="activity-icon"
                  style={{ backgroundColor: getActivityColor(activity.activity_type) }}
                >
                  {getActivityIcon(activity.activity_type)}
                </div>
                <div className="activity-content">
                  <div className="activity-header">
                    <span className="activity-user">{activity.user_name || 'Система'}</span>
                    <span className="activity-time">{formatTimeAgo(activity.created_at)}</span>
                  </div>
                  <div className="activity-title">{activity.title}</div>
                  {activity.description && (
                    <div className="activity-description">{activity.description}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .activity-feed {
          background: white;
          border-radius: 0.5rem;
          border: 1px solid #e5e7eb;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .feed-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          border-bottom: 1px solid #e5e7eb;
        }

        .feed-header h3 {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 600;
        }

        .refresh-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 1.25rem;
          padding: 0.25rem;
          opacity: 0.6;
          transition: opacity 0.2s;
        }

        .refresh-btn:hover {
          opacity: 1;
        }

        .feed-content {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
        }

        .activity-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .activity-item {
          display: flex;
          gap: 0.75rem;
          padding: 0.75rem;
          border-radius: 0.375rem;
          transition: background 0.15s;
        }

        .activity-item:hover {
          background: #f9fafb;
        }

        .activity-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.25rem;
          flex-shrink: 0;
        }

        .activity-content {
          flex: 1;
          min-width: 0;
        }

        .activity-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.25rem;
        }

        .activity-user {
          font-weight: 600;
          color: #111827;
        }

        .activity-time {
          font-size: 0.875rem;
          color: #6b7280;
        }

        .activity-title {
          color: #374151;
          margin-bottom: 0.25rem;
        }

        .activity-description {
          font-size: 0.875rem;
          color: #6b7280;
        }

        .empty-state {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: #9ca3af;
        }

        .loading,
        .error {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: 2rem;
        }

        .loading-spinner {
          color: #6b7280;
        }

        .error {
          color: #ef4444;
        }
      `}</style>
    </div>
  );
}
