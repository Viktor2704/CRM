import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { emitAlertWithConfig } from '../src/alerts.ts';

let appAlertHelpersPromise: Promise<{
  redactSensitiveUrlForLogs: (urlLike: string) => string;
}> | null = null;

const loadAppAlertHelpers = async () => {
  if (!appAlertHelpersPromise) {
    const originalSetInterval = globalThis.setInterval;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousJwtAccessSecret = process.env.JWT_ACCESS_SECRET;
    const previousLocalMockAuth = process.env.LOCAL_MOCK_AUTH;

    process.env.DATABASE_URL ??= 'postgres://postgres:postgres@127.0.0.1:5432/novinzhstroy';
    process.env.JWT_ACCESS_SECRET ??= 'alerts-test-secret';
    process.env.LOCAL_MOCK_AUTH = 'true';
    globalThis.setInterval = (((_callback: () => void) => {
      return { ref() { return this; }, unref() { return this; } } as ReturnType<typeof setInterval>;
    }) as typeof setInterval);

    appAlertHelpersPromise = import('../src/app.js').then((appModule) => ({
      redactSensitiveUrlForLogs: appModule.redactSensitiveUrlForLogs,
    })).finally(() => {
      globalThis.setInterval = originalSetInterval;
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      if (previousJwtAccessSecret === undefined) {
        delete process.env.JWT_ACCESS_SECRET;
      } else {
        process.env.JWT_ACCESS_SECRET = previousJwtAccessSecret;
      }
      if (previousLocalMockAuth === undefined) {
        delete process.env.LOCAL_MOCK_AUTH;
      } else {
        process.env.LOCAL_MOCK_AUTH = previousLocalMockAuth;
      }
    });
  }

  return appAlertHelpersPromise;
};

const createFetchStub = () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchStub = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
    };
  };

  return { calls, fetchStub };
};

