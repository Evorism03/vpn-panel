import { ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { useSSE } from "../../hooks/useSSE";
import {
  LayoutDashboard, Users, ShoppingCart, Settings,
  LogOut, Shield, Menu, ClipboardList, Server, X, Terminal,
} from "lucide-react";
import { useAuthStore } from "../../store/auth";

const NAV = [
  { to: "/admin",           icon: LayoutDashboard, label: "Дашборд",   exact: true },
  { to: "/admin/clients",   icon: Users,           label: "Клиенты"               },
  { to: "/admin/servers",   icon: Server,          label: "Серверы"               },
  { to: "/admin/orders",    icon: ShoppingCart,    label: "Заказы"                },
  { to: "/admin/audit",     icon: ClipboardList,   label: "Аудит"                 },
  { to: "/admin/terminal",  icon: Terminal,        label: "Терминал", superadmin: true },
  { to: "/admin/settings",  icon: Settings,        label: "Настройки"             },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const { admin, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useSSE();

  function doLogout() {
    logout();
    navigate("/admin/login");
  }

  const sidebar = (
    <aside
      className={clsx(
        "fixed inset-y-0 left-0 z-40 flex flex-col w-56 transition-transform duration-200",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}
      style={{
        background: "rgba(8,11,15,0.97)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* Top gradient accent */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-green-500/40 to-transparent" />

      {/* Logo */}
      <div className="flex items-center justify-between px-5 py-5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)" }}>
            <Shield size={14} className="text-green-400" />
          </div>
          <span className="font-semibold text-white text-sm tracking-tight">VPN Admin</span>
        </div>
        {/* Mobile close */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden p-1 text-slate-600 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
        {NAV.filter(item => !item.superadmin || admin?.role === "superadmin").map(({ to, icon: Icon, label, exact, superadmin: _sa }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) => clsx(
              "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 group",
              isActive
                ? "text-green-400 font-medium"
                : "text-slate-500 hover:text-slate-200 hover:bg-white/4"
            )}
            style={({ isActive }) => isActive ? {
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.15)",
            } : { border: "1px solid transparent" }}
          >
            {({ isActive }) => (
              <>
                {/* Left indicator bar */}
                {isActive && (
                  <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-r-full bg-green-400" />
                )}
                <Icon size={16} className={isActive ? "text-green-400" : "text-slate-600 group-hover:text-slate-400 transition-colors"} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Admin info + logout */}
      <div className="px-2.5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        {/* Status dot */}
        <div className="flex items-center gap-1.5 px-3 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] text-slate-600">Система в сети</span>
        </div>

        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl group"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
          {/* Avatar */}
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 text-green-400"
            style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.2)" }}>
            {admin?.display_name?.[0]?.toUpperCase() || admin?.username?.[0]?.toUpperCase() || "A"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">
              {admin?.display_name || admin?.username}
            </p>
            <p className="text-[10px] text-slate-600">{admin?.role}</p>
          </div>
          <button
            onClick={doLogout}
            title="Выйти"
            className="p-1 rounded-lg text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-[#080b0f] flex">
      {sidebar}

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <main className="flex-1 lg:ml-56 min-h-screen flex flex-col">
        {/* Mobile topbar */}
        <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 lg:hidden"
          style={{
            background: "rgba(8,11,15,0.95)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(16px)",
          }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-green-400" />
            <span className="text-sm font-medium text-white">VPN Admin</span>
          </div>
        </div>

        <div className="flex-1 p-5 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
