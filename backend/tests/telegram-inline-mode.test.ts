import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { handleInlineQuery, handleChosenInlineResult } from '../src/services/telegramInlineMode.js';

describe('Telegram Inline Mode', () => {
    const mockBot = {
        callApi: mock.fn(async () => true),
    };

    it('should handle inline query for non-linked user', async () => {
        const query = {
            id: 'query123',
            from: { id: 99999 },
            query: 'test',
        };

        await handleInlineQuery(mockBot as any, query);
        assert.strictEqual(mockBot.callApi.mock.calls.length, 1);
        const [method, params] = mockBot.callApi.mock.calls[0].arguments;
        assert.strictEqual(method, 'answerInlineQuery');
        assert.strictEqual(params.inline_query_id, 'query123');
        assert.ok(params.results[0].title.includes('не привязан'));
    });

    it('should handle inline query with empty search', async () => {
        mockBot.callApi.mock.resetCalls();
        const query = {
            id: 'query456',
            from: { id: 12345 },
            query: '',
        };

        await handleInlineQuery(mockBot as any, query);
        // Should attempt to answer even if user lookup fails
        assert.ok(mockBot.callApi.mock.calls.length >= 1);
    });

    it('should handle chosen inline result', async () => {
        const result = {
            result_id: 'result123',
            from: { id: 12345 },
            query: 'test query',
        };

        // Should not throw
        await handleChosenInlineResult(result);
        assert.ok(true);
    });
});
