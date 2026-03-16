import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { TelegramBotClient } from '../src/services/telegramClient.ts';

const createJsonResponse = (payload: unknown) => ({
    ok: true,
    status: 200,
    async json() {
        return payload;
    },
});

const waitFor = async (check: () => boolean, timeoutMs = 1000) => {
    const startedAt = Date.now();
    while (!check()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`Condition was not met within ${timeoutMs}ms`);
        }
        await delay(10);
    }
};

test('TelegramBotClient posts bot API payloads without external SDKs', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
        const target = String(url);
        calls.push({ url: target, init });
        if (target.endsWith('/sendMessage')) {
            return createJsonResponse({
                ok: true,
                result: {
                    message_id: 11,
                    chat: { id: 1234567890 },
                    text: 'Привет',
                },
            });
        }
        if (target.endsWith('/editMessageText')) {
            return createJsonResponse({
                ok: true,
                result: true,
            });
        }
        if (target.endsWith('/answerCallbackQuery')) {
            return createJsonResponse({
                ok: true,
                result: true,
            });
        }
        if (target.endsWith('/getFile')) {
            return createJsonResponse({
                ok: true,
                result: {
                    file_path: 'photos/test.jpg',
                },
            });
        }
        if (target.endsWith('/getMe')) {
            return createJsonResponse({
                ok: true,
                result: {
                    username: 'NovinzhstroyBot',
                },
            });
        }
        throw new Error(`Unexpected URL: ${target}`);
    };

    const bot = new TelegramBotClient('secret-token', { fetchImpl });

    const sent = await bot.sendMessage(1234567890, 'Привет', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
    });
    const edited = await bot.editMessageText('Обновлено', {
        chat_id: 1234567890,
        message_id: 11,
        parse_mode: 'HTML',
    });
    const answered = await bot.answerCallbackQuery('query-1', { text: 'Готово' });
    const file = await bot.getFile('file-123');
    const me = await bot.getMe();

    assert.equal(sent.message_id, 11);
    assert.equal(edited, true);
    assert.equal(answered, true);
    assert.equal(file.file_path, 'photos/test.jpg');
    assert.equal(me.username, 'NovinzhstroyBot');

    const sendPayload = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(calls[0]?.url, 'https://api.telegram.org/botsecret-token/sendMessage');
    assert.equal(sendPayload.chat_id, 1234567890);
    assert.equal(sendPayload.text, 'Привет');
    assert.equal(sendPayload.parse_mode, 'HTML');
    assert.deepEqual(sendPayload.reply_markup, { inline_keyboard: [] });

    const editPayload = JSON.parse(String(calls[1]?.init?.body));
    assert.equal(editPayload.chat_id, 1234567890);
    assert.equal(editPayload.message_id, 11);
    assert.equal(editPayload.text, 'Обновлено');
});

test('TelegramBotClient long polling dispatches message, text, and callback handlers', async (t) => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let getUpdatesCalls = 0;
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
        const target = String(url);
        calls.push({ url: target, init });
        if (target.endsWith('/getUpdates')) {
            getUpdatesCalls += 1;
            if (getUpdatesCalls === 1) {
                return createJsonResponse({
                    ok: true,
                    result: [
                        {
                            update_id: 100,
                            message: {
                                message_id: 7,
                                text: '/start test-token',
                                chat: { id: 77 },
                            },
                        },
                        {
                            update_id: 101,
                            callback_query: {
                                id: 'callback-1',
                                data: 'action:details:deadbeef',
                                message: {
                                    message_id: 8,
                                    chat: { id: 77 },
                                    text: 'Детали',
                                },
                            },
                        },
                    ],
                });
            }
            return createJsonResponse({
                ok: true,
                result: [],
            });
        }
        throw new Error(`Unexpected URL: ${target}`);
    };

    const messages: any[] = [];
    const callbacks: any[] = [];
    const textMatches: Array<string | undefined> = [];
    const bot = new TelegramBotClient('secret-token', {
        fetchImpl,
        polling: {
            intervalMs: 1,
            timeoutSeconds: 0,
        },
    });
    t.after(async () => {
        await bot.stopPolling();
    });

    bot.on('message', (message) => {
        messages.push(message);
    });
    bot.on('callback_query', (query) => {
        callbacks.push(query);
    });
    bot.onText(/^\/start(?:\s+(.+))?$/i, (_message, match) => {
        textMatches.push(match?.[1]);
    });

    await waitFor(() => messages.length === 1 && callbacks.length === 1 && textMatches.length === 1);

    assert.equal(messages[0]?.chat?.id, 77);
    assert.equal(callbacks[0]?.id, 'callback-1');
    assert.equal(textMatches[0], 'test-token');

    await bot.stopPolling();
    const pollingCalls = calls.filter((entry) => entry.url.endsWith('/getUpdates'));
    assert.ok(pollingCalls.length >= 2);
    const nextPollPayload = JSON.parse(String(pollingCalls[1]?.init?.body));
    assert.equal(nextPollPayload.offset, 102);
    assert.equal(nextPollPayload.timeout, 0);
    assert.deepEqual(nextPollPayload.allowed_updates, ['message', 'callback_query']);
});
