import { useState } from "react";
import { motion } from "framer-motion";
import { Shield, Download, QrCode, RefreshCw, LogOut, Clock, Server } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { QRCodeSVG } from "qrcode.react";
import { Card } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../api/client";

export default function Cabinet() {
  const [clientId, setClientId] = useState(() => localStorage.getItem("cabinet_id") || "");
  const [inputId, setInputId] = useState("");
  const [loginError, setLoginError] = useState("");
  const [qrConfig, setQrConfig] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["portal-client", clientId],
    queryFn: async () => {
      const { data } = await api.get(`/portal/client/${clientId}`);
      return data.client;
    },
    enabled: !!clientId,
    retry: false,
  });

  function login() {
    if (!inputId.trim()) { setLoginError("Введите ID клиента"); return; }
    localStorage.setItem("cabinet_id", inputId.trim());
    setClientId(inputId.trim());
    setLoginError("");
  }

  function logout() {
    localStorage.removeItem("cabinet_id");
    setClientId("");
    setInputId("");
  }

  async function downloadConfig() {
    const res = await api.get(`/portal/client/${clientId}/config`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data?.name || clientId}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function showQr() {
    const { data: d } = await api.get(`/portal/client/${clientId}/config`);
    setQrConfig(d.config);
  }

  const expiresDate = data?.expires_at ? new Date(data.expires_at) : null;
  const daysLeft = expiresDate ? Math.ceil((expiresDate.getTime() - Date.now()) / 86_400_000) : null;

  if (!clientId) {
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
            <h1 className="text-lg font-semibold text-white text-center mb-1">Кабинет клиента</h1>
            <p className="text-sm text-slate-400 text-center mb-6">Введите ваш Client ID из конфигурации</p>
            <input
              className="input mb-1.5"
              placeholder="Например: a1b2c3d4"
              value={inputId}
              onChange={e => setInputId(e.target.value)}
              onKeyDown={e => e.key === "Enter" && login()}
            />
            {loginError && <p className="text-xs text-red-400 mb-3">{loginError}</p>}
            <button className="btn-primary w-full mt-3" onClick={login}>Войти</button>
          </Card>
        </motion.div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#080b0f] flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#080b0f] flex items-center justify-center px-4">
        <Card className="text-center max-w-sm w-full">
          <p className="text-slate-400 mb-4">Клиент не найден</p>
          <button className="btn-ghost" onClick={logout}>← Назад</button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080b0f] px-4 py-10">
      <div className="absolute inset-0 bg-radial-green pointer-events-none" />

      <div className="relative max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-500/15 border border-green-500/30 flex items-center justify-center">
              <Shield size={17} className="text-green-400" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Кабинет клиента</p>
              <p className="text-sm font-medium text-white">{data.name || clientId}</p>
            </div>
          </div>
          <button onClick={logout} className="btn-ghost text-xs gap-1.5 px-3 py-2">
            <LogOut size={14} /> Выйти
          </button>
        </div>

        {/* Status card */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <Card glow className="mb-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Статус подписки</p>
                <StatusBadge status={data.status} />
              </div>
              {daysLeft !== null && (
                <div className="text-right">
                  <p className="text-xs text-slate-500 mb-1">Осталось</p>
                  <p className={`text-sm font-semibold ${daysLeft <= 7 ? "text-red-400" : "text-white"}`}>
                    {daysLeft > 0 ? `${daysLeft} дн.` : "Истёк"}
                  </p>
                </div>
              )}
            </div>

            {expiresDate && (
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-4">
                <Clock size={13} />
                Действует до {format(expiresDate, "d MMMM yyyy", { locale: ru })}
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Server size={13} />
              <span>Сервер: {data.server_id}</span>
              <span className="ml-auto text-slate-600">ID: {data.id}</span>
            </div>
          </Card>
        </motion.div>

        {/* Actions */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button onClick={downloadConfig} className="glass glass-hover rounded-2xl p-4 flex flex-col items-center gap-2 text-center">
              <Download size={20} className="text-green-400" />
              <span className="text-xs text-slate-300 font-medium">Скачать .conf</span>
            </button>
            <button onClick={showQr} className="glass glass-hover rounded-2xl p-4 flex flex-col items-center gap-2 text-center">
              <QrCode size={20} className="text-green-400" />
              <span className="text-xs text-slate-300 font-medium">QR-код</span>
            </button>
          </div>

          <Card className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white mb-0.5">Продлить подписку</p>
              <p className="text-xs text-slate-500">Выберите новый период</p>
            </div>
            <button onClick={() => {}} className="btn-primary text-xs px-4 py-2">
              <RefreshCw size={13} /> Продлить
            </button>
          </Card>
        </motion.div>
      </div>

      {/* QR Modal */}
      <Modal open={!!qrConfig} onClose={() => setQrConfig(null)} title="QR-код конфигурации" size="sm">
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
