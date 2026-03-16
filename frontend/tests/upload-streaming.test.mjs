import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientPath = path.resolve(__dirname, '../src/api/client.ts');
const uploadPages = [
  path.resolve(__dirname, '../src/pages/Installations.tsx'),
  path.resolve(__dirname, '../src/pages/ServiceRequests.tsx'),
  path.resolve(__dirname, '../src/pages/Projects.tsx'),
  path.resolve(__dirname, '../src/pages/MaintenancePlans.tsx'),
  path.resolve(__dirname, '../src/pages/installation/FilesTab.tsx'),
  path.resolve(__dirname, '../src/pages/installation/ProcurementTab.tsx'),
];

test('upload client sends files as raw request bodies with fileName in query string', async () => {
  const source = await readFile(clientPath, 'utf8');

  assert.match(source, /export const uploadFileT =/);
  assert.match(source, /new URLSearchParams\(\{ fileName: normalizedFileName \}\)/);
  assert.match(source, /requestRawT<.*>\('POST'/s);
  assert.match(source, /'Content-Type': contentType/);
});

test('file upload pages no longer base64-encode files before calling the API', async () => {
  for (const pagePath of uploadPages) {
    const source = await readFile(pagePath, 'utf8');

    assert.match(source, /uploadFileT/);
    assert.doesNotMatch(source, /readAsDataURL/);
    assert.doesNotMatch(source, /dataUrl/);
  }
});
