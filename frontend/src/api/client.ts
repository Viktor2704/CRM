let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const API_FALLBACK_ORIGIN = ((import.meta.env.VITE_API_FALLBACK_ORIGIN as string | undefined)?.trim() || 'http://localhost:8080').replace(/\/+$/, '');

const resolveApiBase = () => {
  const explicitBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (explicitBase) {
    return explicitBase.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && HTTP_PROTOCOLS.has(String(window.location?.protocol || '').toLowerCase())) {
    return '/api';
  }

  // WebView/Capacitor/file:// fallback: use explicit server origin.
  return `${API_FALLBACK_ORIGIN}/api`;
};

const API_BASE = resolveApiBase();
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

const withLeadingSlash = (path: string) => (path.startsWith('/') ? path : `/${path}`);
export const buildApiUrl = (path: string) => `${API_BASE}${withLeadingSlash(path)}`;

const getCsrfTokenFromCookie = () => {
  const tokenChunk = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${CSRF_COOKIE_NAME}=`));
  if (!tokenChunk) return '';
  const raw = tokenChunk.split('=').slice(1).join('=');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const parseErrorBody = async (response: Response): Promise<{ code: string; message: string }> => {
  const fallback = { code: 'UNKNOWN', message: response.statusText || 'Request failed' };
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return fallback;
  }
  try {
    const data = (await response.json()) as { code?: string; message?: string };
    return {
      code: data.code || fallback.code,
      message: data.message || fallback.message,
    };
  } catch {
    return fallback;
  }
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  if (response.status === 204) {
    return undefined as T;
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export async function refreshAccessToken(): Promise<boolean> {
  const headers: Record<string, string> = {};
  const csrfToken = getCsrfTokenFromCookie();
  if (csrfToken) {
    headers[CSRF_HEADER_NAME] = csrfToken;
  }
  try {
    const response = await fetch(buildApiUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers,
    });
    if (!response.ok) {
      setAccessToken(null);
      return false;
    }
    const data = (await response.json()) as { accessToken?: string };
    if (!data.accessToken) {
      setAccessToken(null);
      return false;
    }
    setAccessToken(data.accessToken);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
}

async function requestT<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await sendRequest(method, path, {
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  return parseJsonResponse<T>(response);
}

async function sendRequest(method: string, path: string, options: {
  body?: BodyInit;
  headers?: Record<string, string>;
} = {}): Promise<Response> {
  const url = buildApiUrl(path);
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const csrfToken = getCsrfTokenFromCookie();
  if (csrfToken) {
    headers[CSRF_HEADER_NAME] = csrfToken;
  }

  const send = () =>
    fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: options.body,
    });

  let response = await send();

  if (response.status === 401 && path !== '/auth/login' && path !== '/auth/refresh' && accessToken) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
    }
    const refreshed = await refreshPromise;
    if (refreshed && accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
      response = await send();
    }
  }

  if (!response.ok) {
    const errorData = await parseErrorBody(response);
    throw new ApiError(response.status, errorData.code, errorData.message);
  }

  return response;
}

async function requestRawT<T>(method: string, path: string, body: BodyInit, headers?: Record<string, string>): Promise<T> {
  const response = await sendRequest(method, path, { body, headers });

  return parseJsonResponse<T>(response);
}

export const getT = <T>(path: string) => requestT<T>('GET', path);
export const postT = <T>(path: string, body?: unknown) => requestT<T>('POST', path, body);
export const patchT = <T>(path: string, body?: unknown) => requestT<T>('PATCH', path, body);
export const putT = <T>(path: string, body?: unknown) => requestT<T>('PUT', path, body);
export const delT = <T>(path: string) => requestT<T>('DELETE', path);
export const uploadFileT = <T>(path: string, file: File, fileName = file.name) => {
  const normalizedFileName = fileName.trim();
  if (!normalizedFileName) {
    throw new Error('fileName is required');
  }
  const separator = path.includes('?') ? '&' : '?';
  const contentType = file.type.trim() || 'application/octet-stream';
  return requestRawT<T>('POST', `${path}${separator}${new URLSearchParams({ fileName: normalizedFileName }).toString()}`, file, {
    'Content-Type': contentType,
  });
};

export const api = {
  getT,
  postT,
  patchT,
  putT,
  delT,
  deleteT: delT,
  get: getT,
  post: postT,
  patch: patchT,
  put: putT,
  del: delT,
  delete: delT,
  getDirection: getT,
  getMaintenanceItem: getT,
};
