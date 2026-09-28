import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  clearSession,
  fetchCurrentUser,
  getStoredToken,
  getStoredUser,
  loginRequest,
  persistSession,
  type AuthUser,
} from "../lib/ragApi";
import { clearAnalysis } from "./AnalysisContext";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [isBootstrapping, setIsBootstrapping] = useState(() => !!getStoredToken());

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      clearAnalysis();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const me = await fetchCurrentUser();
        if (!cancelled) {
          setUser(me);
          persistSession(token, me);
        }
      } catch {
        if (!cancelled) {
          clearSession();
          clearAnalysis();
          setUser(null);
        }
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const result = await loginRequest(email, password);
        clearAnalysis();
        persistSession(result.access_token, result.user);
        setUser(result.user);
        return { ok: true };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Invalid email or password.";
        return { ok: false, error: message };
      }
    },
    []
  );

  const logout = useCallback(() => {
    clearSession();
    clearAnalysis();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isBootstrapping,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
