import assert from 'node:assert/strict';
import test from 'node:test';

import { appConfig } from '../src/config.ts';
import { __emailRateLimiterTestUtils, getEmailRateLimitSnapshot } from '../src/services/emailRateLimiter.ts';
import { __mailServiceTestUtils, sendEmailLoginToken, smtpSendMail, verifyMailTransporter } from '../src/services/mailService.ts';

const originalMailConfig = {
  emailRateLimitMaxConcurrent: appConfig.emailRateLimitMaxConcurrent,
  emailRateLimitMinTimeMs: appConfig.emailRateLimitMinTimeMs,
  smtpHost: appConfig.smtpHost,
  smtpUser: appConfig.smtpUser,
  smtpFrom: appConfig.smtpFrom,
};

test.afterEach(() => {
  appConfig.emailRateLimitMaxConcurrent = originalMailConfig.emailRateLimitMaxConcurrent;
  appConfig.emailRateLimitMinTimeMs = originalMailConfig.emailRateLimitMinTimeMs;
  appConfig.smtpHost = originalMailConfig.smtpHost;
  appConfig.smtpUser = originalMailConfig.smtpUser;
  appConfig.smtpFrom = originalMailConfig.smtpFrom;
  __mailServiceTestUtils.reset();
  __emailRateLimiterTestUtils.reset();
});

test('smtpSendMail retries transient Nodemailer failures and preserves attachments', async () => {
  let attempts = 0;
  const sentMessages: Array<Record<string, unknown>> = [];

  __mailServiceTestUtils.setDeps({
    sleepFn: async () => {},
    loadMailer: async () => ({
      createTransport: () => ({
        async sendMail(message: Record<string, unknown>) {
          sentMessages.push(message);
          attempts += 1;
          if (attempts < 3) {
            throw Object.assign(new Error('Temporary SMTP failure'), {
              code: 'ETIMEDOUT',
              responseCode: 421,
            });
          }
          return { messageId: 'message-1' };
        },
        async verify() {
          return true;
        },
      }),
    }),
  });

  const result = await smtpSendMail({
    to: 'user@example.com',
    from: 'noreply@example.com',
    subject: 'Subject',
    text: 'Plain text',
    html: '<p>Plain text</p>',
    attachments: [{ filename: 'report.txt', content: 'hello' }],
  });

  assert.equal(attempts, 3);
  assert.equal(result.messageId, 'message-1');
  assert.deepEqual(sentMessages[0]?.attachments, [{ filename: 'report.txt', content: 'hello' }]);
});

test('sendEmailLoginToken queues mail immediately without touching the transport', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  let sendMailCalled = false;

  appConfig.smtpHost = 'smtp.example.com';
  appConfig.smtpUser = 'smtp-user@example.com';
  appConfig.smtpFrom = 'noreply@example.com';

  __mailServiceTestUtils.setDeps({
    queryFn: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      return { rows: [], rowCount: 1 } as any;
    },
    loadMailer: async () => ({
      createTransport: () => ({
        async sendMail() {
          sendMailCalled = true;
          return { messageId: 'message-1' };
        },
        async verify() {
          return true;
        },
      }),
    }),
  });

  await sendEmailLoginToken({
    to: 'user@example.com',
    token: '123456',
    expiresInMinutes: 15,
  });

  assert.equal(sendMailCalled, false);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /insert into email_queue/i);
  assert.equal(queries[0].values[1], 'user@example.com');
});

test('verifyMailTransporter delegates to Nodemailer verify()', async () => {
  let verifyCalls = 0;

  appConfig.smtpHost = 'smtp.example.com';
  appConfig.smtpUser = 'smtp-user@example.com';
  appConfig.smtpFrom = 'noreply@example.com';

  __mailServiceTestUtils.setDeps({
    loadMailer: async () => ({
      createTransport: () => ({
        async sendMail() {
          return { messageId: 'message-1' };
        },
        async verify() {
          verifyCalls += 1;
          return true;
        },
      }),
    }),
  });

  const verified = await verifyMailTransporter();

  assert.equal(verified, true);
  assert.equal(verifyCalls, 1);
});

test('smtpSendMail uses the shared email rate limiter for concurrent sends', async () => {
  let releaseSend: (() => void) | null = null;
  const sendGate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });

  appConfig.emailRateLimitMaxConcurrent = 1;
  appConfig.emailRateLimitMinTimeMs = 1;
  __emailRateLimiterTestUtils.reset();

  __mailServiceTestUtils.setDeps({
    loadMailer: async () => ({
      createTransport: () => ({
        async sendMail() {
          await sendGate;
          return { messageId: 'message-limited' };
        },
        async verify() {
          return true;
        },
      }),
    }),
  });

  const firstSend = smtpSendMail({
    to: 'first@example.com',
    from: 'noreply@example.com',
    subject: 'First',
    text: 'Plain text',
    html: '<p>Plain text</p>',
  });
  const secondSend = smtpSendMail({
    to: 'second@example.org',
    from: 'noreply@example.com',
    subject: 'Second',
    text: 'Plain text',
    html: '<p>Plain text</p>',
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const snapshotWhileQueued = getEmailRateLimitSnapshot();
  assert.equal(snapshotWhileQueued.global.queued, 1);
  assert.equal(snapshotWhileQueued.totalQueued, 1);

  releaseSend?.();

  const results = await Promise.all([firstSend, secondSend]);
  assert.equal(results.length, 2);
});
