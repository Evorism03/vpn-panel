import { useState } from "react";
import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";
import { useAuthStore } from "../../store/auth";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const { setAdmin }            = useAuthStore();
  const navigate                = useNavigate();

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
    <div className="min-h-screen bg-[#080b0f] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[600px] h-[600px] bg-green-500/6 blur-[120px] rounded-full" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.035]">
          <defs>
            <pattern id="lgrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#4ade80" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#lgrid)" />
        </svg>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-sm"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-7">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: "rgba(34,197,94,0.12)",
              border: "1px solid rgba(34,197,94,0.3)",
              boxShadow: "0 0 40px -8px rgba(34,197,94,0.3)",
            }}>
            <Shield size={26} className="text-green-400" />
          </div>
          <h1 className="text-lg font-bold text-white tracking-tight">VPN Admin</h1>
          <p className="text-xs text-slate-600 mt-0.5">Панель управления</p>
        </div>

        {/* Form card */}
        <div className="relative rounded-2xl p-6"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 0 60px -20px rgba(34,197,94,0.12)",
          }}>
          {/* Top accent line */}
          <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl
            bg-gradient-to-r from-transparent via-green-500/30 to-transparent" />

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Логин</label>
              <input
                className="input"
                placeholder="admin"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Пароль</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded-xl text-xs text-red-400"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                {error}
              </div>
            )}

            <button className="btn-primary w-full py-2.5 mt-1" type="submit" disabled={loading}>
              {loading ? <Spinner className="w-4 h-4" /> : "Войти"}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-slate-700 mt-5">
          Только для авторизованного персонала
        </p>
      </motion.div>
    </div>
  );
}
