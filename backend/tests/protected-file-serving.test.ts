import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';

import { sendAttachmentSafeFileResponse } from '../src/helpers/fileHelpers.js';

class MockResponse extends Writable {
  statusCode = 200;
  headers = new Map<string, string>();
  bodyChunks: Buffer[] = [];

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers.set(String(name).toLowerCase(), String(value));
  }

  getHeader(name: string) {
    return this.headers.get(String(name).toLowerCase());
  }

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }
}

test('protected file GET responses force attachment-safe download headers for legacy .html files', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'protected-file-serving-'));
  const fullPath = path.join(tempDir, 'legacy-report.html');
  const body = Buffer.from('<script>alert("xss")</script>', 'utf8');

  await writeFile(fullPath, body);

  try {
    const response = new MockResponse();
    const finished = once(response, 'finish');

    await sendAttachmentSafeFileResponse({
      request: { method: 'GET' },
      response,
      fullPath,
      fileName: 'legacy-report.html',
      sizeBytes: body.byteLength,
      lastModified: new Date('2099-01-01T00:00:00.000Z'),
    });
    await finished;

    assert.equal(response.statusCode, 200);
    assert.equal(response.getHeader('content-type'), 'application/octet-stream');
    assert.equal(response.getHeader('x-content-type-options'), 'nosniff');
    assert.equal(response.getHeader('content-length'), String(body.byteLength));
    assert.match(String(response.getHeader('content-disposition')), /^attachment;/);
    assert.match(String(response.getHeader('content-disposition')), /filename="legacy-report.html"/);
    assert.equal(Buffer.concat(response.bodyChunks).toString('utf8'), body.toString('utf8'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('protected file HEAD responses keep download-safe headers and omit the response body', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'protected-file-serving-'));
  const fullPath = path.join(tempDir, 'legacy-vector.svg');
  const body = Buffer.from('<svg></svg>', 'utf8');

  await writeFile(fullPath, body);

  try {
    const response = new MockResponse();
    const finished = once(response, 'finish');

    await sendAttachmentSafeFileResponse({
      request: { method: 'HEAD' },
      response,
      fullPath,
      fileName: 'legacy-vector.svg',
      sizeBytes: body.byteLength,
      lastModified: new Date('2099-01-01T00:00:00.000Z'),
    });
    await finished;

    assert.equal(response.statusCode, 200);
    assert.equal(response.getHeader('content-type'), 'application/octet-stream');
    assert.equal(response.getHeader('x-content-type-options'), 'nosniff');
    assert.equal(response.getHeader('content-length'), String(body.byteLength));
    assert.match(String(response.getHeader('content-disposition')), /^attachment;/);
    assert.match(String(response.getHeader('content-disposition')), /filename="legacy-vector.svg"/);
    assert.equal(Buffer.concat(response.bodyChunks).byteLength, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
