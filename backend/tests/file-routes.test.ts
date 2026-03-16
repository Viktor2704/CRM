import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { ApiError } from '../src/errors.js';
import { ensureSafeUploadMetadata, parseDataUrlPayload as parseDataUrlPayloadHelper } from '../src/helpers/fileHelpers.js';
import { registerFileRoutes } from '../src/routes/files.js';

const ids = {
  user: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

const createResponse = () => ({
  statusCode: 200,
  body: undefined as any,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  },
});

const createStreamRequest = ({
  body = 'probe',
  contentType = 'text/plain',
  fileName = 'probe.txt',
}: {
  body?: string | Buffer;
  contentType?: string;
  fileName?: string;
}) => {
  const request = Readable.from([body]) as Readable & Record<string, any>;
  request.query = fileName ? { fileName } : {};
  request.headers = { 'content-type': contentType, host: 'example.test' };
  request.authUser = { id: ids.user };
  request.protocol = 'https';
  request.get = (name: string) => request.headers[String(name).toLowerCase()] ?? '';
  return request;
};

const createRouteHarness = (overrides: Partial<Record<string, any>> = {}) => {
  const handlers = new Map<string, (request: any, response: any) => Promise<void>>();
  const app = {
    post(path: string, ...routeHandlers: Array<(request: any, response: any) => Promise<void>>) {
      handlers.set(`POST ${path}`, routeHandlers.at(-1)!);
    },
  };

  registerFileRoutes({
    app,
    requireAuth: (_request: any, _response: any, next: () => void) => next(),
    asyncHandler: <T extends (request: any, response: any) => Promise<void>>(handler: T) => handler,
    ApiError,
    storeFile: async () => {
      throw new Error('storeFile should be stubbed in this test');
    },
    storeFileStream: async () => {
      throw new Error('storeFileStream should be stubbed in this test');
    },
    parseDataUrlPayload: () => {
      throw new Error('parseDataUrlPayload should be stubbed in this test');
    },
    ensureSafeUploadMetadata: ({ fileName, mimeType }: { fileName: string; mimeType: string }) => ({ fileName, mimeType: 'text/plain' }),
    buildFileUrl: (_request: any, storageKey: string) => `/api/uploads/${storageKey}`,
    registerUploadedFile: async () => {},
    ...overrides,
  });

  return {
    getHandler(method: string, path: string) {
      const handler = handlers.get(`${method} ${path}`);
      assert.ok(handler, `handler ${method} ${path} should be registered`);
      return handler!;
    },
  };
};

test('POST /files/upload stores streamed request bodies without base64 JSON', async () => {
  const chunks: Buffer[] = [];
  const registered: Array<Record<string, unknown>> = [];
  const harness = createRouteHarness({
    ensureSafeUploadMetadata: ({ fileName, mimeType }: { fileName: string; mimeType: string }) => {
      assert.equal(fileName, 'probe.txt');
      assert.equal(mimeType, 'text/plain');
      return {
        fileName,
        mimeType: 'text/plain',
      };
    },
    storeFileStream: async ({ fileName, mimeType, stream }: { fileName: string; mimeType: string; stream: Readable }) => {
      assert.equal(fileName, 'probe.txt');
      assert.equal(mimeType, 'text/plain');
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return {
        id: 'file-123',
        fileName: 'probe.txt',
        storageKey: '2026/03/probe.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        uploadedAt: '2099-01-01T00:00:00.000Z',
      };
    },
    registerUploadedFile: async (payload: Record<string, unknown>) => {
      registered.push(payload);
    },
  });

  const response = createResponse();
  await harness.getHandler('POST', '/files/upload')(createStreamRequest({}), response);

  assert.equal(Buffer.concat(chunks).toString('utf8'), 'probe');
  assert.equal(response.statusCode, 201);
  assert.deepEqual(registered, [{
    fileId: 'file-123',
    storageKey: '2026/03/probe.txt',
    fileName: 'probe.txt',
    mimeType: 'text/plain',
    sizeBytes: 5,
    uploadedById: ids.user,
  }]);
  assert.equal(response.body.id, 'file-123');
  assert.equal(response.body.url, '/api/uploads/2026/03/probe.txt');
});

