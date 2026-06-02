import { useState } from "react";
import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";
import { useAuthStore } from "../../store/auth";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setAdmin } = useAuthStore();
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { username, password });
      setAdmin(data.admin, data.access_token, data.refresh_token);
      navigate("/admin");
    } catch (e: any) {
      setError(e.response?.data?.detail || "Неверный логин или пароль");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080b0f] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-radial-green pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-sm"
      >
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-green-500/15 border border-green-500/30 flex items-center justify-center">
            <Shield size={22} className="text-green-400" />
          </div>
        </div>
        <Card glow>
          <h1 className="text-lg font-semibold text-white text-center mb-1">Вход для администратора</h1>
          <p className="text-sm text-slate-400 text-center mb-6">VPN Panel</p>
          <form onSubmit={submit} className="space-y-3">
            <input
              className="input"
              placeholder="Логин"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
            />
            <input
              className="input"
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button className="btn-primary w-full mt-1" type="submit" disabled={loading}>
              {loading ? <Spinner className="w-4 h-4" /> : "Войти"}
            </button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