test('emitAlertWithConfig posts alert payload to Telegram chat ids', async () => {
  const { calls, fetchStub } = createFetchStub();

  await emitAlertWithConfig(
    {
      serviceName: 'novinzhstroy-backend',
      alertLogFile: '',
      alertWebhookUrl: '',
      alertCooldownSeconds: 300,
      alertTelegramChatIds: ['1234567890'],
      telegramBotToken: 'telegram-token',
    },
    {
      type: 'http_5xx',
      severity: 'critical',
      message: 'Unhandled internal error',
      context: {
        path: '/ai/chat',
        status: 500,
      },
    },
    {
      fetchImpl: fetchStub,
      dedupeState: new Map<string, number>(),
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.telegram.org/bottelegram-token/sendMessage');

  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(body.chat_id, '1234567890');
  assert.equal(body.parse_mode, 'HTML');
  assert.match(body.text, /Novinzhstroy Alert/);
  assert.match(body.text, /Unhandled internal error/);
  assert.match(body.text, /\/ai\/chat/);
});

test('emitAlertWithConfig respects cooldown dedupe across transports', async () => {
  const { calls, fetchStub } = createFetchStub();
  const dedupeState = new Map<string, number>();
  const config = {
    serviceName: 'novinzhstroy-backend',
    alertLogFile: '',
    alertWebhookUrl: 'https://alerts.example.invalid/hook',
    alertCooldownSeconds: 300,
    alertTelegramChatIds: [],
    telegramBotToken: '',
  };
  const input = {
    type: 'db_error',
    severity: 'critical',
    message: 'Database transaction failed',
    dedupeKey: 'db_error:transaction',
  };

  await emitAlertWithConfig(config, input, {
    fetchImpl: fetchStub,
    dedupeState,
  });
  await emitAlertWithConfig(config, input, {
    fetchImpl: fetchStub,
    dedupeState,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://alerts.example.invalid/hook');
});

test('emitAlertWithConfig serializes redacted token query params for alert-visible paths', async () => {
  const { calls, fetchStub } = createFetchStub();
  const { redactSensitiveUrlForLogs } = await loadAppAlertHelpers();
  const rawPath = '/service-requests/request-1/confirm?token=secret-link-token&view=compact&accessToken=sse-secret';
  const sanitizedPath = redactSensitiveUrlForLogs(rawPath);

  assert.equal(
    sanitizedPath,
    '/service-requests/request-1/confirm?token=REDACTED&view=compact&accessToken=REDACTED',
  );

  await emitAlertWithConfig(
    {
      serviceName: 'novinzhstroy-backend',
      alertLogFile: '',
      alertWebhookUrl: 'https://alerts.example.invalid/hook',
      alertCooldownSeconds: 300,
      alertTelegramChatIds: ['1234567890'],
      telegramBotToken: 'telegram-token',
    },
    {
      type: 'auth_error',
      severity: 'warning',
      message: 'Auth error UNAUTHORIZED',
      dedupeKey: `auth_error:UNAUTHORIZED:${sanitizedPath}`,
      context: {
        path: sanitizedPath,
        status: 401,
      },
    },
    {
      fetchImpl: fetchStub,
      dedupeState: new Map<string, number>(),
    },
  );

  assert.equal(calls.length, 2);

  const webhookCall = calls.find((call) => call.url === 'https://alerts.example.invalid/hook');
  const telegramCall = calls.find((call) => call.url === 'https://api.telegram.org/bottelegram-token/sendMessage');

  assert.ok(webhookCall);
  assert.ok(telegramCall);

  const webhookBody = JSON.parse(String(webhookCall?.init?.body));
  assert.equal(webhookBody.context.path, sanitizedPath);
  assert.doesNotMatch(JSON.stringify(webhookBody), /secret-link-token|sse-secret/);

  const telegramBody = JSON.parse(String(telegramCall?.init?.body));
  assert.match(telegramBody.text, /token=REDACTED/);
  assert.match(telegramBody.text, /accessToken=REDACTED/);
  assert.doesNotMatch(telegramBody.text, /secret-link-token|sse-secret/);
});

test('emitAlertWithConfig writes alert payloads to the error tracking log without transport configuration', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'novin-alert-log-'));
  const alertLogFile = path.join(tempDir, 'events.ndjson');

  try {
    await emitAlertWithConfig(
      {
        serviceName: 'novinzhstroy-backend',
        alertLogFile,
        alertWebhookUrl: '',
        alertCooldownSeconds: 300,
        alertTelegramChatIds: [],
        telegramBotToken: '',
      },
      {
        type: 'runtime_uncaught_exception',
        severity: 'critical',
        message: 'Uncaught exception',
        context: {
          runtimeEvent: 'uncaughtException',
          pid: 4242,
        },
      },
      {
        dedupeState: new Map<string, number>(),
      },
    );

    const payloadLines = (await readFile(alertLogFile, 'utf8')).trim().split('\n');
    assert.equal(payloadLines.length, 1);

    const payload = JSON.parse(payloadLines[0] ?? '');
    assert.equal(payload.type, 'runtime_uncaught_exception');
    assert.equal(payload.message, 'Uncaught exception');
    assert.equal(payload.context.pid, 4242);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('emitAlertWithConfig keeps writing error log entries while throttling external transports', async () => {
  const { calls, fetchStub } = createFetchStub();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'novin-alert-log-cooldown-'));
  const alertLogFile = path.join(tempDir, 'events.ndjson');
  const dedupeState = new Map<string, number>();

  try {
    const config = {
      serviceName: 'novinzhstroy-backend',
      alertLogFile,
      alertWebhookUrl: 'https://alerts.example.invalid/hook',
      alertCooldownSeconds: 300,
      alertTelegramChatIds: [],
      telegramBotToken: '',
    };
    const input = {
      type: 'http_5xx',
      severity: 'critical',
      message: 'HTTP 500 INTERNAL_ERROR',
      dedupeKey: 'http_5xx:INTERNAL_ERROR:/api/test',
    };

    await emitAlertWithConfig(config, input, {
      fetchImpl: fetchStub,
      dedupeState,
    });
    await emitAlertWithConfig(config, input, {
      fetchImpl: fetchStub,
      dedupeState,
    });

    assert.equal(calls.length, 1);

    const payloadLines = (await readFile(alertLogFile, 'utf8')).trim().split('\n');
    assert.equal(payloadLines.length, 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
