import { useState, useRef, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { Bot, Send, Trash2, User } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api, buildApiUrl, getAccessToken } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/context/ToastContext';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

const STORAGE_KEY = 'ai_chat_history';
const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Привет! Я AI-ассистент Новинжстрой. Могу дать сводку по заявкам, проектам, направлениям — спрашивай.',
};

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadHistory(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [WELCOME];
    const parsed = JSON.parse(raw) as Message[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

function saveHistory(msgs: Message[]) {
  try {
    // Keep last 100 messages
    const toSave = msgs.filter(m => m.id !== 'welcome').slice(-100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave.length > 0 ? toSave : [WELCOME]));
  } catch { /* ignore */ }
}

// Convert [id:UUID] markers to links
function renderMessageContent(text: string) {
  const parts = text.split(/(\[id:[0-9a-f-]{36}\])/gi);
  return parts.map((part, i) => {
    const match = part.match(/^\[id:([0-9a-f-]{36})\]$/i);
    if (match) {
      const id = match[1];
      return (
        <a
          key={i}
          href={`/service-requests?id=${id}`}
          className="font-mono text-xs underline text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          title={id}
        >
          #{id.slice(0, 8)}
        </a>
      );
    }
    // Render newlines
    return part.split('\n').map((line, j, arr) => (
      <span key={`${i}-${j}`}>
        {line}
        {j < arr.length - 1 && <br />}
      </span>
    ));
  });
}

export default function AiChatPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const canUseAiChat = ['admin', 'manager', 'curator', 'dispatcher'].includes(user?.role || '');

  // Load chat history from server on mount, fall back to localStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getT<{ messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; metadata?: unknown; createdAt?: string }> }>('/ai/chat-history');
        if (cancelled) return;
        if (data?.messages && data.messages.length > 0) {
          const serverMessages: Message[] = data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }));
          setMessages([WELCOME, ...serverMessages]);
          // Sync to localStorage as backup
          saveHistory([WELCOME, ...serverMessages]);
        }
      } catch {
        // API failed — keep localStorage history (already loaded via useState initializer)
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessageStream = useCallback(async (_text: string, _userMsg: Message, nextMessages: Array<{ role: string; content: string }>, updatedWithUser: Message[]) => {
    const assistantMsgId = genId();
    streamingMsgIdRef.current = assistantMsgId;
    const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: '' };
    setMessages([...updatedWithUser, assistantMsg]);
    setStreaming(true);

    try {
      const url = buildApiUrl('/ai/chat?stream=true');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Stream request failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          if (trimmed === 'data: [DONE]') break;
          try {
            const json = JSON.parse(trimmed.slice(6));
            if (json.content) {
              fullContent += json.content;
              const captured = fullContent;
              setMessages((prev) =>
                prev.map((m) => m.id === assistantMsgId ? { ...m, content: captured } : m),
              );
            }
          } catch { /* skip malformed */ }
        }
      }

      setMessages((prev) => {
        const final = prev.map((m) => m.id === assistantMsgId ? { ...m, content: fullContent } : m);
        saveHistory(final);
        return final;
      });
    } catch {
      // Streaming failed — fall back to non-streaming
      setMessages(updatedWithUser);
      return false;
    } finally {
      setStreaming(false);
      streamingMsgIdRef.current = null;
    }
    return true;
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || streaming) return;

    const userMsg: Message = { id: genId(), role: 'user', content: text };
    const nextMessages = [...messages.filter((m) => m.id !== 'welcome'), userMsg];
    const updatedWithUser = [...messages, userMsg];
    setMessages(updatedWithUser);
    setInput('');
    setLoading(true);

    try {
      const payload = nextMessages.map((m) => ({ role: m.role, content: m.content }));

      // Try streaming first
      const streamOk = await sendMessageStream(text, userMsg, payload, updatedWithUser);
      if (streamOk) return;

      // Fallback to non-streaming
      const result = await api.postT<{ reply: string; _meta?: { source?: string; error?: string } }>('/ai/chat', { messages: payload });
      const replyText = result.reply;
      const isFallback = result._meta?.source === 'fallback';
      const assistantMsg: Message = {
        id: genId(),
        role: 'assistant',
        content: isFallback ? `${replyText}\n\n_[ответ от резервного провайдера]_` : replyText,
      };
      const final = [...updatedWithUser, assistantMsg];
      setMessages(final);
      saveHistory(final);
    } catch {
      toast.error('Не удалось получить ответ от AI.');
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setInput(text);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([WELCOME]);
    localStorage.removeItem(STORAGE_KEY);
    // Clear server-side history (best-effort, don't block UI)
    api.deleteT('/ai/chat-history').catch(() => {});
  };

  if (!canUseAiChat) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'AI-ассистент' }]} />
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          AI-ассистент доступен только внутренним операционным ролям.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-112px)] sm:h-[calc(100vh-112px)] flex-col px-2 sm:px-0">
      <div className="mb-3 sm:mb-4 flex items-center justify-between gap-2">
        <Breadcrumbs items={[{ label: 'AI-ассистент' }]} />
        <button
          type="button"
          onClick={clearChat}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 min-h-[44px] text-sm text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Trash2 size={14} />
          <span className="hidden sm:inline">Очистить</span>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 p-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  msg.role === 'assistant'
                    ? 'bg-brand-red/10 text-brand-red'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {msg.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}
              </div>
              <div
                className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-3 py-2 sm:px-4 sm:py-2.5 text-sm leading-relaxed ${
                  msg.role === 'assistant'
                    ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                    : 'bg-brand-red text-white'
                }`}
              >
                {renderMessageContent(msg.content)}
              </div>
            </div>
          ))}

          {(loading && !streaming) && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-red/10 text-brand-red">
                <Bot size={16} />
              </div>
              <div className="flex items-center gap-1 rounded-2xl bg-slate-100 px-4 py-3 dark:bg-slate-800">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="mt-2 sm:mt-3 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Спросите что-нибудь..."
          rows={2}
          disabled={loading || streaming}
          className="flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading || streaming}
          className="flex items-center justify-center gap-2 rounded-xl bg-brand-red px-4 py-2.5 min-h-[44px] min-w-[44px] text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
