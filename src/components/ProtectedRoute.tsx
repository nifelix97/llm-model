import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import Spinner from "./Spinner";
import { useAuth } from "../context/AuthContext";
import type { PermissionKey } from "../lib/ragApi";

interface ProtectedRouteProps {
  children: ReactNode;
  permission?: PermissionKey;
}

/**
 * Wraps any route that requires authentication.
 * Redirects to /login and stores the attempted path so the user
 * is sent back after a successful login.
 */
export default function ProtectedRoute({ children, permission }: ProtectedRouteProps) {
  const { isAuthenticated, isBootstrapping, user } = useAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50">
        <Spinner size="md" label="Checking session…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (permission && !user?.permissions?.includes(permission)) {
    if (location.pathname === "/dashboard") {
      const fallback = [
        ["/prompt", "prompt:use"],
        ["/optimize", "optimize:run"],
        ["/datalake", "data:view"],
        ["/models/new", "data:manage"],
        ["/monitoring", "monitoring:view"],
        ["/users", "users:manage"],
      ].find(([, key]) => user?.permissions?.includes(key as PermissionKey))?.[0];
      if (fallback) return <Navigate to={fallback} replace />;
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50 p-6">
        <div className="max-w-md rounded-2xl border border-secondary-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-secondary-900">Access not granted</h1>
          <p className="mt-2 text-sm text-secondary-500">Your workspace administrator has not granted permission to open this page.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
