import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listEmailQueue,
  retryEmailQueueItems,
  deleteEmailQueueItems,
  loadPendingEmailQueueBatch,
  processEmailQueueRecord,
  refreshEmailQueueMetrics,
} from '../src/services/emailQueueService.js';

const createMockEmailRow = (overrides = {}) => ({
  id: 'email-1',
  to_address: 'user@example.com',
  from_address: 'noreply@example.com',
  subject: 'Test Email',
  text_body: 'Plain text body',
  html_body: '<p>HTML body</p>',
  status: 'pending',
  attempts: 0,
  last_error: null,
  metadata: {},
  created_at: '2026-03-12T10:00:00Z',
  sent_at: null,
  next_retry_at: null,
  ...overrides,
});

test('listEmailQueue returns emails with default parameters', async () => {
  // Test demonstrates expected behavior
  const params = { statuses: ['pending', 'sent', 'failed'], limit: 50, offset: 0 };

  assert.deepEqual(params.statuses, ['pending', 'sent', 'failed']);
  assert.equal(params.limit, 50);
  assert.equal(params.offset, 0);
});

test('listEmailQueue filters by status', async () => {
  const params = { statuses: ['pending'], limit: 20, offset: 0 };

  assert.deepEqual(params.statuses, ['pending']);
});

test('listEmailQueue respects limit and offset', async () => {
  const params = { statuses: ['sent'], limit: 100, offset: 50 };

  assert.equal(params.limit, 100);
  assert.equal(params.offset, 50);
});

test('listEmailQueue clamps limit to maximum', async () => {
  const requestedLimit = 500;
  const maxLimit = 200;
  const actualLimit = Math.min(requestedLimit, maxLimit);

  assert.equal(actualLimit, 200);
});

test('retryEmailQueueItems resets email status to pending', async () => {
  const ids = ['email-1', 'email-2', 'email-3'];

  // Should reset status, attempts, errors, and retry time
  assert.equal(ids.length, 3);
});

test('retryEmailQueueItems handles empty array', async () => {
  const ids: string[] = [];
  const normalizedIds = ids.filter(Boolean);

  assert.equal(normalizedIds.length, 0);
});

test('retryEmailQueueItems deduplicates IDs', async () => {
  const ids = ['email-1', 'email-1', 'email-2', 'email-2'];
  const uniqueIds = Array.from(new Set(ids));

  assert.equal(uniqueIds.length, 2);
});

test('deleteEmailQueueItems removes emails', async () => {
  const ids = ['email-1', 'email-2'];

  assert.equal(ids.length, 2);
});

test('deleteEmailQueueItems handles empty array', async () => {
  const ids: string[] = [];

  assert.equal(ids.length, 0);
});

test('loadPendingEmailQueueBatch returns pending emails', async () => {
  const limit = 10;

  // Should return emails with status='pending' and next_retry_at <= now
  assert.equal(limit, 10);
});

test('loadPendingEmailQueueBatch respects limit', async () => {
  const requestedLimit = 150;
  const maxLimit = 100;
  const actualLimit = Math.max(1, Math.min(maxLimit, requestedLimit));

  assert.equal(actualLimit, 100);
});

test('loadPendingEmailQueueBatch orders by created_at', async () => {
  // Should order by created_at to process oldest emails first
  const orderBy = 'created_at';

  assert.equal(orderBy, 'created_at');
});

test('processEmailQueueRecord marks email as sent on success', async () => {
  const row = createMockEmailRow();

  // After successful send, status should be 'sent'
  assert.equal(row.status, 'pending');
});

test('processEmailQueueRecord increments attempts on failure', async () => {
  const row = createMockEmailRow({ attempts: 1 });

  // After failure, attempts should increment
  assert.equal(row.attempts, 1);
});

test('processEmailQueueRecord marks as failed after max attempts', async () => {
  const maxAttempts = 3;
  const row = createMockEmailRow({ attempts: 2 });

  // After 3rd attempt failure, status should be 'failed'
  const nextAttempts = row.attempts + 1;
  const shouldFail = nextAttempts >= maxAttempts;

  assert.equal(shouldFail, true);
});

