import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import {
    generateWebhookSecret,
    verifyWebhookSignature,
    setWebhook,
    deleteWebhook,
    getWebhookInfo,
    checkWebhookHealth,
    validateWebhookUpdate,
    processWebhookUpdate,
} from '../src/services/telegramWebhooks.js';

describe('Telegram Webhooks', () => {
    it('should generate webhook secret', () => {
        const secret = generateWebhookSecret();
        assert.ok(secret);
        assert.strictEqual(secret.length, 64); // 32 bytes = 64 hex chars
    });

    it('should verify webhook signature', () => {
        const secret = 'test-secret';
        const body = JSON.stringify({ test: 'data' });
        const crypto = require('node:crypto');
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(body);
        const signature = hmac.digest('hex');

        const isValid = verifyWebhookSignature(body, signature, secret);
        assert.strictEqual(isValid, true);
    });

    it('should reject invalid webhook signature', () => {
        const secret = 'test-secret';
        const body = JSON.stringify({ test: 'data' });
        const invalidSignature = 'invalid-signature-000000000000000000000000000000000000000000000000';

        const isValid = verifyWebhookSignature(body, invalidSignature, secret);
        assert.strictEqual(isValid, false);
    });

    it('should validate webhook update structure', () => {
        const validUpdate = {
            update_id: 123,
            message: { text: 'test' },
        };
        assert.strictEqual(validateWebhookUpdate(validUpdate), true);

        const invalidUpdate = {
            update_id: 'not-a-number',
        };
        assert.strictEqual(validateWebhookUpdate(invalidUpdate), false);

        const noUpdateType = {
            update_id: 123,
        };
        assert.strictEqual(validateWebhookUpdate(noUpdateType), false);
    });

    it('should set webhook', async () => {
        const mockBot = {
            stopPolling: mock.fn(async () => {}),
            callApi: mock.fn(async () => true),
        };

        const result = await setWebhook(mockBot as any, 'https://example.com/webhook');
        assert.strictEqual(result, true);
        assert.strictEqual(mockBot.stopPolling.mock.calls.length, 1);
        assert.strictEqual(mockBot.callApi.mock.calls.length, 1);
    });

    it('should delete webhook', async () => {
        const mockBot = {
            callApi: mock.fn(async () => true),
        };

        const result = await deleteWebhook(mockBot as any);
        assert.strictEqual(result, true);
        assert.strictEqual(mockBot.callApi.mock.calls.length, 1);
        const [method, params] = mockBot.callApi.mock.calls[0].arguments;
        assert.strictEqual(method, 'deleteWebhook');
    });

    it('should get webhook info', async () => {
        const mockBot = {
            callApi: mock.fn(async () => ({
                url: 'https://example.com/webhook',
                has_custom_certificate: false,
                pending_update_count: 0,
            })),
        };

        const info = await getWebhookInfo(mockBot as any);
        assert.ok(info);
        assert.strictEqual(info.url, 'https://example.com/webhook');
    });

    it('should check webhook health', async () => {
        const mockBot = {
            callApi: mock.fn(async () => ({
                url: 'https://example.com/webhook',
                has_custom_certificate: false,
                pending_update_count: 5,
            })),
        };

        const health = await checkWebhookHealth(mockBot as any);
        assert.ok(health);
        assert.strictEqual(health.isHealthy, true);
        assert.strictEqual(health.pendingUpdates, 5);
    });

    it('should detect unhealthy webhook', async () => {
        const mockBot = {
            callApi: mock.fn(async () => ({
                url: 'https://example.com/webhook',
                has_custom_certificate: false,
                pending_update_count: 150,
                last_error_message: 'Connection timeout',
                last_error_date: Math.floor(Date.now() / 1000),
            })),
        };

        const health = await checkWebhookHealth(mockBot as any);
        assert.ok(health);
        assert.strictEqual(health.isHealthy, false);
        assert.ok(health.lastError);
    });

    it('should process webhook update with retry', async () => {
        let attempts = 0;
        const handler = mock.fn(async () => {
            attempts++;
            if (attempts < 2) {
                throw new Error('Temporary failure');
            }
        });

        const update = { update_id: 123, message: { text: 'test' } };
        await processWebhookUpdate(update, handler);

        assert.strictEqual(handler.mock.calls.length, 2);
    });

    it('should stop retrying after max attempts', async () => {
        const handler = mock.fn(async () => {
            throw new Error('Permanent failure');
        });

        const update = { update_id: 123, message: { text: 'test' } };
        await processWebhookUpdate(update, handler);

        // Should retry 4 times (initial + 4 retries = 5 total)
        assert.strictEqual(handler.mock.calls.length, 5);
    });
});
