import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const backendRoot = path.resolve(new URL('..', import.meta.url).pathname);
const schemasDir = path.join(backendRoot, 'src', 'schemas');

test('schema initializer modules do not contain inline DDL', async () => {
  const entries = await readdir(schemasDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }

    const source = (await readFile(path.join(schemasDir, entry.name), 'utf8')).toLowerCase();

    assert.equal(
      /create\s+table|alter\s+table|create\s+index/.test(source),
      false,
      `${entry.name} should not contain inline DDL`,
    );
  }
});
