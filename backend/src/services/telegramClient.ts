import { EventEmitter } from 'node:events';

type TelegramFetch = typeof fetch;

type TelegramApiEnvelope<T> = {
    ok: boolean;
    result: T;
    description?: string;
    error_code?: number;
};

type TelegramPollingConfig = {
    timeoutSeconds?: number;
    intervalMs?: number;
    allowedUpdates?: string[];
};

type TelegramBotClientOptions = {
    polling?: boolean | TelegramPollingConfig;
    fetchImpl?: TelegramFetch;
};

type TelegramEventMap = {
    message: TelegramMessage;
    callback_query: TelegramCallbackQuery;
    inline_query: any;
    chosen_inline_result: any;
    polling_error: unknown;
};

type TelegramTextHandler = {
    pattern: RegExp;
    listener: (message: TelegramMessage, match: RegExpExecArray | null) => void;
};

export type TelegramChat = {
    id?: number | string;
    [key: string]: any;
};

export type TelegramMessage = {
    message_id?: number;
    text?: string;
    caption?: string;
    chat?: TelegramChat;
    location?: {
        latitude?: number;
        longitude?: number;
        [key: string]: any;
    };
    photo?: Array<{
        file_id?: string;
        [key: string]: any;
    }>;
    [key: string]: any;
};

export type TelegramCallbackQuery = {
    id?: string;
    data?: string;
    message?: TelegramMessage;
    [key: string]: any;
};

export type TelegramFile = {
    file_path?: string;
    [key: string]: any;
};

export type TelegramUser = {
    username?: string;
    [key: string]: any;
};

type TelegramUpdate = {
    update_id?: number;
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
    inline_query?: any;
    chosen_inline_result?: any;
};

type TelegramSendMessageOptions = {
    parse_mode?: string;
    disable_web_page_preview?: boolean;
    reply_markup?: unknown;
};

type TelegramEditMessageOptions = TelegramSendMessageOptions & {
    chat_id: number | string;
    message_id: number;
};

type TelegramAnswerCallbackOptions = {
    text?: string;
    show_alert?: boolean;
    url?: string;
    cache_time?: number;
};

const DEFAULT_POLL_TIMEOUT_SECONDS = 25;
const DEFAULT_POLL_INTERVAL_MS = 1000;

const createPatternMatcher = (pattern: RegExp, text: string) => {
    const matcher = new RegExp(pattern.source, pattern.flags);
    return matcher.exec(text);
};

const isAbortError = (error: unknown) => {
    if (!error || typeof error !== 'object') {
        return false;
    }
    return (error as { name?: string }).name === 'AbortError';
};

export class TelegramBotClient extends EventEmitter {
    private readonly token: string;
    private readonly fetchImpl: TelegramFetch;
    private readonly pollTimeoutSeconds: number;
    private readonly pollIntervalMs: number;
    private readonly allowedUpdates: string[];
    private readonly textHandlers: TelegramTextHandler[] = [];
    private pollingActive = false;
    private updateOffset = 0;
    private pollTimer: NodeJS.Timeout | null = null;
    private pollAbortController: AbortController | null = null;

    constructor(token: string, options: TelegramBotClientOptions = {}) {
        super();
        this.token = token;
        const pollingConfig = options.polling && typeof options.polling === 'object'
            ? options.polling
            : {};
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.pollTimeoutSeconds = Number(pollingConfig.timeoutSeconds ?? DEFAULT_POLL_TIMEOUT_SECONDS);
        this.pollIntervalMs = Number(pollingConfig.intervalMs ?? DEFAULT_POLL_INTERVAL_MS);
        this.allowedUpdates = Array.isArray(pollingConfig.allowedUpdates) && pollingConfig.allowedUpdates.length > 0
            ? pollingConfig.allowedUpdates
            : ['message', 'callback_query', 'inline_query', 'chosen_inline_result'];
        this.pollingActive = Boolean(options.polling);
        if (this.pollingActive) {
            queueMicrotask(() => {
                if (this.pollingActive) {
                    void this.pollLoop();
                }
            });
        }
    }

    override on<EventName extends keyof TelegramEventMap>(
        eventName: EventName,
        listener: (payload: TelegramEventMap[EventName]) => void,
    ): this;
    override on(eventName: string | symbol, listener: (...args: any[]) => void): this;
    override on(eventName: string | symbol, listener: (...args: any[]) => void) {
        return super.on(eventName, listener);
    }

