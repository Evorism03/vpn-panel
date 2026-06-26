import { useState } from "react";
import { motion } from "framer-motion";
import {
  Shield, Download, QrCode, RefreshCw,
  LogOut, Clock, ArrowLeft, Mail, Hash,
  Circle, Plus,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { QrModal } from "../../components/ui/QrModal";
import { PurchaseModal } from "./PurchaseModal";
import { api } from "../../api/client";

interface ClientInfo {
  id: string; name: string; contact: string;
  status: string; expires_at: string | null;
  created_at: string; server_id: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysLeft(expires_at: string | null): number | null {
  if (!expires_at) return null;
  return Math.ceil((new Date(expires_at).getTime() - Date.now()) / 86_400_000);
}

function ExpiryBadge({ expires_at }: { expires_at: string | null }) {
  const days = daysLeft(expires_at);
  if (days === null) return <span className="text-xs text-slate-500">Бессрочно</span>;
  if (days <= 0)  return <span className="text-xs font-medium text-red-400">Истёк</span>;
  if (days <= 3)  return <span className="text-xs font-medium text-red-400">{days} дн. осталось</span>;
  if (days <= 7)  return <span className="text-xs font-medium text-yellow-400">{days} дн. осталось</span>;
  return <span className="text-xs text-slate-400">{days} дн.</span>;
}

// ── Login screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: {
  onLogin: (primaryId: string, clients: ClientInfo[]) => void
}) {
  const navigate = useNavigate();
  const [mode, setMode]     = useState<"email" | "id">("email");
  const [input, setInput]   = useState("");
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const val = input.trim();
    if (!val) { setError(mode === "email" ? "Введите email" : "Введите ID"); return; }
    setError(""); setLoading(true);
    try {
      const { data } = await api.post("/portal/auth",
        mode === "email" ? { email: val } : { client_id: val }
      );
      onLogin(data.client_id, data.clients ?? [data.client]);
    } catch (e: any) {
      setError(
        e.response?.status === 404
          ? mode === "email" ? "Email не найден" : "ID не найден"
          : e.response?.data?.detail || "Ошибка входа"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080b0f] flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[600px] h-[600px] bg-green-500/6 blur-[120px] rounded-full" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.03]">
          <defs>
            <pattern id="cgrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#4ade80" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#cgrid)" />
        </svg>
      </div>

      <div className="relative z-10 px-6 pt-5">
        <button onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={15} /> На главную
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="relative w-full max-w-sm">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-green-500/15 border border-green-500/30 flex items-center justify-center">
              <Shield size={22} className="text-green-400" />
            </div>
          </div>
          <div className="glass rounded-2xl p-6" style={{ boxShadow: "0 0 40px -8px rgba(34,197,94,0.15)" }}>
            <h1 className="text-lg font-semibold text-white text-center mb-1">Кабинет клиента</h1>
            <p className="text-sm text-slate-400 text-center mb-5">Управляйте своей подпиской</p>

            {/* Mode toggle */}
            <div className="flex rounded-xl p-0.5 mb-4" style={{ background: "rgba(255,255,255,0.05)" }}>
              {([["email", "По email", Mail], ["id", "По ID", Hash]] as const).map(([m, label, Icon]) => (
                <button key={m} type="button"
                  onClick={() => { setMode(m); setInput(""); setError(""); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                    mode === m ? "text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                  style={mode === m ? { background: "rgba(255,255,255,0.10)" } : {}}
                >
                  <Icon size={13} />{label}
                </button>
              ))}
            </div>

            <input
              className="input mb-1"
              type={mode === "email" ? "email" : "text"}
              placeholder={mode === "email" ? "your@email.com" : "a1b2c3d4"}
              value={input}
              autoFocus
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
            />
            <p className="text-xs text-slate-600 mb-3">
              {mode === "email"
                ? "Все подписки этого email будут показаны"
                : "ID в первой строке .conf файла: # Client ID: ..."}
            </p>

            {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

            <button type="button" className="btn-primary w-full" onClick={submit} disabled={loading}>
              {loading ? <Spinner className="w-4 h-4" /> : "Войти"}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ── Subscription card ─────────────────────────────────────────────────────────

function SubCard({ client, onDownload, onQr, onRenew }: {
  client: ClientInfo;
  onDownload: () => void;
  onQr: () => void;
  onRenew: () => void;
}) {
  const exp  = client.expires_at ? new Date(client.expires_at) : null;
  const days = daysLeft(client.expires_at);
  const urgent  = days !== null && days <= 7 && days >= 0;
  const expired = days !== null && days <= 0;

  // Progress bar: assume max subscription ~365 days, cap at 100%
  const progressPct = days === null ? null
    : days <= 0 ? 0
    : Math.min(100, Math.round((days / 365) * 100));

  const barColor = expired  ? "bg-red-500"
    : urgent  ? "bg-yellow-400"
    : days !== null && days <= 30 ? "bg-yellow-500"
    : "bg-green-500";

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: "rgba(255,255,255,0.04)",
      border: `1.5px solid ${urgent || expired ? "rgba(234,179,8,0.25)" : "rgba(255,255,255,0.08)"}`,
    }}>
      {/* Top info */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
              style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.2)" }}>
              <span className="text-green-400 text-base">{client.name?.[0]?.toUpperCase() || "?"}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{client.name || "Устройство"}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <StatusBadge status={client.status} />
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <ExpiryBadge expires_at={client.expires_at} />
            {exp && (
              <p className="text-xs text-slate-600 mt-0.5">
                до {format(exp, "dd.MM.yy")}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {progressPct !== null && (
          <div className="mb-2">
            <div className="h-1 w-full rounded-full bg-white/6 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-slate-600 flex items-center gap-1">
                <Clock size={9} />
                {exp ? format(exp, "d MMMM yyyy", { locale: ru }) : ""}
              </span>
              <span className="text-[10px] text-slate-700 font-mono">ID: {client.id.slice(0, 8)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        {[
          { icon: Download,  label: "Скачать",  fn: onDownload },
          { icon: QrCode,    label: "QR-код",   fn: onQr       },
          { icon: RefreshCw, label: "Продлить", fn: onRenew    },
        ].map(({ icon: Icon, label, fn }, i) => (
          <button
            key={label}
            type="button"
            onClick={fn}
            className="flex flex-col items-center gap-1.5 py-3.5 transition-all
              hover:bg-white/5 active:bg-white/10 group"
            style={i < 2 ? { borderRight: "1px solid rgba(255,255,255,0.06)" } : {}}
          >
            <Icon size={16} className="text-green-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main cabinet ──────────────────────────────────────────────────────────────

export default function Cabinet() {
  const navigate = useNavigate();
  const qc       = useQueryClient();

  const [primaryId, setPrimaryId] = useState(
    () => localStorage.getItem("cabinet_id") || ""
  );
  const [allIds, setAllIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("cabinet_ids") || "[]"); }
    catch { return []; }
  });

  const [qrData, setQrData] = useState<{ config: string; name: string } | null>(null);
  const [renewTarget,  setRenewTarget]  = useState<ClientInfo | null>(null);
  const [renewOpen,    setRenewOpen]    = useState(false);
  const [buyNewOpen,   setBuyNewOpen]   = useState(false);

  function handleLogin(id: string, clients: ClientInfo[]) {
    const ids = clients.map(c => c.id);
    localStorage.setItem("cabinet_id", id);
    localStorage.setItem("cabinet_ids", JSON.stringify(ids));
    setPrimaryId(id);
    setAllIds(ids);
  }

  function logout() {
    localStorage.removeItem("cabinet_id");
    localStorage.removeItem("cabinet_ids");
    setPrimaryId(""); setAllIds([]);
  }

  const { data: clients, isLoading } = useQuery({
    queryKey: ["portal-clients", allIds.join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        allIds.map(id =>
          api.get(`/portal/client/${id}`)
            .then(r => r.data.client as ClientInfo)
            .catch(() => null)
        )
      );
      return results.filter(Boolean) as ClientInfo[];
    },
    enabled: allIds.length > 0,
    staleTime: 2 * 60_000,
    retry: false,
  });

  async function downloadConfig(client: ClientInfo) {
    const { data } = await api.get(`/portal/client/${client.id}/config`);
    const blob = new Blob([data.config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename || `${client.name || client.id}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function showQr(client: ClientInfo) {
    const { data } = await api.get(`/portal/client/${client.id}/config`);
    setQrData({ config: data.config, name: client.name });
  }

  function openRenew(client: ClientInfo) {
    setRenewTarget(client);
    setRenewOpen(true);
  }

  function handleSuccess() {
    qc.invalidateQueries({ queryKey: ["portal-clients"] });
  }

  async function handleBuySuccess() {
    setBuyNewOpen(false);
    const contact = clients?.[0]?.contact;
    if (contact) {
      try {
        const { data } = await api.post("/portal/auth", { email: contact });
        handleLogin(data.client_id, data.clients ?? [data.client]);
        qc.invalidateQueries({ queryKey: ["portal-clients"] });
      } catch { /* ok */ }
    }
  }

  // ── Not logged in ────────────────────────────────────────────────────────────
  if (!primaryId) return <LoginScreen onLogin={handleLogin} />;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#080b0f] flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const list = clients ?? [];

  if (list.length === 0) {
    return (
      <div className="min-h-screen bg-[#080b0f] flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-6 text-center max-w-sm w-full">
          <p className="text-slate-400 mb-4">Клиент не найден</p>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={() => navigate("/")}>
              На главную
            </button>
            <button type="button" className="btn-ghost flex-1" onClick={logout}>
              Другой аккаунт
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeCount  = list.filter(c => c.status === "active").length;
  const expiredCount = list.filter(c => c.status !== "active").length;
  const userEmail    = list[0]?.contact;

  return (
    <div className="min-h-screen bg-[#080b0f] px-4 py-8 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2
          w-[500px] h-[400px] bg-green-500/5 blur-[100px] rounded-full" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.025]">
          <defs>
            <pattern id="mgrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#4ade80" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#mgrid)" />
        </svg>
      </div>

      <div className="relative max-w-lg mx-auto">

        {/* Top nav */}
        <div className="flex items-center justify-between mb-6">
          <button type="button" onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={15} /> Главная
          </button>

          <div className="flex items-center gap-2">
            <Shield size={14} className="text-green-400" />
            <span className="text-sm font-medium text-white truncate max-w-[160px]">
              {userEmail || list[0]?.name || primaryId}
            </span>
          </div>

          <button type="button" onClick={logout}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <LogOut size={13} /> Выйти
          </button>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", color: "#4ade80" }}>
            <Circle size={5} fill="currentColor" /> {activeCount} активных
          </span>
          {expiredCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
              <Circle size={5} fill="currentColor" /> {expiredCount} истёкших
            </span>
          )}
          <span className="text-xs text-slate-600 ml-auto">
            {list.length} {list.length === 1 ? "устройство" : list.length < 5 ? "устройства" : "устройств"}
          </span>
        </div>

        {/* Subscription cards */}
        <div className="space-y-3">
          {list.map((client, i) => (
            <motion.div key={client.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}>
              <SubCard
                client={client}
                onDownload={() => downloadConfig(client)}
                onQr={() => showQr(client)}
                onRenew={() => openRenew(client)}
              />
            </motion.div>
          ))}
        </div>

        {/* Buy new device */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="mt-4">
          <button type="button" onClick={() => setBuyNewOpen(true)}
            className="w-full rounded-2xl py-3.5 flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
            style={{ border: "1.5px dashed rgba(255,255,255,0.12)" }}>
            <Plus size={16} className="text-green-400" />
            Купить ещё одно устройство
          </button>
        </motion.div>
      </div>

      {/* QR Modal */}
      <QrModal
        open={!!qrData}
        onClose={() => setQrData(null)}
        config={qrData?.config ?? ""}
        clientName={qrData?.name}
      />

      {/* Renew modal */}
      <PurchaseModal
        open={renewOpen}
        onClose={() => { setRenewOpen(false); setRenewTarget(null); }}
        clientId={renewTarget?.id}
        clientName={renewTarget?.name}
        email={userEmail}
        onSuccess={handleSuccess}
      />

      {/* Buy new modal */}
      <PurchaseModal
        open={buyNewOpen}
        onClose={() => setBuyNewOpen(false)}
        email={userEmail}
        onSuccess={handleBuySuccess}
      />
    </div>
  );
}
