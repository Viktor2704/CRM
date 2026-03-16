// Example: Integrating WebSocket notifications in a React component

import React, { useEffect, useState } from 'react';
import { useRealtime, useRealtimeRoom, usePresence } from '../hooks/useRealtime';

// Example 1: Basic notification display
export function NotificationBell() {
    const token = localStorage.getItem('accessToken') || undefined;
    const { isConnected, unreadCount, notifications: _notifications } = useRealtime(token, {
        onNotification: (notification) => {
            // Show toast notification
            console.log('New notification:', notification);
            if (notification.priority === 'urgent') {
                alert(notification.message);
            }
        },
        onSystemMessage: (message) => {
            console.log('System message:', message);
        },
    });

    return (
        <div className="notification-bell">
            <button>
                🔔
                {unreadCount > 0 && (
                    <span className="badge">{unreadCount}</span>
                )}
            </button>
            <span className={`status ${isConnected ? 'online' : 'offline'}`}>
                {isConnected ? '●' : '○'}
            </span>
        </div>
    );
}

// Example 2: Ticket detail page with real-time features
export function TicketDetailPage({ ticketId }: { ticketId: number }) {
    const currentUser = { id: 1, name: 'Current User' };
    const [comment, setComment] = useState('');

    const {
        typingUsers,
        cursors,
        concurrentEditWarning,
        startTyping,
        stopTyping,
    } = useRealtimeRoom('ticket', ticketId);

    const { newComments, clearNewComments } = useRealtimeComments('ticket', ticketId);

    useEffect(() => {
        if (newComments.length > 0) {
            console.log('New comments received:', newComments);
            // Refresh comments list or append new comments
            clearNewComments();
        }
    }, [newComments, clearNewComments]);

    const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setComment(e.target.value);
        if (e.target.value.length > 0) {
            startTyping(currentUser.name);
        } else {
            stopTyping();
        }
    };

    const handleCommentBlur = () => {
        stopTyping();
    };

    return (
        <div className="ticket-detail">
            <h1>Ticket #{ticketId}</h1>

            {concurrentEditWarning && (
                <div className="warning">
                    ⚠️ {concurrentEditWarning.editorName} is also editing this ticket
                </div>
            )}

            {typingUsers.length > 0 && (
                <div className="typing-indicator">
                    {typingUsers.map(u => u.userName).join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
                </div>
            )}

            <div className="comments-section">
                <textarea
                    value={comment}
                    onChange={handleCommentChange}
                    onBlur={handleCommentBlur}
                    placeholder="Add a comment..."
                />
            </div>

            {cursors.length > 0 && (
                <div className="active-users">
                    Active users: {cursors.map(c => c.userName).join(', ')}
                </div>
            )}
        </div>
    );
}

// Example 3: User presence indicator
export function UserPresenceIndicator({ userId }: { userId: number }) {
    const { isUserOnline } = usePresence();
    const online = isUserOnline(userId);

    return (
        <span className={`presence-indicator ${online ? 'online' : 'offline'}`}>
            {online ? '🟢' : '⚫'}
        </span>
    );
}

// Example 4: Activity feed component
export function ActivityFeed() {
    const token = localStorage.getItem('accessToken') || undefined;
    const { activityFeed } = useRealtime(token, {
        onActivityUpdate: (activity) => {
            console.log('New activity:', activity);
        },
    });

    return (
        <div className="activity-feed">
            <h2>Recent Activity</h2>
            <ul>
                {activityFeed.map(activity => (
                    <li key={activity.id}>
                        <strong>{activity.actorName}</strong> {activity.action} {activity.resourceType}
                        {activity.resourceName && ` "${activity.resourceName}"`}
                        <span className="timestamp">{new Date(activity.createdAt).toLocaleString()}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// Example 5: Online users list
export function OnlineUsersList() {
    const { onlineUsers } = usePresence();
    const [users, setUsers] = useState<any[]>([]);

    useEffect(() => {
        // Fetch user details for online users
        const fetchUsers = async () => {
            const response = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
                },
            });
            const allUsers = await response.json();
            setUsers(allUsers.filter((u: any) => onlineUsers.includes(u.id)));
        };
        fetchUsers();
    }, [onlineUsers]);

    return (
        <div className="online-users">
            <h3>Online Users ({onlineUsers.length})</h3>
            <ul>
                {users.map(user => (
                    <li key={user.id}>
                        <UserPresenceIndicator userId={user.id} />
                        {user.fullName}
                    </li>
                ))}
            </ul>
        </div>
    );
}

// Example 6: App-level WebSocket initialization
export function App() {
    const [token, setToken] = useState<string | null>(null);

    useEffect(() => {
        // Get token from auth context or storage
        const accessToken = localStorage.getItem('accessToken');
        setToken(accessToken);
    }, []);

    // Initialize WebSocket connection at app level
    const { isConnected } = useRealtime(token || undefined, {
        autoConnect: true,
        onNotification: (notification) => {
            // Global notification handler
            showToast(notification.title, notification.message);
        },
    });

    return (
        <div className="app">
            <header>
                <NotificationBell />
                <div className="connection-status">
                    {isConnected ? 'Connected' : 'Disconnected'}
                </div>
            </header>
            <main>
                {/* Your app content */}
            </main>
        </div>
    );
}

function showToast(title: string, message: string) {
    // Implement your toast notification
    console.log(`Toast: ${title} - ${message}`);
}

// Import this in your components
import { useRealtimeComments } from '../hooks/useRealtime';