    onText(pattern: RegExp, listener: (message: TelegramMessage, match: RegExpExecArray | null) => void) {
        this.textHandlers.push({ pattern, listener });
        return this;
    }

    async stopPolling() {
        this.pollingActive = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.pollAbortController) {
            this.pollAbortController.abort();
            this.pollAbortController = null;
        }
    }

    async sendMessage(chatId: number | string, text: string, options: TelegramSendMessageOptions = {}) {
        return this.callApi<TelegramMessage>('sendMessage', {
            chat_id: chatId,
            text,
            ...options,
        });
    }

    async editMessageText(text: string, options: TelegramEditMessageOptions) {
        return this.callApi<TelegramMessage | true>('editMessageText', {
            text,
            ...options,
        });
    }

    async answerCallbackQuery(callbackQueryId: string, options: TelegramAnswerCallbackOptions = {}) {
        return this.callApi<boolean>('answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            ...options,
        });
    }

    async getFile(fileId: string) {
        return this.callApi<TelegramFile>('getFile', { file_id: fileId });
    }

    async getMe() {
        return this.callApi<TelegramUser>('getMe');
    }

    async callApi<T>(method: string, payload?: Record<string, unknown>, signal?: AbortSignal) {
        const response = await this.fetchImpl(this.buildApiUrl(method), {
            method: payload ? 'POST' : 'GET',
            headers: payload ? { 'content-type': 'application/json' } : undefined,
            body: payload ? JSON.stringify(payload) : undefined,
            signal,
        });
        if (!response.ok) {
            throw new Error(`Telegram API ${method} failed with status ${response.status}`);
        }
        const data = await response.json() as TelegramApiEnvelope<T>;
        if (!data?.ok) {
            const errorCode = Number(data?.error_code ?? 0);
            const description = String(data?.description ?? 'Unknown Telegram API error');
            throw new Error(`Telegram API ${method} failed${errorCode ? ` (${errorCode})` : ''}: ${description}`);
        }
        return data.result;
    }

    private buildApiUrl(method: string) {
        return `https://api.telegram.org/bot${this.token}/${method}`;
    }

    private scheduleNextPoll(delayMs: number) {
        if (!this.pollingActive) {
            return;
        }
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
        }
        this.pollTimer = setTimeout(() => {
            this.pollTimer = null;
            void this.pollLoop();
        }, Math.max(0, delayMs));
    }

    private async getUpdates(signal: AbortSignal) {
        return this.callApi<TelegramUpdate[]>('getUpdates', {
            offset: this.updateOffset,
            timeout: this.pollTimeoutSeconds,
            allowed_updates: this.allowedUpdates,
        }, signal);
    }

    private dispatchUpdate(update: TelegramUpdate) {
        if (update?.message) {
            this.emit('message', update.message);
            const text = typeof update.message.text === 'string' ? update.message.text : '';
            if (text) {
                for (const handler of this.textHandlers) {
                    const match = createPatternMatcher(handler.pattern, text);
                    if (match) {
                        handler.listener(update.message, match);
                    }
                }
            }
        }
        if (update?.callback_query) {
            this.emit('callback_query', update.callback_query);
        }
        if (update?.inline_query) {
            this.emit('inline_query', update.inline_query);
        }
        if (update?.chosen_inline_result) {
            this.emit('chosen_inline_result', update.chosen_inline_result);
        }
    }

    private async pollLoop() {
        if (!this.pollingActive) {
            return;
        }
        this.pollAbortController = new AbortController();
        try {
            const updates = await this.getUpdates(this.pollAbortController.signal);
            this.pollAbortController = null;
            for (const update of updates) {
                if (typeof update?.update_id === 'number') {
                    this.updateOffset = update.update_id + 1;
                }
                this.dispatchUpdate(update);
            }
            this.scheduleNextPoll(0);
        }
        catch (error) {
            this.pollAbortController = null;
            if (!this.pollingActive) {
                return;
            }
            if (!isAbortError(error)) {
                this.emit('polling_error', error);
            }
            this.scheduleNextPoll(this.pollIntervalMs);
        }
    }
}
