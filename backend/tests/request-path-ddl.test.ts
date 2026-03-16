import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const backendRoot = path.resolve(new URL('..', import.meta.url).pathname);

const requestPathFiles = [
  'src/helpers/fileAccess.ts',
  'src/routes/accessRequests.ts',
  'src/routes/calendar.ts',
  'src/routes/contracts.ts',
  'src/routes/sppzJournal.ts',
  'src/services/ticketClientNotifications.ts',
];

test('request-path files do not contain inline create/alter table DDL', async () => {
  for (const relativePath of requestPathFiles) {
    const absolutePath = path.join(backendRoot, relativePath);
    const source = (await readFile(absolutePath, 'utf8')).toLowerCase();

    assert.equal(
      /create\s+table|alter\s+table/.test(source),
      false,
      `${relativePath} should not contain inline create/alter table DDL`,
    );
  }
});
