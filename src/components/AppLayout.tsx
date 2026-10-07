import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { PermissionKey } from "../lib/ragApi";

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
        />
      </svg>
    ),
  },
  {
    to: "/prompt",
    label: "Policy setting",
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
        />
      </svg>
    ),
  },
  {
    to: "/optimize",
    label: "Optimize",
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
  {
    to: "/datalake",
    label: "Data Lake",
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
        />
      </svg>
    ),
  },
  {
    to: "/models/new",
    label: "Add Data",
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
        />
      </svg>
    ),
  },
  {
    to: "/monitoring",
    label: "PMI",
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
        />
      </svg>
    ),
  },
  {
    to: "/users",
    label: "Users & permissions",
    icon: (
      <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2m16 0v-2a4 4 0 00-3-3.87M14 3.13a4 4 0 010 7.75M14 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
];

const NAV_ACCESS: Record<string, PermissionKey> = {
  "/dashboard": "dashboard:view",
  "/prompt": "prompt:use",
  "/optimize": "optimize:run",
  "/datalake": "data:view",
  "/models/new": "data:manage",
  "/monitoring": "monitoring:view",
  "/users": "users:manage",
};

const BOTTOM_NAV = [
  {
    to: "/",
    label: "Home",
    icon: (
      <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppLayoutProps {
  children: ReactNode;
  /** Fill the full viewport height with no scroll (for chat-style pages) */
  fullHeight?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppLayout({ children, fullHeight = false }: AppLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  // Close mobile drawer on resize to desktop
  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 1024) setMobileOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const sidebarW = collapsed ? "w-16" : "w-60";

  return (
    <div className="flex h-screen overflow-hidden bg-secondary-50">

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-primary-900/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* ── Sidebar (desktop) ── */}
      <aside
        className={[
          "hidden lg:flex flex-col shrink-0",
          "sticky top-0 h-screen",
          "bg-primary-900/95 border-r border-secondary-800",
          "transition-all duration-200 ease-in-out",
          sidebarW,
        ].join(" ")}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          onNavClick={() => {}}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      {/* ── Mobile sidebar drawer ── */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex flex-col w-60",
          "bg-primary-900 border-r border-secondary-800",
          "transition-transform duration-200 ease-in-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <SidebarContent
          collapsed={false}
          onToggleCollapse={() => setMobileOpen(false)}
          onNavClick={() => setMobileOpen(false)}
          mobileClose
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      {/* ── Main area ── */}
      <div className={["flex flex-col flex-1 min-w-0 overflow-hidden", fullHeight ? "" : ""].join(" ")}>

        {/* Top bar (mobile only) */}
        <header className="lg:hidden shrink-0 flex items-center justify-between h-14 px-4 bg-primary-900 border-b border-secondary-800">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg text-secondary-400 hover:text-white hover:bg-secondary-800 transition-colors"
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link to="/" className="flex items-center gap-1.5 font-extrabold text-base font-sans">
            <span className="text-primary-400">DC-TIM</span>
          </Link>
          <div className="size-9" aria-hidden /> {/* spacer */}
        </header>

        {/* Page content */}
        <div className={["flex-1 flex flex-col overflow-y-auto", fullHeight ? "overflow-hidden" : ""].join(" ")}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar content ──────────────────────────────────────────────────────────

function SidebarContent({
  collapsed,
  onToggleCollapse,
  onNavClick,
  mobileClose = false,
  user,
  onLogout,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavClick: () => void;
  mobileClose?: boolean;
  user: { email: string; name: string; role: string; permissions: string[] } | null;
  onLogout: () => void;
}) {
  return (
    <>
      {/* Logo + toggle */}
      <div className={["flex items-center h-14 border-b border-secondary-800 px-3 shrink-0", collapsed ? "justify-center" : "justify-between"].join(" ")}>
        {!collapsed && (
          <Link
            to="/"
            onClick={onNavClick}
            className="flex items-center gap-1.5 font-extrabold text-base font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
          >
            <span className="text-primary-400">DC-TIM</span>
          </Link>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={mobileClose ? "Close menu" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1.5 rounded-lg text-secondary-100 hover:text-white hover:bg-primary-600 transition-colors"
        >
          {mobileClose ? (
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : collapsed ? (
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
            </svg>
          ) : (
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
            </svg>
          )}
        </button>
      </div>

      {/* Label */}
      {!collapsed && (
        <div className="px-4 pt-5 pb-2">
          <p className="text-xs font-semibold text-secondary-600 uppercase tracking-widest font-sans">
            Navigation
          </p>
        </div>
      )}

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-0.5" aria-label="Sidebar navigation">
        {NAV.filter((item) => user?.permissions?.includes(NAV_ACCESS[item.to])).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavClick}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-all font-sans text-sm font-medium group",
                collapsed ? "justify-center" : "",
                isActive
                  ? "bg-primary-500/15 text-primary-400"
                  : "text-secondary-400 hover:bg-secondary-800 hover:text-white",
              ].join(" ")
            }
          >
            {({ isActive }) => (
              <>
                <span className={["shrink-0 transition-colors", isActive ? "text-primary-400" : "text-secondary-500 group-hover:text-white"].join(" ")}>
                  {item.icon}
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-3 border-t border-secondary-800" />

      {/* Bottom nav */}
      <div className="py-2 px-2 flex flex-col gap-0.5">
        {BOTTOM_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            onClick={onNavClick}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-all font-sans text-sm font-medium group",
                collapsed ? "justify-center" : "",
                isActive
                  ? "bg-primary-500/15 text-primary-400"
                  : "text-secondary-400 hover:bg-secondary-800 hover:text-white",
              ].join(" ")
            }
          >
            {({ isActive }) => (
              <>
                <span className={["shrink-0 transition-colors", isActive ? "text-primary-400" : "text-secondary-500 group-hover:text-white"].join(" ")}>
                  {item.icon}
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}

        {/* User + logout */}
        {!collapsed && (
          <div className="flex items-center gap-3 px-2.5 py-2.5 mt-1 rounded-xl bg-primary-800/50 border border-secondary-700/50">
            <div className="shrink-0 size-7 rounded-full bg-primary-500/20 border border-primary-500/30 flex items-center justify-center text-xs font-bold text-primary-400 font-sans">
              {user?.name?.charAt(0).toUpperCase() ?? "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-secondary-200 font-sans truncate">{user?.name ?? "User"}</p>
              <p className="text-xs text-secondary-600 font-sans truncate">{user?.email ?? ""}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              title="Sign out"
              className="shrink-0 p-1 rounded-lg text-secondary-500 hover:text-error-400 hover:bg-error-500/10 transition-colors"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </button>
          </div>
        )}
        {collapsed && (
          <div className="flex flex-col items-center gap-1 px-2.5 py-2.5 mt-1">
            <div className="size-7 rounded-full bg-primary-500/20 border border-primary-500/30 flex items-center justify-center text-xs font-bold text-primary-400 font-sans">
              {user?.name?.charAt(0).toUpperCase() ?? "U"}
            </div>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              title="Sign out"
              className="p-1 rounded-lg text-secondary-500 hover:text-error-400 hover:bg-error-500/10 transition-colors"
            >
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
