import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAccessToken } from '@/api/client';
import type { AuthResponse, User } from '@/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  apiCall: <T = any>(path: string, options?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const session = await api.post<AuthResponse>('/auth/refresh');
        if (session.accessToken) {
          setAccessToken(session.accessToken);
        }
        setUser(session.user ?? null);
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    void bootstrap();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<AuthResponse>('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post<void>('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const apiCall = useCallback(async <T = any>(path: string, options?: RequestInit): Promise<T> => {
    const method = options?.method || 'GET';
    const body = options?.body;

    if (method === 'GET') {
      return api.getT<T>(path);
    } else if (method === 'POST') {
      return api.postT<T>(path, body ? JSON.parse(body as string) : undefined);
    } else if (method === 'PATCH') {
      return api.patchT<T>(path, body ? JSON.parse(body as string) : undefined);
    } else if (method === 'PUT') {
      return api.putT<T>(path, body ? JSON.parse(body as string) : undefined);
    } else if (method === 'DELETE') {
      return api.delT<T>(path);
    }

    return api.getT<T>(path);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      logout,
      apiCall,
    }),
    [isLoading, login, logout, user, apiCall]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
