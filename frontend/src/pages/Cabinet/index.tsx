import { useState } from "react";
import { motion } from "framer-motion";
import {
  Shield, Download, QrCode, RefreshCw,
  LogOut, Clock, Server, ArrowLeft, Mail, Hash,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { QRCodeSVG } from "qrcode.react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../api/client";

type LoginMode = "id" | "email";

export default function Cabinet() {
  const navigate = useNavigate();
  const [clientId, setClientId] = useState(() => localStorage.getItem("cabinet_id") || "");
  const [mode, setMode]   = useState<LoginMode>("email");
  const [input, setInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [qrConfig, setQrConfig] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-client", clientId],
    queryFn: async () => (await api.get(`/portal/client/${clientId}`)).data.client,
    enabled: !!clientId,
    retry: false,
  });

  async function login() {
    const val = input.trim();
    if (!val) { setLoginError(mode === "email" ? "Введите email" : "Введите ID"); return; }
    setLoginError(""); setLoginLoading(true);
    try {
      const payload = mode === "email" ? { email: val } : { client_id: val };
      const { data: d } = await api.post("/portal/auth", payload);
      const id = d.client_id || d.client?.id;
      localStorage.setItem("cabinet_id", id);
      setClientId(id);
    } catch (e: any) {
      const msg = e.response?.data?.detail;
      if (e.response?.status === 404) {
        setLoginError(mode === "email"
          ? "Клиент с таким email не найден"
          : "Клиент с таким ID не найден");
      } else {
        setLoginError(msg || "Ошибка входа");
      }
    } finally {
      setLoginLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("cabinet_id");
    setClientId(""); setInput("");
  }

  async function downloadConfig() {
    const res = await api.get(`/portal/client/${clientId}/config`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = `${data?.name || clientId}.conf`; a.click();
    URL.revokeObjectURL(url);
  }

  async function showQr() {
    const { data: d } = await api.get(`/portal/client/${clientId}/config`);
    setQrConfig(d.config);
  }

  const expiresDate = data?.expires_at ? new Date(data.expires_at) : null;
  const daysLeft = expiresDate
    ? Math.ceil((expiresDate.getTime() - Date.now()) / 86_400_000)
    : null;

  // ── Login screen ─────────────────────────────────────────────────────────────
  if (!clientId) {
    return (
      <div className="min-h-screen bg-[#080b0f] flex flex-col">
        <div className="absolute inset-0 bg-radial-green pointer-events-none" />

        {/* Back to home */}
        <div className="relative z-10 px-6 pt-5">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={15} /> На главную
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center px-4">
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
              <h1 className="text-lg font-semibold text-white text-center mb-1">
                Кабинет клиента
              </h1>
              <p className="text-sm text-slate-400 text-center mb-5">
                Управляйте своей подпиской
              </p>

              {/* Mode toggle */}
              <div className="flex rounded-xl bg-white/5 p-0.5 mb-4">
                {([["email", "По email", Mail], ["id", "По ID", Hash]] as const).map(
                  ([m, label, Icon]) => (
                    <button
                      key={m}
                      onClick={() => { setMode(m); setInput(""); setLoginError(""); }}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                        mode === m
                          ? "bg-white/10 text-white"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      <Icon size={13} /> {label}
                    </button>
                  )
                )}
              </div>

              {mode === "email" ? (
                <input
                  key="email"
                  className="input mb-3"
                  type="email"
                  placeholder="your@email.com"
                  value={input}
                  autoFocus
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && login()}
                />
              ) : (
                <input
                  key="id"
                  className="input mb-3 font-mono"
                  placeholder="Например: a1b2c3d4"
                  value={input}
                  autoFocus
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && login()}
                />
              )}

              {mode === "id" && (
                <p className="text-xs text-slate-500 mb-3">
                  ID клиента — в первой строке вашего <code className="bg-white/10 px-1 rounded">.conf</code> файла:
                  {" "}<code className="bg-white/10 px-1 rounded text-green-400"># Client ID: ...</code>
                </p>
              )}

              {loginError && (
                <p className="text-xs text-red-400 mb-3">{loginError}</p>
              )}

              <button
                className="btn-primary w-full"
                onClick={login}
                disabled={loginLoading}
              >
                {loginLoading ? <Spinner className="w-4 h-4" /> : "Войти"}
              </button>
            </Card>
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#080b0f] flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="min-h-screen bg-[#080b0f] flex items-center justify-center px-4">
        <Card className="text-center max-w-sm w-full">
          <p className="text-slate-400 mb-4">Клиент не найден</p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => navigate("/")}>
              На главную
            </button>
            <button className="btn-ghost flex-1" onClick={logout}>
              Другой аккаунт
            </button>
          </div>
        </Card>
      </div>
    );
  }

  // ── Cabinet ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080b0f] px-4 py-8">
      <div className="absolute inset-0 bg-radial-green pointer-events-none" />

      <div className="relative max-w-lg mx-auto">
        {/* Top nav */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={15} /> Главная
          </button>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-green-500/15 border border-green-500/30 flex items-center justify-center">
              <Shield size={13} className="text-green-400" />
            </div>
            <span className="text-sm font-medium text-white">
              {data.name || clientId}
            </span>
          </div>

          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <LogOut size={13} /> Выйти
          </button>
        </div>

        {/* Status card */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <Card glow className="mb-3">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Статус подписки</p>
                <StatusBadge status={data.status} />
              </div>
              {daysLeft !== null && (
                <div className="text-right">
                  <p className="text-xs text-slate-500 mb-1">Осталось</p>
                  <p className={`text-sm font-bold ${
                    daysLeft <= 3 ? "text-red-400"
                    : daysLeft <= 7 ? "text-yellow-400"
                    : "text-white"
                  }`}>
                    {daysLeft > 0 ? `${daysLeft} дн.` : "Истёк"}
                  </p>
                </div>
              )}
            </div>

            {expiresDate && (
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                <Clock size={12} />
                Действует до {format(expiresDate, "d MMMM yyyy", { locale: ru })}
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Server size={12} />
              <span>Сервер: {data.server_id}</span>
              <span className="ml-auto font-mono opacity-50">ID: {data.id}</span>
            </div>
          </Card>
        </motion.div>

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
        >
          <div className="grid grid-cols-2 gap-3 mb-3">
            <button
              onClick={downloadConfig}
              className="glass glass-hover rounded-2xl p-4 flex flex-col items-center gap-2"
            >
              <Download size={20} className="text-green-400" />
              <span className="text-xs text-slate-300 font-medium">Скачать .conf</span>
            </button>
            <button
              onClick={showQr}
              className="glass glass-hover rounded-2xl p-4 flex flex-col items-center gap-2"
            >
              <QrCode size={20} className="text-green-400" />
              <span className="text-xs text-slate-300 font-medium">QR-код</span>
            </button>
          </div>

          <Card className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white mb-0.5">Продлить подписку</p>
              <p className="text-xs text-slate-500">Выберите новый период</p>
            </div>
            <button className="btn-primary text-xs px-4 py-2">
              <RefreshCw size={13} /> Продлить
            </button>
          </Card>
        </motion.div>
      </div>

      {/* QR Modal */}
      <Modal open={!!qrConfig} onClose={() => setQrConfig(null)} title="QR-код" size="sm">
        <div className="flex justify-center">
          {qrConfig && (
            <div className="p-4 bg-white rounded-2xl">
              <QRCodeSVG value={qrConfig} size={220} />
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500 text-center mt-4">
          Отсканируйте в приложении AmneziaVPN или WireGuard
        </p>
      </Modal>
    </div>
  );
}
