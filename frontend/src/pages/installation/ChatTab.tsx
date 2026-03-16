import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Pin } from 'lucide-react';
import { api } from '@/api/client';
import type { useToast } from '@/context/ToastContext';
import { usePermissions } from '@/hooks/usePermissions';

type ChatMessage = {
  id: string;
  userId?: string;
  text?: string;
  visibility?: string;
  attachments?: { id: string; name: string; url?: string }[];
  isPinned?: boolean;
  createdAt?: string;
  isSystem?: boolean;
};

export default function ChatTab({ instId, messages, pinnedMessages, userNameById, canManage, onReload, toast }: {
  instId: string; messages: ChatMessage[]; userNameById: Record<string, string>;
  pinnedMessages?: ChatMessage[];
  canManage: boolean; onReload: () => Promise<void>; toast: ReturnType<typeof useToast>;
}) {
  const { role } = usePermissions();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isClientRole = ['installer', 'client_manager', 'client_user', 'user'].includes(role);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const onSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await api.postT(`/installations/${instId}/chat/messages`, {
        text: trimmed,
        visibility: isClientRole ? 'client-visible' : 'internal',
      });
      setText('');
      await onReload();
    } catch {
      toast.error('Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  };

  const onPin = async (msgId: string, pin: boolean) => {
    try {
      await api.patchT(`/installations/${instId}/chat/messages/${msgId}/pin`, { pinned: pin });
      await onReload();
    } catch {
      toast.error('Не удалось закрепить');
    }
  };

  const visiblePinnedMessages = Array.isArray(pinnedMessages) ? pinnedMessages : messages.filter((m) => m.isPinned);

  const resolveUserLabel = (userId?: string) => {
    if (!userId) return 'Система';
    return userNameById[userId] || 'Участник';
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 flex flex-col" style={{ height: '600px' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800 shrink-0">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
          <MessageSquare size={18} className="text-green-500" />
          Чат по заявке
          <span className="text-xs font-normal text-slate-400">({messages.length})</span>
        </h3>
      </div>

      {/* Pinned messages */}
      {visiblePinnedMessages.length > 0 ? (
        <div className="border-b border-amber-100 bg-amber-50/50 px-6 py-2 dark:border-amber-900/30 dark:bg-amber-950/10 shrink-0">
          {visiblePinnedMessages.map((m) => (
            <div key={m.id} className="flex items-start gap-2 py-1">
              <Pin size={12} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300 line-clamp-2">{m.text}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare size={40} className="mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-400">Сообщений пока нет</p>
            <p className="text-xs text-slate-400 mt-1">Начните обсуждение по заявке</p>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.isSystem) {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="rounded-full bg-slate-100 px-4 py-1.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {msg.text}
                  </div>
                </div>
              );
            }
            return (
              <div key={msg.id} className="group flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300 shrink-0 mt-0.5">
                  {resolveUserLabel(msg.userId)[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {resolveUserLabel(msg.userId)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {msg.createdAt ? new Date(msg.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                    {msg.isPinned ? <Pin size={10} className="text-amber-500" /> : null}
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{msg.text}</p>
                  {msg.attachments && msg.attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {msg.attachments.map((a) => (
                        <a key={a.id} href={a.url || '#'} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700">
                          {a.name}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
                {canManage ? (
                  <button type="button" onClick={() => onPin(msg.id, !msg.isPinned)}
                    className="opacity-0 group-hover:opacity-100 rounded p-1 text-slate-400 transition hover:text-amber-500"
                    title={msg.isPinned ? 'Открепить' : 'Закрепить'}>
                    <Pin size={14} />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 px-6 py-4 dark:border-slate-800 shrink-0">
        <div className="flex items-end gap-3">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder="Написать сообщение... (Enter для отправки)"
            className="flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-red-500 transition focus:border-red-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button type="button" disabled={sending || !text.trim()} onClick={onSend}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-red-600 text-white transition hover:bg-red-700 disabled:opacity-40 shrink-0">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
