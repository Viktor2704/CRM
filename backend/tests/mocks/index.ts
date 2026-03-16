import { vi } from 'vitest';

export interface MockDatabase {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

export const createMockDatabase = (): MockDatabase => {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  };
};

export const createMockPool = () => {
  const pool = createMockDatabase();
  return {
    ...pool,
    on: vi.fn(),
  };
};

export interface MockRequest {
  body?: any;
  params?: any;
  query?: any;
  headers?: any;
  cookies?: any;
  authUser?: any;
  method?: string;
  path?: string;
  ip?: string;
}

export const createMockRequest = (overrides: MockRequest = {}): any => {
  return {
    body: overrides.body || {},
    params: overrides.params || {},
    query: overrides.query || {},
    headers: overrides.headers || {},
    cookies: overrides.cookies || {},
    authUser: overrides.authUser || null,
    method: overrides.method || 'GET',
    path: overrides.path || '/',
    ip: overrides.ip || '127.0.0.1',
    get: vi.fn((header: string) => overrides.headers?.[header.toLowerCase()]),
  };
};

export interface MockResponse {
  statusCode?: number;
  body?: any;
}

export const createMockResponse = (): any => {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status: vi.fn(function(code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function(data: any) {
      this.body = data;
      return this;
    }),
    send: vi.fn(function(data?: any) {
      this.body = data;
      return this;
    }),
    sendStatus: vi.fn(function(code: number) {
      this.statusCode = code;
      return this;
    }),
    set: vi.fn(function(field: string, value: string) {
      this.headers[field] = value;
      return this;
    }),
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    redirect: vi.fn(),
  };
  return res;
};

export const createMockNext = () => vi.fn();

export interface MockLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
}

export const createMockLogger = (): MockLogger => {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
};

export const createMockMailService = () => {
  return {
    sendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
    verifyConnection: vi.fn().mockResolvedValue(true),
  };
};

export const createMockFileStorage = () => {
  return {
    storeFile: vi.fn().mockResolvedValue({
      filename: 'test-file.pdf',
      path: '/uploads/test-file.pdf',
      size: 1024,
      mimetype: 'application/pdf',
    }),
    deleteFile: vi.fn().mockResolvedValue(true),
    getFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
  };
};

export const createMockWebSocket = () => {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    to: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    send: vi.fn(),
    broadcast: {
      emit: vi.fn(),
    },
  };
};

export const createMockAIService = () => {
  return {
    callLLM: vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'AI response' } }],
    }),
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    analyzeSentiment: vi.fn().mockResolvedValue({ sentiment: 'positive', score: 0.8 }),
  };
};
