import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Edit2, RefreshCw, Server, Wifi, WifiOff, Users, Settings2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../api/client";

interface RemoteServer {
  id: string;
  name: string;
  base_url: string;
  token: string;
  max_users: number;
  is_active: boolean;
  status: "online" | "offline" | "degraded" | "disabled" | "unknown";
  created_at: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  online:   "text-green-400 bg-green-500/10 border-green-500/20",
  degraded: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  offline:  "text-red-400 bg-red-500/10 border-red-500/20",
  disabled: "text-slate-500 bg-white/5 border-white/10",
  unknown:  "text-slate-400 bg-white/5 border-white/10",
};

const STATUS_LABEL: Record<string, string> = {
  online: "Online", offline: "Offline", degraded: "Degraded",
  disabled: "Disabled", unknown: "Unknown",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[status] ?? STATUS_STYLE.unknown}`}>
      {status === "online"
        ? <Wifi size={11} />
        : <WifiOff size={11} />}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const EMPTY: Partial<RemoteServer> = { name: "", base_url: "", token: "", max_users: 0 };

export default function Servers() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<Partial<RemoteServer>>(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["servers"],
    queryFn: async () => (await api.get("/admin/servers")).data.servers as RemoteServer[],
    staleTime: 20_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/servers/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["servers"] });
      const prev = qc.getQueryData<RemoteServer[]>(["servers"]);
      qc.setQueryData<RemoteServer[]>(["servers"], old => old?.filter(s => s.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => ctx?.prev && qc.setQueryData(["servers"], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["servers"] }),
  });

  function openCreate() { setForm(EMPTY); setError(""); setModal("create"); }
  function openEdit(s: RemoteServer) { setForm(s); setError(""); setModal("edit"); }

  async function save() {
    if (!form.name?.trim()) { setError("Введите название"); return; }
    if (!form.base_url?.trim()) { setError("Введите URL"); return; }
    if (!form.token?.trim()) { setError("Введите токен"); return; }
    setError(""); setSaving(true);
    try {
      if (modal === "create") {
        await api.post("/admin/servers", {
          name: form.name.trim(), base_url: form.base_url.trim(),
          token: form.token.trim(), max_users: form.max_users ?? 0,
        });
      } else {
        await api.put(`/admin/servers/${form.id}`, {
          name: form.name?.trim(), base_url: form.base_url?.trim(),
          token: form.token?.trim(), max_users: form.max_users ?? 0,
          is_active: form.is_active,
        });
      }
      qc.invalidateQueries({ queryKey: ["servers"] });
      setModal(null);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  const servers = data ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Серверы</h1>
          <p className="text-sm text-slate-500">
            Локальный + {servers.length} удалённых
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className={`btn-ghost px-3 py-2 ${isRefetching ? "opacity-50" : ""}`}
            disabled={isRefetching}
          >
            <RefreshCw size={15} className={isRefetching ? "animate-spin" : ""} />
          </button>
          <button onClick={openCreate} className="btn-primary">
            <Plus size={16} /> Добавить сервер
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <div className="space-y-3">

          {/* Local server card */}
          <LocalServerCard />

          {/* Remote servers */}
          {servers.length === 0 ? (
            <div className="rounded-2xl p-10 text-center"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)" }}>
              <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <Server size={24} className="text-slate-600" />
              </div>
              <p className="text-slate-400 text-sm mb-1">Нет удалённых серверов</p>
              <p className="text-slate-600 text-xs max-w-xs mx-auto">
                Добавьте VPS-агент для управления несколькими серверами из одной панели
              </p>
              <button onClick={openCreate} className="btn-ghost text-xs px-4 py-2 mt-4 gap-1.5">
                <Plus size={13} /> Добавить первый сервер
              </button>
            </div>
          ) : (
            servers.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <div className="rounded-2xl overflow-hidden relative"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: `1px solid ${s.status === "online" ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.07)"}`,
                  }}>
                  {/* Status left bar */}
                  <div className="absolute left-0 top-0 bottom-0 w-0.5"
                    style={{
                      background: s.status === "online" ? "rgba(34,197,94,0.6)"
                        : s.status === "degraded" ? "rgba(234,179,8,0.6)"
                        : s.status === "offline"  ? "rgba(239,68,68,0.6)"
                        : "rgba(100,116,139,0.3)",
                    }} />

                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                      s.status === "online" ? "bg-green-500/10 border-green-500/20"
                      : s.status === "offline" ? "bg-red-500/10 border-red-500/20"
                      : "bg-white/5 border-white/10"
                    }`}>
                      <Server size={18} className={
                        s.status === "online" ? "text-green-400"
                        : s.status === "offline" ? "text-red-400"
                        : "text-slate-500"
                      } />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-white">{s.name}</p>
                        <StatusDot status={s.status} />
                        {!s.is_active && (
                          <span className="text-xs text-slate-600 bg-white/5 px-2 py-0.5 rounded-full">отключён</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-600">
                        <span className="truncate font-mono">{s.base_url}</span>
                        {s.max_users > 0 && (
                          <span className="flex items-center gap-1 shrink-0 text-slate-500">
                            <Users size={10} /> макс. {s.max_users}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                        className="p-2 rounded-xl text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                        title="Статистика"
                      >
                        <Users size={14} />
                      </button>
                      <button
                        onClick={() => openEdit(s)}
                        className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/8 transition-colors"
                        title="Редактировать"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => { if (confirm(`Удалить сервер «${s.name}»?`)) deleteMut.mutate(s.id); }}
                        className="p-2 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Удалить"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded stats */}
                  <AnimatePresence>
                    {expandedId === s.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 pt-1 border-t"
                          style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                          <RemoteStats serverId={s.id} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === "create" ? "Добавить сервер" : "Редактировать сервер"}
        size="md"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1.5">Название</label>
              <input className="input" placeholder="VPS Москва" value={form.name ?? ""}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1.5">URL панели</label>
              <input className="input" placeholder="http://45.15.x.x:8090" value={form.base_url ?? ""}
                onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} />
              <p className="text-xs text-slate-600 mt-1">Адрес backend этой панели на удалённом VPS</p>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1.5">Admin Token</label>
              <input className="input font-mono text-xs" placeholder="SECRET_KEY с того сервера"
                value={form.token ?? ""}
                onChange={e => setForm(f => ({ ...f, token: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Макс. клиентов</label>
              <input className="input" type="number" min="0" placeholder="0 = без лимита"
                value={form.max_users ?? 0}
                onChange={e => setForm(f => ({ ...f, max_users: parseInt(e.target.value) || 0 }))} />
            </div>
            {modal === "edit" && (
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" className="w-4 h-4 accent-green-500 rounded"
                    checked={form.is_active ?? true}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span className="text-sm text-slate-300">Активен</span>
                </label>
              </div>
            )}
          </div>

          {/* Help */}
          <div className="rounded-xl bg-blue-500/8 border border-blue-500/20 p-3 text-xs text-blue-300 space-y-1">
            <p className="font-medium">Как добавить VPS-агент:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-400">
              <li>На удалённом VPS установи эту же панель</li>
              <li>Скопируй его <code className="bg-white/10 px-1 rounded">SECRET_KEY</code> из <code className="bg-white/10 px-1 rounded">.env</code></li>
              <li>Вставь URL и токен сюда</li>
            </ol>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button className="btn-ghost flex-1" onClick={() => setModal(null)}>Отмена</button>
            <button className="btn-primary flex-1" onClick={save} disabled={saving}>
              {saving ? <Spinner className="w-4 h-4" /> : modal === "create" ? "Добавить" : "Сохранить"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Local server card ──────────────────────────────────────────────────────────
function LocalServerCard() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [maxInput, setMaxInput] = useState("0");
  const [saving, setSaving] = useState(false);

  const { data: local, refetch } = useQuery({
    queryKey: ["local-server"],
    queryFn: async () => (await api.get("/admin/servers/local")).data,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const active   = local?.active_count ?? 0;
  const maxUsers = local?.max_users ?? 0;
  const isFull   = local?.is_full ?? false;
  const pct      = maxUsers > 0 ? Math.min(100, Math.round((active / maxUsers) * 100)) : null;

  function openEdit() { setMaxInput(String(maxUsers)); setEditing(true); }

  async function saveLimit() {
    setSaving(true);
    try {
      await api.patch("/admin/servers/local", { max_users: parseInt(maxInput) || 0 });
      await refetch();
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const barColor = pct === null ? "bg-green-500"
    : pct >= 100 ? "bg-red-500"
    : pct >= 80  ? "bg-yellow-500"
    : "bg-green-500";

  return (
    <Card glow>
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center shrink-0">
          <Server size={18} className="text-green-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-white">{local?.name ?? "Локальный сервер"}</p>
            <StatusDot status="online" />
            {isFull && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400">
                Заполнен
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-2">AWG · этот сервер</p>

          {/* Capacity bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: pct !== null ? `${pct}%` : "0%" }}
              />
            </div>
            <span className="text-xs text-slate-400 shrink-0 tabular-nums">
              {active}
              {maxUsers > 0 ? ` / ${maxUsers}` : ""} активных
            </span>
          </div>
        </div>

        <button
          onClick={openEdit}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/8 transition-colors shrink-0"
          title="Настроить лимит"
        >
          <Settings2 size={16} />
        </button>
      </div>

      {/* Inline edit */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-white/8 flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1.5">
                  Макс. клиентов <span className="text-slate-600">(0 = без лимита)</span>
                </label>
                <input
                  className="input"
                  type="number" min="0"
                  value={maxInput}
                  onChange={e => setMaxInput(e.target.value)}
                  autoFocus
                />
              </div>
              <button className="btn-ghost px-4 py-2" onClick={() => setEditing(false)}>Отмена</button>
              <button className="btn-primary px-4 py-2" onClick={saveLimit} disabled={saving}>
                {saving ? <Spinner className="w-4 h-4" /> : "Сохранить"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ── Remote stats widget ────────────────────────────────────────────────────────
function RemoteStats({ serverId }: { serverId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["server-stats", serverId],
    queryFn: async () => (await api.get(`/admin/servers/${serverId}/stats`)).data,
    staleTime: 30_000,
  });

  if (isLoading) return <div className="flex justify-center py-3"><Spinner className="w-4 h-4" /></div>;
  if (!data) return <p className="text-xs text-slate-500 py-2">Нет данных</p>;

  return (
    <div className="grid grid-cols-4 gap-2 mt-3">
      {[
        { label: "Всего",    value: data.clients?.total   ?? "—", color: "text-white",        bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)" },
        { label: "Активных", value: data.clients?.active  ?? "—", color: "text-green-400",    bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.15)"   },
        { label: "Истёкших", value: data.clients?.expired ?? "—", color: "text-red-400",      bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.15)"   },
        { label: "Заказов",  value: data.orders?.pending  ?? "—", color: "text-yellow-400",   bg: "rgba(234,179,8,0.08)",  border: "rgba(234,179,8,0.15)"   },
      ].map(item => (
        <div key={item.label} className="rounded-xl px-3 py-2.5 text-center"
          style={{ background: item.bg, border: `1px solid ${item.border}` }}>
          <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
          <p className="text-[10px] text-slate-600 mt-0.5">{item.label}</p>
        </div>
      ))}
    </div>
  );
}