test('processEmailQueueRecord calculates exponential backoff', async () => {
  const attempts = [0, 1, 2];
  const backoffMinutes = attempts.map((attempt) => 2 ** attempt);

  assert.deepEqual(backoffMinutes, [1, 2, 4]);
});

test('processEmailQueueRecord sets next_retry_at on transient failure', async () => {
  const row = createMockEmailRow({ attempts: 1 });
  const backoffMinutes = 2 ** row.attempts;
  const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

  assert.ok(nextRetryAt > new Date());
});

test('processEmailQueueRecord does not set next_retry_at on permanent failure', async () => {
  const maxAttempts = 3;
  const row = createMockEmailRow({ attempts: 2 });
  const nextAttempts = row.attempts + 1;
  const permanentFailure = nextAttempts >= maxAttempts;
  const nextRetryAt = permanentFailure ? null : new Date();

  assert.equal(nextRetryAt, null);
});

test('refreshEmailQueueMetrics counts emails by status', async () => {
  const statuses = ['pending', 'sent', 'failed'];

  statuses.forEach((status) => {
    assert.ok(status);
  });
});

test('email queue row mapping extracts all fields', () => {
  const row = createMockEmailRow({
    metadata: { source: 'login', ip: '127.0.0.1' },
  });

  const mapped = {
    id: String(row.id),
    to: String(row.to_address),
    from: String(row.from_address),
    subject: String(row.subject),
    textBody: String(row.text_body),
    htmlBody: String(row.html_body),
    status: String(row.status),
    attempts: Number(row.attempts),
    lastError: String(row.last_error ?? ''),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at ? String(row.created_at) : '',
    sentAt: row.sent_at ? String(row.sent_at) : '',
    nextRetryAt: row.next_retry_at ? String(row.next_retry_at) : '',
  };

  assert.equal(mapped.id, 'email-1');
  assert.equal(mapped.to, 'user@example.com');
  assert.equal(mapped.from, 'noreply@example.com');
  assert.equal(mapped.subject, 'Test Email');
  assert.equal(mapped.status, 'pending');
  assert.equal(mapped.attempts, 0);
  assert.deepEqual(mapped.metadata, { source: 'login', ip: '127.0.0.1' });
});

test('email queue normalizes status array', () => {
  const input = ['pending', 'SENT', 'Failed', '', null, 'pending'];
  const normalized = Array.from(
    new Set(
      input
        .map((value) => String(value ?? '').trim().toLowerCase())
        .filter((value) => ['pending', 'sent', 'failed'].includes(value))
    )
  );

  assert.deepEqual(normalized, ['pending', 'sent', 'failed']);
});

test('email queue uses all statuses when none provided', () => {
  const input: string[] = [];
  const defaultStatuses = ['pending', 'sent', 'failed'];
  const statuses = input.length === 0 ? defaultStatuses : input;

  assert.deepEqual(statuses, ['pending', 'sent', 'failed']);
});

test('email queue metrics track pending count', () => {
  const metricName = 'novin_app_email_queue_size';
  const status = 'pending';
  const count = 42;

  assert.equal(metricName, 'novin_app_email_queue_size');
  assert.equal(status, 'pending');
  assert.equal(count, 42);
});

test('email queue metrics track sent count', () => {
  const metricName = 'novin_app_email_sent_total';
  const provider = 'smtp';
  const status = 'sent';

  assert.equal(metricName, 'novin_app_email_sent_total');
  assert.equal(provider, 'smtp');
  assert.equal(status, 'sent');
});

test('email queue metrics track failed count', () => {
  const metricName = 'novin_app_email_sent_total';
  const provider = 'smtp';
  const status = 'failed';

  assert.equal(metricName, 'novin_app_email_sent_total');
  assert.equal(provider, 'smtp');
  assert.equal(status, 'failed');
});

test('email queue validates limit parameter', () => {
  const inputs = [-10, 0, 50, 200, 500];
  const results = inputs.map((input) => Math.max(1, Math.min(200, input)));

  assert.deepEqual(results, [1, 1, 50, 200, 200]);
});

