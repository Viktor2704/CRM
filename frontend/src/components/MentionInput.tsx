import React, { useState, useEffect, useRef } from 'react';

interface User {
  id: string;
  full_name: string;
  email: string;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onMention?: (userId: string) => void;
  placeholder?: string;
  className?: string;
}

export default function MentionInput({ value, onChange, onMention, placeholder, className }: MentionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [_mentionQuery, setMentionQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Mock users - in real app, fetch from API
  const allUsers: User[] = [
    { id: '1', full_name: 'Иван Петров', email: 'ivan@example.com' },
    { id: '2', full_name: 'Мария Сидорова', email: 'maria@example.com' },
    { id: '3', full_name: 'Алексей Иванов', email: 'alexey@example.com' },
  ];

  useEffect(() => {
    const lastAtIndex = value.lastIndexOf('@', cursorPosition);
    if (lastAtIndex !== -1) {
      const query = value.substring(lastAtIndex + 1, cursorPosition);
      const hasSpace = query.includes(' ');

      if (!hasSpace && query.length >= 0) {
        setMentionQuery(query);
        const filtered = allUsers.filter(user =>
          user.full_name.toLowerCase().includes(query.toLowerCase()) ||
          user.email.toLowerCase().includes(query.toLowerCase())
        );
        setSuggestions(filtered);
        setShowSuggestions(filtered.length > 0);
        setSelectedIndex(0);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  }, [value, cursorPosition]);

  const insertMention = (user: User) => {
    const lastAtIndex = value.lastIndexOf('@', cursorPosition);
    const beforeMention = value.substring(0, lastAtIndex);
    const afterMention = value.substring(cursorPosition);
    const newValue = `${beforeMention}@${user.full_name} ${afterMention}`;

    onChange(newValue);
    setShowSuggestions(false);

    if (onMention) {
      onMention(user.id);
    }

    // Focus back on input
    setTimeout(() => {
      if (inputRef.current) {
        const newPosition = beforeMention.length + user.full_name.length + 2;
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newPosition, newPosition);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Enter':
        if (showSuggestions && suggestions[selectedIndex]) {
          e.preventDefault();
          insertMention(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowSuggestions(false);
        break;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    setCursorPosition(e.target.selectionStart);
  };

  const handleClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    setCursorPosition((e.target as HTMLTextAreaElement).selectionStart);
  };

  return (
    <div className="mention-input-wrapper">
      <textarea
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => setCursorPosition((e.target as HTMLTextAreaElement).selectionStart)}
        placeholder={placeholder}
        className={className}
      />

      {showSuggestions && (
        <div className="mention-suggestions">
          {suggestions.map((user, index) => (
            <div
              key={user.id}
              className={`mention-suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => insertMention(user)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="user-avatar">
                {user.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="user-info">
                <div className="user-name">{user.full_name}</div>
                <div className="user-email">{user.email}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .mention-input-wrapper {
          position: relative;
        }

        .mention-suggestions {
          position: absolute;
          bottom: 100%;
          left: 0;
          right: 0;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
          max-height: 200px;
          overflow-y: auto;
          z-index: 1000;
          margin-bottom: 0.5rem;
        }

        .mention-suggestion-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          cursor: pointer;
          transition: background 0.15s;
        }

        .mention-suggestion-item:hover,
        .mention-suggestion-item.selected {
          background: #f3f4f6;
        }

        .user-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #3b82f6;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          flex-shrink: 0;
        }

        .user-info {
          flex: 1;
          min-width: 0;
        }

        .user-name {
          font-weight: 500;
          color: #111827;
        }

        .user-email {
          font-size: 0.875rem;
          color: #6b7280;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
