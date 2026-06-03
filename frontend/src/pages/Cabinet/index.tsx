import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Download, QrCode, RefreshCw,
  LogOut, Clock, Server, ArrowLeft,
  Mail, Hash, ChevronDown, Circle, Plus,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { QRCodeSVG } from "qrcode.react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { Modal } from "../../components/ui/Modal";
import { PurchaseModal } from "./PurchaseModal";
import { api } from "../../api/client";

type LoginMode = "email" | "id";

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

function DaysChip({ days }: { days: number | null }) {
  if (days === null) return <span className="text-xs text-slate-500">Бессрочно</span>;
  if (days <= 0)  return <span className="text-xs text-red-400 font-medium">Истёк</span>;
  if (days <= 3)  return <span className="text-xs text-red-400 font-medium">{days} дн.</span>;
  if (days <= 7)  return <span className="text-xs text-yellow-400 font-medium">{days} дн.</span>;
  return <span className="text-xs text-slate-300">{days} дн.</span>;
}

// ── Login ─────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: {
  onLogin: (primaryId: string, allClients: ClientInfo[]) => void
}) {
  const navigate = useNavigate();
  const [mode, setMode]     = useState<LoginMode>("email");
  const [input, setInput]   = useState("");
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const val = input.trim();
    if (!val) { setError(mode === "email" ? "Введите email" : "Введите ID"); return; }
    setError(""); setLoading(true);
    try {
      const payload = mode === "email" ? { email: val } : { client_id: val };
      const { data } = await api.post("/portal/auth", payload);
      onLogin(data.client_id, data.clients ?? [data.client]);
    } catch (e: any) {
      setError(
        e.response?.status === 404
          ? mode === "email" ? "Клиент с таким email не найден" : "ID не найден"
          : e.response?.data?.detail || "Ошибка входа"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080b0f] flex flex-col">
      <div className="absolute inset-0 bg-radial-green pointer-events-none" />

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

          <Card glow>
            <h1 className="text-lg font-semibold text-white text-center mb-1">Кабинет клиента</h1>
            <p className="text-sm text-slate-400 text-center mb-5">Управляйте своей подпиской</p>

            {/* Mode toggle */}
            <div className="flex rounded-xl bg-white/5 p-0.5 mb-4">
              {([ ["email","По email", Mail], ["id","По ID", Hash] ] as const).map(([m, label, Icon]) => (
                <button key={m}
                  onClick={() => { setMode(m); setInput(""); setError(""); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                    mode === m ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  <Icon size={13} />{label}
                </button>
              ))}
            </div>

            {mode === "email" ? (
              <>
                <input key="email" className="input mb-1" type="email"
                  placeholder="your@email.com" value={input} autoFocus
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && submit()} />
                <p className="text-xs text-slate-500 mb-3">
                  Будут показаны все подписки, привязанные к этому email
                </p>
              </>
            ) : (
              <>
                <input key="id" className="input font-mono mb-1"
                  placeholder="Например: a1b2c3d4" value={input} autoFocus
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && submit()} />
                <p className="text-xs text-slate-500 mb-3">
                  ID в первой строке <code className="bg-white/10 px-1 rounded">.conf</code>:{" "}
                  <code className="text-green-400 bg-white/10 px-1 rounded"># Client ID: ...</code>
                </p>
              </>
            )}

            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button className="btn-primary w-full" onClick={submit} disabled={loading}>
              {loading ? <Spinner className="w-4 h-4" /> : "Войти"}
            </button>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

// ── Subscription card ─────────────────────────────────────────────────────────

function SubscriptionCard({
  client, isActive, onSelect, onDownload, onQr, onRenew,
}: {
  client: ClientInfo;
  isActive: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onQr: () => void;
  onRenew: () => void;
}) {
  const days = daysLeft(client.expires_at);
  const exp  = client.expires_at ? new Date(client.expires_at) : null;

  return (
    <motion.div layout>
      <div
        className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
          isActive
            ? "border-green-500/30 shadow-[0_0_30px_-8px_rgba(34,197,94,0.2)]"
            : "border-white/8"
        }`}
      >
        {/* Header — always visible */}
        <button
          onClick={onSelect}
          className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
            isActive ? "bg-green-500/8" : "bg-white/3 hover:bg-white/5"
          }`}
        >
          {/* Avatar */}
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
            isActive ? "bg-green-500/20 text-green-400" : "bg-white/8 text-slate-400"
          }`}>
            {client.name?.[0]?.toUpperCase() || "?"}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white truncate">
                {client.name || `Устройство ${client.id}`}
              </span>
              <StatusBadge status={client.status} />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
              <Server size={10} />{client.server_id}
              {exp && (
                <span>· до {format(exp, "dd.MM.yy")}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <DaysChip days={days} />
            <ChevronDown
              size={14}
              className={`text-slate-500 transition-transform ${isActive ? "rotate-180" : ""}`}
            />
          </div>
        </button>

        {/* Expanded actions */}
        <AnimatePresence>
          {isActive && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 pt-1 border-t border-white/6">
                {exp && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-3 mt-2">
                    <Clock size={12} />
                    Действует до {format(exp, "d MMMM yyyy", { locale: ru })}
                    {days !== null && days > 0 && (
                      <span className="ml-auto text-slate-500">осталось {days} дн.</span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={onDownload}
                    className="glass glass-hover rounded-xl py-2.5 flex flex-col items-center gap-1.5"
                  >
                    <Download size={16} className="text-green-400" />
                    <span className="text-xs text-slate-300">Скачать</span>
                  </button>
                  <button
                    onClick={onQr}
                    className="glass glass-hover rounded-xl py-2.5 flex flex-col items-center gap-1.5"
                  >
                    <QrCode size={16} className="text-green-400" />
                    <span className="text-xs text-slate-300">QR-код</span>
                  </button>
                  <button
                    onClick={onRenew}
                    className="glass glass-hover rounded-xl py-2.5 flex flex-col items-center gap-1.5"
                  >
                    <RefreshCw size={16} className="text-green-400" />
                    <span className="text-xs text-slate-300">Продлить</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Main cabinet ──────────────────────────────────────────────────────────────

export default function Cabinet() {
  const navigate   = useNavigate();
  const qc         = useQueryClient();

  const [primaryId, setPrimaryId] = useState(() => localStorage.getItem("cabinet_id") || "");
  const [allIds, setAllIds]       = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("cabinet_ids") || "[]"); } catch { return []; }
  });
  const [activeId, setActiveId]   = useState<string | null>(null);
  const [qrConfig, setQrConfig]   = useState<string | null>(null);

  // Purchase / renew modal
  const [purchaseOpen, setPurchaseOpen]     = useState(false);
  const [renewTarget, setRenewTarget]       = useState<ClientInfo | null>(null);
  const [buyNewOpen, setBuyNewOpen]         = useState(false);

  function handleLogin(id: string, clients: ClientInfo[]) {
    const ids = clients.map(c => c.id);
    localStorage.setItem("cabinet_id", id);
    localStorage.setItem("cabinet_ids", JSON.stringify(ids));
    setPrimaryId(id); setAllIds(ids); setActiveId(id);
  }

  function openRenew(client: ClientInfo) {
    setRenewTarget(client);
    setPurchaseOpen(true);
  }

  function handlePurchaseSuccess() {
    // Re-fetch all client data after renewal/purchase
    qc.invalidateQueries({ queryKey: ["portal-clients"] });
  }

  function logout() {
    localStorage.removeItem("cabinet_id");
    localStorage.removeItem("cabinet_ids");
    setPrimaryId(""); setAllIds([]); setActiveId(null);
  }

  // Fetch all clients for this session
  const { data: clients, isLoading } = useQuery({
    queryKey: ["portal-clients", allIds.join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        allIds.map(id => api.get(`/portal/client/${id}`).then(r => r.data.client as ClientInfo))
      );
      return results;
    },
    enabled: allIds.length > 0,
    retry: false,
  });

  async function downloadConfig(id: string, name: string) {
    const res = await api.get(`/portal/client/${id}/config`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = `${name || id}.conf`; a.click();
    URL.revokeObjectURL(url);
  }

  async function showQr(id: string) {
    const { data } = await api.get(`/portal/client/${id}/config`);
    setQrConfig(data.config);
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
        <Card className="text-center max-w-sm w-full">
          <p className="text-slate-400 mb-4">Клиент не найден</p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => navigate("/")}>На главную</button>
            <button className="btn-ghost flex-1" onClick={logout}>Другой аккаунт</button>
          </div>
        </Card>
      </div>
    );
  }

  const activeCount  = list.filter(c => c.status === "active").length;
  const expiredCount = list.filter(c => c.status !== "active").length;

  return (
    <div className="min-h-screen bg-[#080b0f] px-4 py-8">
      <div className="absolute inset-0 bg-radial-green pointer-events-none" />

      <div className="relative max-w-lg mx-auto">
        {/* Top nav */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={15} /> Главная
          </button>

          <div className="flex items-center gap-2">
            <Shield size={14} className="text-green-400" />
            <span className="text-sm font-medium text-white truncate max-w-[150px]">
              {list[0]?.contact || list[0]?.name || primaryId}
            </span>
          </div>

          <button onClick={logout}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <LogOut size={13} /> Выйти
          </button>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
            <Circle size={5} fill="currentColor" /> {activeCount} активных
          </span>
          {expiredCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
              <Circle size={5} fill="currentColor" /> {expiredCount} истёкших
            </span>
          )}
          <span className="text-xs text-slate-600 ml-auto">
            {list.length} {list.length === 1 ? "устройство" : list.length < 5 ? "устройства" : "устройств"}
          </span>
        </div>

        {/* Subscription list */}
        <div className="space-y-2">
          {list.map((client, i) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <SubscriptionCard
                client={client}
                isActive={activeId === client.id}
                onSelect={() => setActiveId(activeId === client.id ? null : client.id)}
                onDownload={() => downloadConfig(client.id, client.name)}
                onQr={() => showQr(client.id)}
                onRenew={() => openRenew(client)}
              />
            </motion.div>
          ))}
        </div>

        {/* Buy new subscription */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mt-4"
        >
          <button
            onClick={() => setBuyNewOpen(true)}
            className="w-full glass glass-hover rounded-2xl py-3.5 flex items-center justify-center gap-2 text-sm text-slate-300 hover:text-white transition-colors border border-dashed border-white/10 hover:border-green-500/30"
          >
            <Plus size={16} className="text-green-400" />
            Купить ещё одно устройство
          </button>
        </motion.div>
      </div>

      {/* Renew modal */}
      <PurchaseModal
        open={purchaseOpen}
        onClose={() => { setPurchaseOpen(false); setRenewTarget(null); }}
        clientId={renewTarget?.id}
        clientName={renewTarget?.name}
        email={list[0]?.contact}
        onSuccess={handlePurchaseSuccess}
      />

      {/* Buy new modal */}
      <PurchaseModal
        open={buyNewOpen}
        onClose={() => setBuyNewOpen(false)}
        email={list[0]?.contact}
        onSuccess={() => {
          setBuyNewOpen(false);
          // Re-login by email to pick up new subscription
          const contact = list[0]?.contact;
          if (contact) {
            api.post("/portal/auth", { email: contact })
              .then(r => handleLogin(r.data.client_id, r.data.clients))
              .catch(() => {});
          }
        }}
      />

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
