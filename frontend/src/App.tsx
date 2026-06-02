import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import Landing from "./pages/Landing";
import Cabinet from "./pages/Cabinet";
import AdminLogin from "./pages/Admin/Login";
import Dashboard from "./pages/Admin/Dashboard";
import Clients from "./pages/Admin/Clients";
import Orders from "./pages/Admin/Orders";
import Audit from "./pages/Admin/Audit";
import Settings from "./pages/Admin/Settings";
import { AdminLayout } from "./pages/Admin/Layout";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { admin } = useAuthStore();
  if (!admin) return <Navigate to="/admin/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/cabinet" element={<Cabinet />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={
        <RequireAuth>
          <AdminLayout><Dashboard /></AdminLayout>
        </RequireAuth>
      } />
      <Route path="/admin/clients" element={
        <RequireAuth>
          <AdminLayout><Clients /></AdminLayout>
        </RequireAuth>
      } />
      <Route path="/admin/orders" element={
        <RequireAuth>
          <AdminLayout><Orders /></AdminLayout>
        </RequireAuth>
      } />
      <Route path="/admin/audit" element={
        <RequireAuth>
          <AdminLayout><Audit /></AdminLayout>
        </RequireAuth>
      } />
      <Route path="/admin/settings" element={
        <RequireAuth>
          <AdminLayout><Settings /></AdminLayout>
        </RequireAuth>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
