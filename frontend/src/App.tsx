import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { useSessionGuard } from "./hooks/useSessionGuard";
import Landing from "./pages/Landing";
import Cabinet from "./pages/Cabinet";
import AdminLogin from "./pages/Admin/Login";
import Dashboard from "./pages/Admin/Dashboard";
import Clients from "./pages/Admin/Clients";
import Orders from "./pages/Admin/Orders";
import Audit from "./pages/Admin/Audit";
import Servers from "./pages/Admin/Servers";
import Settings from "./pages/Admin/Settings";
import { AdminLayout } from "./pages/Admin/Layout";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { admin } = useAuthStore();
  if (!admin) return <Navigate to="/admin/login" replace />;
  return children;
}

function AdminPage({ children }: { children: JSX.Element }) {
  return (
    <RequireAuth>
      <AdminLayout>{children}</AdminLayout>
    </RequireAuth>
  );
}

export default function App() {
  useSessionGuard();
  return (
    <Routes>
      <Route path="/"             element={<Landing />} />
      <Route path="/cabinet"      element={<Cabinet />} />
      <Route path="/admin/login"  element={<AdminLogin />} />
      <Route path="/admin"        element={<AdminPage><Dashboard /></AdminPage>} />
      <Route path="/admin/clients"element={<AdminPage><Clients /></AdminPage>} />
      <Route path="/admin/servers"element={<AdminPage><Servers /></AdminPage>} />
      <Route path="/admin/orders" element={<AdminPage><Orders /></AdminPage>} />
      <Route path="/admin/audit"  element={<AdminPage><Audit /></AdminPage>} />
      <Route path="/admin/settings" element={<AdminPage><Settings /></AdminPage>} />
      <Route path="*"             element={<Navigate to="/" replace />} />
    </Routes>
  );
}