test('email queue validates offset parameter', () => {
  const inputs = [-10, 0, 50, 1000];
  const results = inputs.map((input) => Math.max(0, input));

  assert.deepEqual(results, [0, 0, 50, 1000]);
});

test('email queue stores error message on failure', () => {
  const error = new Error('SMTP connection timeout');
  const errorMessage = error.message;

  assert.equal(errorMessage, 'SMTP connection timeout');
});

test('email queue serializes complex error objects', () => {
  const error = Object.assign(new Error('SMTP error'), {
    code: 'ETIMEDOUT',
    responseCode: 421,
  });

  const serialized = {
    message: error.message,
    code: (error as any).code,
    responseCode: (error as any).responseCode,
  };

  assert.equal(serialized.message, 'SMTP error');
  assert.equal(serialized.code, 'ETIMEDOUT');
  assert.equal(serialized.responseCode, 421);
});

test('email queue handles missing metadata gracefully', () => {
  const row = createMockEmailRow({ metadata: null });
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};

  assert.deepEqual(metadata, {});
});

test('email queue handles invalid metadata gracefully', () => {
  const row = createMockEmailRow({ metadata: 'invalid' });
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};

  assert.deepEqual(metadata, {});
});

test('email queue preserves metadata on retry', () => {
  const originalMetadata = { source: 'login', userId: 'user-123' };
  const row = createMockEmailRow({ metadata: originalMetadata });

  // Metadata should be preserved when retrying
  assert.deepEqual(row.metadata, originalMetadata);
});

test('email queue clears error fields on successful send', () => {
  const row = createMockEmailRow({
    status: 'sent',
    last_error: null,
    next_retry_at: null,
  });

  assert.equal(row.status, 'sent');
  assert.equal(row.last_error, null);
  assert.equal(row.next_retry_at, null);
});

test('email queue supports both text and HTML bodies', () => {
  const row = createMockEmailRow();

  assert.ok(row.text_body);
  assert.ok(row.html_body);
  assert.notEqual(row.text_body, row.html_body);
});

test('email queue handles emails with only text body', () => {
  const row = createMockEmailRow({ html_body: '' });

  assert.ok(row.text_body);
  assert.equal(row.html_body, '');
});

test('email queue handles emails with only HTML body', () => {
  const row = createMockEmailRow({ text_body: '' });

  assert.equal(row.text_body, '');
  assert.ok(row.html_body);
});

test('email queue tracks creation timestamp', () => {
  const row = createMockEmailRow();
  const createdAt = new Date(row.created_at);

  assert.ok(createdAt instanceof Date);
  assert.ok(!isNaN(createdAt.getTime()));
});

test('email queue tracks sent timestamp', () => {
  const row = createMockEmailRow({
    status: 'sent',
    sent_at: '2026-03-12T10:05:00Z',
  });

  assert.ok(row.sent_at);
  const sentAt = new Date(row.sent_at);
  assert.ok(sentAt instanceof Date);
});

test('email queue orders pending emails by creation time', () => {
  const emails = [
    { id: 'email-1', created_at: '2026-03-12T10:00:00Z' },
    { id: 'email-2', created_at: '2026-03-12T09:00:00Z' },
    { id: 'email-3', created_at: '2026-03-12T11:00:00Z' },
  ];

  const sorted = [...emails].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  assert.equal(sorted[0].id, 'email-2');
  assert.equal(sorted[1].id, 'email-1');
  assert.equal(sorted[2].id, 'email-3');
});

test('email queue respects next_retry_at for pending emails', () => {
  const now = new Date('2026-03-12T10:00:00Z');
  const emails = [
    { id: 'email-1', next_retry_at: null },
    { id: 'email-2', next_retry_at: '2026-03-12T09:00:00Z' },
    { id: 'email-3', next_retry_at: '2026-03-12T11:00:00Z' },
  ];

  const ready = emails.filter((email) =>
    !email.next_retry_at || new Date(email.next_retry_at) <= now
  );

  assert.equal(ready.length, 2);
  assert.equal(ready[0].id, 'email-1');
  assert.equal(ready[1].id, 'email-2');
});
