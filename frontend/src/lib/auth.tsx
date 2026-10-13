/**
 * 鉴权上下文：登录态管理、角色判断
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getStoredUser, getToken, setStoredUser, setToken } from './api';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
  securityClearance: string;
}

interface LoginResult {
  token: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getToken() ? getStoredUser<AuthUser>() : null);
  const [token, setTok] = useState<string | null>(() => getToken());
  const [loading, setLoading] = useState(() => Boolean(getToken()));

  useEffect(() => {
    if (!token) return;
    let active = true;
    void api.get<{ user: AuthUser }>('/auth/me').then(({ user: current }) => {
      if (!active) return;
      setStoredUser(current);
      setUser(current);
    }).catch((error: { code?: string }) => {
      if (!active) return;
      if (error.code !== 'UNAUTHORIZED') return;
      setToken(null);
      setStoredUser(null);
      setTok(null);
      setUser(null);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.post<LoginResult>('/auth/login', { username, password });
    setToken(result.token);
    setStoredUser(result.user);
    setTok(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setStoredUser(null);
    setTok(null);
    setUser(null);
  }, []);

  const hasRole = useCallback(
    (...roles: string[]) => {
      if (!user) return false;
      return user.roles.includes('admin') || roles.some((r) => user.roles.includes(r));
    },
    [user]
  );

  const value = useMemo(
    () => ({ user, token, login, logout, hasRole, loading }),
    [user, token, login, logout, hasRole, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
