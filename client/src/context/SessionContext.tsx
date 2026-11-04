import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_BASE } from '../lib/api';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  /** A DISPLAY gate only — the server re-checks, and is the real boundary. */
  isAdmin: boolean;
}

interface Session {
  /** Signed in to Clientline. */
  signedIn: boolean;
  user: SessionUser | null;
  isAdmin: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/session`);
      const data = await res.json();
      setUser(data.authenticated ? data.user : null);
    } catch {
      setUser(null);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<Session>(
    () => ({ signedIn: !!user, user, isAdmin: user?.isAdmin === true, loading, refresh, logout }),
    [user, loading, refresh, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
