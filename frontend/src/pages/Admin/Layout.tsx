import { ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { useSSE } from "../../hooks/useSSE";
import {
  LayoutDashboard, Users, ShoppingCart, Settings,
  LogOut, Shield, Menu, ClipboardList,
} from "lucide-react";
import { useAuthStore } from "../../store/auth";

const NAV = [
  { to: "/admin",         icon: LayoutDashboard, label: "Дашборд",    exact: true },
  { to: "/admin/clients", icon: Users,           label: "Клиенты"                 },
  { to: "/admin/orders",  icon: ShoppingCart,    label: "Заказы"                  },
  { to: "/admin/audit",   icon: ClipboardList,   label: "Аудит"                   },
  { to: "/admin/settings",icon: Settings,        label: "Настройки"               },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const { admin, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useSSE(); // real-time updates for all admin tabs

  function doLogout() {
    logout();
    navigate("/admin/login");
  }

  return (
    <div className="min-h-screen bg-[#080b0f] flex">
      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex flex-col w-56 glass border-r border-white/6 transition-transform duration-200",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/6">
          <div className="w-7 h-7 rounded-lg bg-green-500/20 border border-green-500/30 flex items-center justify-center shrink-0">
            <Shield size={14} className="text-green-400" />
          </div>
          <span className="font-semibold text-white text-sm">VPN Admin</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, icon: Icon, label, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                isActive
                  ? "bg-green-500/15 text-green-400 font-medium"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              )}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Admin info */}
        <div className="px-3 py-4 border-t border-white/6">
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group cursor-default">
            <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center text-xs text-green-400 font-medium shrink-0">
              {admin?.display_name?.[0] || admin?.username?.[0] || "A"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{admin?.display_name || admin?.username}</p>
              <p className="text-[10px] text-slate-500">{admin?.role}</p>
            </div>
            <button onClick={doLogout} className="p-1 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <main className="flex-1 lg:ml-56 min-h-screen">
        {/* Mobile topbar */}
        <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 lg:hidden glass border-b border-white/6">
          <button onClick={() => setSidebarOpen(true)} className="p-1.5 text-slate-400 hover:text-white">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-green-400" />
            <span className="text-sm font-medium text-white">VPN Admin</span>
          </div>
        </div>
        <div className="p-5 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
