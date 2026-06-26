import { motion } from "framer-motion";
import {
  Users, ShoppingCart, Activity, Wifi, WifiOff,
  ArrowUpRight, ArrowDownRight, Clock, Shield,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { ru } from "date-fns/locale";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";

// ── AWG dump parsing ──────────────────────────────────────────────────────────
interface PeerInfo {
  pubkey: string;
  endpoint: string;
  lastHandshake: number;
  rx: number;
  tx: number;
}

function parseDump(dump: string): PeerInfo[] {
  const lines = dump.trim().split("\n");
  const result: PeerInfo[] = [];
  for (const line of lines) {
    const p = line.split("\t");
    if (p.length < 7) continue;
    const [pubkey, , endpoint, , lastHsStr, rxStr, txStr] = p;
    if (!pubkey || pubkey === "mock") continue;
    const lastHandshake = parseInt(lastHsStr) || 0;
    if (lastHandshake === 0) continue; // never connected
    result.push({
      pubkey,
      endpoint: endpoint || "—",
      lastHandshake,
      rx: parseInt(rxStr) || 0,
      tx: parseInt(txStr) || 0,
    });
  }
  // newest first
  return result.sort((a, b) => b.lastHandshake - a.lastHandshake);
}

function formatBytes(b: number) {
  if (b === 0) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

// ── Audit action labels ───────────────────────────────────────────────────────
const ACTION_META: Record<string, { label: string; color: string; dot: string }> = {
  "client.create":  { label: "Создан клиент",  color: "text-green-400",  dot: "bg-green-400"  },
  "client.delete":  { label: "Удалён клиент",   color: "text-red-400",    dot: "bg-red-400"    },
  "client.renew":   { label: "Продлен клиент",  color: "text-blue-400",   dot: "bg-blue-400"   },
  "client.block":   { label: "Заблокирован",    color: "text-orange-400", dot: "bg-orange-400" },
  "client.unblock": { label: "Разблокирован",   color: "text-teal-400",   dot: "bg-teal-400"   },
  "order.process":  { label: "Обработан заказ", color: "text-purple-400", dot: "bg-purple-400" },
  "order.delete":   { label: "Удалён заказ",    color: "text-slate-400",  dot: "bg-slate-400"  },
  "admin.create":   { label: "Добавлен админ",  color: "text-green-400",  dot: "bg-green-400"  },
  "admin.delete":   { label: "Удалён админ",    color: "text-red-400",    dot: "bg-red-400"    },
};

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, accent, delay,
}: {
  label: string; value: string | number; sub: string;
  icon: any; accent: string; delay: number;
}) {
  const accents: Record<string, { border: string; bg: string; text: string; glow: string }> = {
    green:  { border: "rgba(34,197,94,0.3)",  bg: "rgba(34,197,94,0.1)",  text: "text-green-400",  glow: "rgba(34,197,94,0.12)"  },
    red:    { border: "rgba(239,68,68,0.3)",   bg: "rgba(239,68,68,0.1)",  text: "text-red-400",    glow: "rgba(239,68,68,0.08)"   },
    yellow: { border: "rgba(234,179,8,0.3)",   bg: "rgba(234,179,8,0.1)",  text: "text-yellow-400", glow: "rgba(234,179,8,0.08)"   },
    blue:   { border: "rgba(59,130,246,0.3)",  bg: "rgba(59,130,246,0.1)", text: "text-blue-400",   glow: "rgba(59,130,246,0.08)"  },
  };
  const a = accents[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="rounded-2xl p-5 relative overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid rgba(255,255,255,0.07)`,
        boxShadow: `0 0 40px -12px ${a.glow}`,
      }}
    >
      {/* Accent left bar */}
      <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r-full"
        style={{ background: a.border }} />

      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: a.bg, border: `1px solid ${a.border}` }}>
          <Icon size={18} className={a.text} />
        </div>
      </div>

      <p className="text-3xl font-bold text-white mb-1 tracking-tight">{value}</p>
      <p className="text-xs font-medium text-slate-300 mb-0.5">{label}</p>
      <p className="text-xs text-slate-600">{sub}</p>
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => (await api.get("/admin/stats")).data,
    refetchInterval: 15_000,
  });

  const { data: auditData } = useQuery({
    queryKey: ["audit-recent"],
    queryFn: async () => (await api.get("/admin/audit?limit=8")).data.logs,
    refetchInterval: 30_000,
  });

  const peers = data?.dump ? parseDump(data.dump) : [];
  const now = Date.now();
  const onlineCount = peers.filter(p => (now - p.lastHandshake * 1000) < 3 * 60_000).length;

  // Try to match peers to client names
  const { data: clientsData } = useQuery({
    queryKey: ["clients", "", 0],
    queryFn: async () => (await api.get("/admin/clients", { params: { limit: 500 } })).data,
    staleTime: 30_000,
  });
  const keyToName: Record<string, string> = {};
  for (const c of clientsData?.clients ?? []) {
    if (c.public_key) keyToName[c.public_key] = c.name || c.id;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Дашборд</h1>
          <p className="text-sm text-slate-500">
            {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
          </p>
        </div>
        {/* AWG status pill */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
          style={{
            background: data ? "rgba(34,197,94,0.1)" : "rgba(100,116,139,0.1)",
            border: `1px solid ${data ? "rgba(34,197,94,0.25)" : "rgba(100,116,139,0.2)"}`,
          }}>
          <span className={`w-1.5 h-1.5 rounded-full ${data ? "bg-green-400 animate-pulse" : "bg-slate-500"}`} />
          <span className={data ? "text-green-400" : "text-slate-500"}>
            AWG {data ? "Online" : "—"}
          </span>
          {onlineCount > 0 && (
            <span className="text-green-300 opacity-70">· {onlineCount} онлайн</span>
          )}
        </div>
      </div>

      {/* Stat cards */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Активных клиентов" icon={Users} accent="green" delay={0}
            value={data?.clients?.active ?? "—"}
            sub={`Всего: ${data?.clients?.total ?? "—"}`}
          />
          <StatCard
            label="Истёкших подписок" icon={Activity} accent="red" delay={0.07}
            value={data?.clients?.expired ?? "—"}
            sub="Требуют продления"
          />
          <StatCard
            label="Заказов в ожидании" icon={ShoppingCart} accent="yellow" delay={0.14}
            value={data?.orders?.pending ?? "—"}
            sub={`Выдано всего: ${data?.orders?.issued ?? "—"}`}
          />
          <StatCard
            label="Онлайн сейчас" icon={Wifi} accent="blue" delay={0.21}
            value={onlineCount}
            sub="По данным AWG dump"
          />
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid lg:grid-cols-5 gap-4">

        {/* Active connections ─ 3 cols */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="lg:col-span-3"
        >
          <div className="rounded-2xl overflow-hidden h-full"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-slate-500" />
                <span className="text-sm font-medium text-white">Подключения AWG</span>
              </div>
              <span className="text-xs text-slate-600">{peers.length} записей</span>
            </div>

            {peers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-600">
                <WifiOff size={28} className="mb-3 opacity-40" />
                <p className="text-sm">Нет данных</p>
                <p className="text-xs mt-1">AWG dump пуст или не настроен</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                {peers.slice(0, 8).map(peer => {
                  const lastSeen  = new Date(peer.lastHandshake * 1000);
                  const isOnline  = (now - peer.lastHandshake * 1000) < 3 * 60_000;
                  const name      = keyToName[peer.pubkey];
                  return (
                    <div key={peer.pubkey}
                      className="flex items-center gap-3 px-5 py-3">
                      {/* Online dot */}
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        isOnline ? "bg-green-400" : "bg-slate-700"
                      }`} />

                      {/* Name / key */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white truncate">
                          {name || peer.pubkey.slice(0, 20) + "…"}
                        </p>
                        <p className="text-[10px] text-slate-600 truncate">
                          {peer.endpoint !== "—" ? peer.endpoint : peer.pubkey.slice(0, 28) + "…"}
                        </p>
                      </div>

                      {/* Traffic */}
                      <div className="hidden sm:flex flex-col items-end gap-0.5 text-[10px] text-slate-600 shrink-0">
                        <span className="flex items-center gap-1">
                          <ArrowDownRight size={10} className="text-green-500" />
                          {formatBytes(peer.rx)}
                        </span>
                        <span className="flex items-center gap-1">
                          <ArrowUpRight size={10} className="text-blue-500" />
                          {formatBytes(peer.tx)}
                        </span>
                      </div>

                      {/* Last seen */}
                      <div className="text-[10px] shrink-0 text-right"
                        style={{ minWidth: 70 }}>
                        {isOnline ? (
                          <span className="text-green-400 font-medium">Онлайн</span>
                        ) : (
                          <span className="text-slate-600">
                            {formatDistanceToNow(lastSeen, { addSuffix: true, locale: ru })}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>

        {/* Recent activity ─ 2 cols */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32 }}
          className="lg:col-span-2"
        >
          <div className="rounded-2xl overflow-hidden h-full"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center gap-2 px-5 py-4 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <Clock size={14} className="text-slate-500" />
              <span className="text-sm font-medium text-white">Последние действия</span>
            </div>

            {!auditData || auditData.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-slate-600 text-sm">
                Нет записей
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                {auditData.map((entry: any) => {
                  const meta = ACTION_META[entry.action];
                  return (
                    <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                      {/* Color dot */}
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        meta?.dot ?? "bg-slate-500"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${meta?.color ?? "text-slate-300"}`}>
                          {meta?.label ?? entry.action}
                        </p>
                        <p className="text-[10px] text-slate-600 truncate">
                          {entry.admin_username && `@${entry.admin_username} · `}
                          {entry.entity_id}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-700 shrink-0">
                        {entry.created_at
                          ? formatDistanceToNow(new Date(entry.created_at), { addSuffix: true, locale: ru })
                          : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