test('POST /files/upload keeps legacy JSON uploads working during transition', async () => {
  let rawUploadTouched = false;
  const harness = createRouteHarness({
    parseDataUrlPayload: ({ fileName, dataUrl }: { fileName: string; dataUrl: string }) => {
      assert.equal(fileName, 'probe.txt');
      assert.equal(dataUrl, 'data:text/plain;base64,cHJvYmU=');
      return {
        fileName: 'probe.txt',
        mimeType: 'text/plain',
        content: Buffer.from('probe'),
      };
    },
    storeFile: async ({ fileName, mimeType, content }: { fileName: string; mimeType: string; content: Buffer }) => {
      assert.equal(fileName, 'probe.txt');
      assert.equal(mimeType, 'text/plain');
      assert.equal(content.toString('utf8'), 'probe');
      return {
        id: 'file-legacy',
        fileName: 'probe.txt',
        storageKey: '2026/03/probe.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        uploadedAt: '2099-01-01T00:00:00.000Z',
      };
    },
    storeFileStream: async () => {
      rawUploadTouched = true;
      throw new Error('raw upload branch should not be used for application/json');
    },
  });

  const response = createResponse();
  await harness.getHandler('POST', '/files/upload')({
    body: {
      fileName: 'probe.txt',
      dataUrl: 'data:text/plain;base64,cHJvYmU=',
    },
    headers: {
      'content-type': 'application/json',
    },
    authUser: { id: ids.user },
    get: () => '',
  }, response);

  assert.equal(rawUploadTouched, false);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.id, 'file-legacy');
});

test('POST /files/upload rejects streamed active web document uploads before storage', async () => {
  const harness = createRouteHarness({
    ensureSafeUploadMetadata,
    storeFileStream: async () => {
      throw new Error('storeFileStream should not be called for blocked uploads');
    },
  });

  for (const upload of [
    {
      contentType: 'text/plain',
      fileName: 'invoice.html',
    },
    {
      contentType: 'image/svg+xml',
      fileName: 'vector.svg',
    },
  ]) {
    await assert.rejects(
      harness.getHandler('POST', '/files/upload')(createStreamRequest(upload), createResponse()),
      (error: any) => error instanceof ApiError && error.status === 415 && error.code === 'FILE_TYPE_NOT_ALLOWED',
    );
  }
});

test('POST /files/upload rejects JSON active web document uploads before writing them to storage', async () => {
  const harness = createRouteHarness({
    parseDataUrlPayload: parseDataUrlPayloadHelper,
    storeFile: async () => {
      throw new Error('storeFile should not be called for blocked uploads');
    },
  });

  for (const upload of [
    {
      fileName: 'invoice.html',
      dataUrl: 'data:text/plain;base64,cHJvYmU=',
    },
    {
      fileName: 'vector.svg',
      dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    },
  ]) {
    await assert.rejects(
      harness.getHandler('POST', '/files/upload')({
        body: upload,
        headers: {
          'content-type': 'application/json',
        },
        authUser: { id: ids.user },
        get: () => '',
      }, createResponse()),
      (error: any) => error instanceof ApiError && error.status === 415 && error.code === 'FILE_TYPE_NOT_ALLOWED',
    );
  }
});

test('POST /files/upload rejects streamed uploads without fileName query parameter', async () => {
  const harness = createRouteHarness({
    storeFileStream: async () => {
      throw new Error('storeFileStream should not be called when fileName is missing');
    },
  });

  await assert.rejects(
    harness.getHandler('POST', '/files/upload')(createStreamRequest({ fileName: '' }), createResponse()),
    (error: any) => error instanceof ApiError && error.status === 422 && error.code === 'INVALID_FILE_PAYLOAD',
  );
});
