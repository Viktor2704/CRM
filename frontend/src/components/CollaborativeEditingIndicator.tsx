import { useState, useEffect } from 'react';
import axios from 'axios';

interface CollaborativeSession {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  last_activity_at: string;
}

interface CollaborativeEditingIndicatorProps {
  entityType: string;
  entityId: string;
}

export default function CollaborativeEditingIndicator({ entityType, entityId }: CollaborativeEditingIndicatorProps) {
  const [sessions, setSessions] = useState<CollaborativeSession[]>([]);
  const [mySessionToken, setMySessionToken] = useState<string | null>(null);

  useEffect(() => {
    startSession();
    const interval = setInterval(() => {
      loadActiveSessions();
      updateActivity();
    }, 5000); // Check every 5 seconds

    return () => {
      clearInterval(interval);
      endSession();
    };
  }, [entityType, entityId]);

  const startSession = async () => {
    try {
      const response = await axios.post('/api/collaborative-sessions', {
        entity_type: entityType,
        entity_id: entityId,
      });
      setMySessionToken(response.data.session.session_token);
      await loadActiveSessions();
    } catch (err) {
      console.error('Failed to start collaborative session:', err);
    }
  };

  const updateActivity = async () => {
    if (!mySessionToken) return;
    try {
      await axios.put(`/api/collaborative-sessions/${mySessionToken}/activity`);
    } catch (err) {
      console.error('Failed to update session activity:', err);
    }
  };

  const endSession = async () => {
    if (!mySessionToken) return;
    try {
      await axios.delete(`/api/collaborative-sessions/${mySessionToken}`);
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  };

  const loadActiveSessions = async () => {
    try {
      const response = await axios.get(`/api/collaborative-sessions/${entityType}/${entityId}`);
      setSessions(response.data.sessions);
    } catch (err) {
      console.error('Failed to load active sessions:', err);
    }
  };

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="collaborative-indicator">
      <div className="active-users">
        {sessions.slice(0, 3).map((session, index) => (
          <div
            key={session.id}
            className="user-avatar"
            style={{ zIndex: sessions.length - index }}
            title={`${session.user_name} редактирует`}
          >
            {session.user_name.charAt(0).toUpperCase()}
          </div>
        ))}
        {sessions.length > 3 && (
          <div className="more-users" title={`Еще ${sessions.length - 3} пользователей`}>
            +{sessions.length - 3}
          </div>
        )}
      </div>
      <span className="indicator-text">
        {sessions.length === 1 ? 'Редактирует' : 'Редактируют'} сейчас
      </span>

      <style>{`
        .collaborative-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background: #fef3c7;
          border: 1px solid #fbbf24;
          border-radius: 0.375rem;
          font-size: 0.875rem;
        }

        .active-users {
          display: flex;
          margin-left: -0.5rem;
        }

        .user-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #3b82f6;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 0.75rem;
          border: 2px solid white;
          margin-left: -0.5rem;
          cursor: pointer;
        }

        .more-users {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #6b7280;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 0.625rem;
          border: 2px solid white;
          margin-left: -0.5rem;
          cursor: pointer;
        }

        .indicator-text {
          color: #92400e;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
