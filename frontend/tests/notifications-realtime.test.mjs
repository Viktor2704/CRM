import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const notificationBellPath = path.resolve(__dirname, '../src/components/NotificationBell.tsx');
const notificationStreamContextPath = path.resolve(__dirname, '../src/context/NotificationStreamContext.tsx');
const mainPath = path.resolve(__dirname, '../src/main.tsx');

test('notification bell consumes realtime unread count instead of polling', async () => {
  const source = await readFile(notificationBellPath, 'utf8');

  assert.match(source, /useNotificationStream/);
  assert.doesNotMatch(source, /setInterval/);
  assert.doesNotMatch(source, /notifications\/unread-count/);
});

test('notification stream provider uses EventSource for realtime updates', async () => {
  const source = await readFile(notificationStreamContextPath, 'utf8');

  assert.match(source, /new EventSource/);
  assert.match(source, /notification_changed/);
  assert.match(source, /notifications\/stream/);
});

test('application bootstraps the notification stream provider', async () => {
  const source = await readFile(mainPath, 'utf8');

  assert.match(source, /NotificationStreamProvider/);
  assert.match(source, /<NotificationStreamProvider>/);
});
