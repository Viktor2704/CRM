import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const backendRoot = path.resolve(new URL('..', import.meta.url).pathname);

test('express app disables the x-powered-by header', async () => {
  const appSource = await readFile(path.join(backendRoot, 'src', 'app.ts'), 'utf8');
  const createAppIndex = appSource.indexOf('const app = express();');
  const disableHeaderIndex = appSource.indexOf("app.disable('x-powered-by');");

  assert.notEqual(createAppIndex, -1, 'app.ts should initialize the Express app');
  assert.notEqual(disableHeaderIndex, -1, 'app.ts should disable the x-powered-by header');
  assert.ok(
    disableHeaderIndex > createAppIndex,
    'x-powered-by should be disabled immediately after the Express app is created',
  );
});
