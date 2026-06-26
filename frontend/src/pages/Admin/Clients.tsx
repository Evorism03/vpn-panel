import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, Download, Trash2, RefreshCw,
  QrCode, ChevronDown, Key, Calendar, Clock,
  Wifi, WifiOff, Server, Mail, CheckSquare,
  Square, X, RotateCcw, ShieldCheck, ShieldOff, Users,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { Modal } from "../../components/ui/Modal";
import { QrModal } from "../../components/ui/QrModal";
import { api } from "../../api/client";
import { useDebounce } from "../../hooks/useDebounce";

interface Client {
  id: string; name: string; public_key: string; contact: string;
  status: string; expires_at: string | null; created_at: string;
  server_id: string; blocked_at: string | null;
}

// ── Парсинг AWG dump для last handshake ───────────────────────────────────────
// Формат строки dump: pubkey\tpsk\tendpoint\tallowed_ips\tlast_handshake\trx\ttx\tkeepalive
function parseDump(dump: string): Record<string, { lastHandshake: number; rx: number; tx: number }> {
  const result: Record<string, { lastHandshake: number; rx: number; tx: number }> = {};
  for (const line of dump.split("\n")) {
    const parts = line.trim().split("\t");
    if (parts.length < 7) continue;
    const [pubkey, , , , lastHandshakeStr, rxStr, txStr] = parts;
    if (!pubkey || pubkey === "mock") continue;
    result[pubkey] = {
      lastHandshake: parseInt(lastHandshakeStr) || 0,
      rx: parseInt(rxStr) || 0,
      tx: parseInt(txStr) || 0,
    };
  }
  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Одна карточка клиента ─────────────────────────────────────────────────────
function ClientRow({
  client, selected, selectionActive, onSelect, onDownload, onQr, onRenew, onDelete,
  onBlock, onUnblock,
  dumpInfo, onDragStart, onDragEnter,
}: {
  client: Client;
  selected: boolean;
  selectionActive: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDownload: () => void;
  onQr: () => void;
  onRenew: () => void;
  onDelete: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  dumpInfo?: { lastHandshake: number; rx: number; tx: number };
  onDragStart: (e: React.MouseEvent) => void;
  onDragEnter: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const expiresDate  = client.expires_at ? new Date(client.expires_at) : null;
  const createdDate  = client.created_at ? new Date(client.created_at) : null;
  const daysLeft     = expiresDate
    ? Math.ceil((expiresDate.getTime() - Date.now()) / 86_400_000)
    : null;

  const lastSeen = dumpInfo?.lastHandshake
    ? new Date(dumpInfo.lastHandshake * 1000)
    : null;
  const isOnline = lastSeen && (Date.now() - lastSeen.getTime()) < 3 * 60 * 1000; // < 3 мин

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-150"
      style={{
        border: selected
          ? "1.5px solid rgba(34,197,94,0.5)"
          : "1px solid rgba(255,255,255,0.08)",
        background: selected
          ? "rgba(34,197,94,0.07)"
          : "rgba(255,255,255,0.03)",
        boxShadow: selected ? "0 0 20px -6px rgba(34,197,94,0.2)" : "none",
      }}
    >
      {/* Основная строка */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onMouseDown={selectionActive ? onDragStart : undefined}
        onMouseEnter={selectionActive ? onDragEnter : undefined}
        onClick={selectionActive ? undefined : () => setExpanded(v => !v)}
      >

        {/* Чекбокс */}
        <button
          type="button"
          onClick={onSelect}
          onMouseDown={e => e.stopPropagation()}
          className="shrink-0 text-slate-500 hover:text-green-400 transition-colors"
        >
          {selected
            ? <CheckSquare size={17} className="text-green-400" />
            : <Square size={17} />}
        </button>

        {/* Аватар + онлайн-индикатор */}
        <div className="relative shrink-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-semibold"
            style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.2)" }}>
            <span className="text-green-400">{client.name?.[0]?.toUpperCase() || "?"}</span>
          </div>
          {lastSeen && (
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#080b0f] ${
              isOnline ? "bg-green-400" : "bg-slate-600"
            }`} />
          )}
        </div>

        {/* Имя + статус */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-white truncate">{client.name || "—"}</span>
            <StatusBadge status={client.status} />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {client.contact && <span className="truncate">{client.contact}</span>}
            {daysLeft !== null && (
              <span className={daysLeft <= 3 ? "text-red-400" : daysLeft <= 7 ? "text-yellow-400" : ""}>
                {daysLeft > 0 ? `${daysLeft} дн.` : "Истёк"}
              </span>
            )}
          </div>
        </div>

        {/* Действия */}
        <div
          className="flex items-center gap-0.5 shrink-0"
          onMouseDown={e => e.stopPropagation()}
        >
          <button onClick={onDownload} title="Скачать конфиг"
            className="p-1.5 rounded-lg text-slate-500 hover:text-green-400 hover:bg-green-500/10 transition-colors">
            <Download size={14} />
          </button>
          <button onClick={onQr} title="QR-код"
            className="p-1.5 rounded-lg text-slate-500 hover:text-green-400 hover:bg-green-500/10 transition-colors">
            <QrCode size={14} />
          </button>
          <button onClick={onRenew} title="Продлить"
            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
            <RefreshCw size={14} />
          </button>
          {client.status === "blocked" ? (
            <button onClick={onUnblock} title="Разблокировать"
              className="p-1.5 rounded-lg text-yellow-500 hover:text-green-400 hover:bg-green-500/10 transition-colors">
              <ShieldCheck size={14} />
            </button>
          ) : client.status === "active" ? (
            <button onClick={onBlock} title="Заблокировать"
              className="p-1.5 rounded-lg text-slate-500 hover:text-yellow-400 hover:bg-yellow-500/10 transition-colors">
              <ShieldOff size={14} />
            </button>
          ) : null}
          <button onClick={onDelete} title="Удалить"
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={14} />
          </button>

          {/* Раскрыть детали */}
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/8 transition-colors ml-1"
          >
            <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Детали — выпадающее меню */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 border-t"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">

                {/* Статус */}
                <DetailRow
                  icon={client.status === "active" ? ShieldCheck : ShieldOff}
                  label="Статус"
                  value={
                    client.status === "active" ? "Активен" :
                    client.status === "expired" ? "Истёк" :
                    client.status === "blocked" ? "Заблокирован" : client.status
                  }
                  color={
                    client.status === "active" ? "text-green-400" :
                    client.status === "expired" ? "text-red-400" : "text-slate-400"
                  }
                />

                {/* Последняя активность */}
                <DetailRow
                  icon={isOnline ? Wifi : WifiOff}
                  label="Последняя активность"
                  value={lastSeen
                    ? isOnline
                      ? "Онлайн сейчас"
                      : formatDistanceToNow(lastSeen, { addSuffix: true, locale: ru })
                    : "Нет данных"}
                  color={isOnline ? "text-green-400" : undefined}
                />

                {/* Создан */}
                <DetailRow
                  icon={Calendar}
                  label="Создан"
                  value={createdDate
                    ? format(createdDate, "d MMM yyyy", { locale: ru })
                    : "—"}
                />

                {/* Истекает */}
                <DetailRow
                  icon={Clock}
                  label="Истекает"
                  value={expiresDate
                    ? format(expiresDate, "d MMM yyyy", { locale: ru })
                    : "Бессрочно"}
                  color={daysLeft !== null && daysLeft <= 7 ? "text-yellow-400" : undefined}
                />

                {/* Сервер */}
                <DetailRow
                  icon={Server}
                  label="Сервер"
                  value={client.server_id || "local"}
                />

                {/* Трафик */}
                {dumpInfo && (
                  <DetailRow
                    icon={Wifi}
                    label="Трафик ↓↑"
                    value={`${formatBytes(dumpInfo.rx)} / ${formatBytes(dumpInfo.tx)}`}
                  />
                )}

                {/* Контакт */}
                {client.contact && (
                  <DetailRow
                    icon={Mail}
                    label="Контакт"
                    value={client.contact}
                  />
                )}

                {/* ID */}
                <DetailRow
                  icon={Key}
                  label="Client ID"
                  value={client.id}
                  mono
                />

                {/* Публичный ключ */}
                <DetailRow
                  icon={Key}
                  label="Public Key"
                  value={client.public_key
                    ? client.public_key.slice(0, 20) + "…"
                    : "—"}
                  mono
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, color, mono }: {
  icon: any; label: string; value: string;
  color?: string; mono?: boolean;
}) {
  return (
    <div className="rounded-xl px-3 py-2.5 min-w-0"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={11} className="text-slate-600 shrink-0" />
        <p className="text-[10px] text-slate-600 uppercase tracking-wide">{label}</p>
      </div>
      <p className={`text-xs truncate font-medium ${color || "text-slate-300"} ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}

// ── Плашка мультиселекта ──────────────────────────────────────────────────────
function SelectionBar({
  count, onRenewAll, onDeleteAll, onClear,
}: {
  count: number; onRenewAll: () => void; onDeleteAll: () => void; onClear: () => void;
}) {
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl"
      style={{
        background: "rgba(15,20,25,0.95)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(16px)",
      }}
    >
      <span className="text-sm text-white font-medium">
        Выбрано: <span className="text-green-400">{count}</span>
      </span>
      <div className="w-px h-4 bg-white/20" />
      <button onClick={onRenewAll}
        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors">
        <RotateCcw size={13} /> Продлить
      </button>
      <button onClick={onDeleteAll}
        className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
        <Trash2 size={13} /> Удалить
      </button>
      <button onClick={onClear}
        className="p-1 text-slate-500 hover:text-white transition-colors">
        <X size={15} />
      </button>
    </motion.div>
  );
}

// ── Основная страница ─────────────────────────────────────────────────────────
export default function Clients() {
  const qc = useQueryClient();

  // Поиск
  const [search, setSearch]   = useState("");
  const debouncedSearch       = useDebounce(search, 200);

  // Мультиселект
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);

  // Drag-select (зажать ЛКМ и вести мышью)
  const isDragging = useRef(false);
  const dragSelectValue = useRef(true); // true = добавить, false = снять

  useEffect(() => {
    const stop = () => { isDragging.current = false; };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  // Модалки
  const [createOpen, setCreateOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [contact, setContact]       = useState("");
  const [term, setTerm]             = useState("1m");
  const [creating, setCreating]     = useState(false);
  const [error, setError]           = useState("");
  const [qrData, setQrData] = useState<{ config: string; name: string } | null>(null);

  // Пагинация
  const [offset, setOffset] = useState(0);
  const LIMIT = 200;

  // Сброс пагинации при поиске
  useEffect(() => { setOffset(0); }, [debouncedSearch]);

  // Данные
  const { data: rawData, isLoading } = useQuery({
    queryKey: ["clients", debouncedSearch, offset],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: LIMIT, offset };
      if (debouncedSearch) params.search = debouncedSearch;
      return (await api.get("/admin/clients", { params })).data as { clients: Client[]; total: number };
    },
    staleTime: 15_000,
  });

  const data    = rawData?.clients ?? [];
  const total   = rawData?.total ?? 0;
  const hasMore = offset + LIMIT < total;

  const { data: statsData } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => (await api.get("/admin/stats")).data,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const dumpMap = statsData?.dump ? parseDump(statsData.dump) : {};

  // Мутации
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/clients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });

  const renewMut = useMutation({
    mutationFn: ({ id, term }: { id: string; term: string }) =>
      api.post(`/admin/clients/${id}/renew`, { term }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });

  const blockMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/clients/${id}/block`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });

  const unblockMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/clients/${id}/unblock`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });

  // Выбор с поддержкой Shift+click
  const handleSelect = useCallback((id: string, idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = data;

    setSelected(prev => {
      const next = new Set(prev);

      if (e.shiftKey && lastClickedIdx !== null) {
        // Shift+click — выделить диапазон
        const from = Math.min(lastClickedIdx, idx);
        const to   = Math.max(lastClickedIdx, idx);
        for (let i = from; i <= to; i++) {
          next.add(filtered[i].id);
        }
      } else {
        // Обычный клик — переключить
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });

    setLastClickedIdx(idx);
  }, [data, debouncedSearch, lastClickedIdx]);

  function handleCardDragStart(id: string, e: React.MouseEvent) {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragSelectValue.current = !selected.has(id);
    setSelected(prev => {
      const next = new Set(prev);
      dragSelectValue.current ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function handleCardDragEnter(id: string) {
    if (!isDragging.current) return;
    setSelected(prev => {
      const next = new Set(prev);
      dragSelectValue.current ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map(c => c.id)));
  }

  function clearSelection() {
    setSelected(new Set());
    setLastClickedIdx(null);
  }

  async function deleteSelected() {
    if (!confirm(`Удалить ${selected.size} клиентов?`)) return;
    for (const id of selected) {
      await api.delete(`/admin/clients/${id}`);
    }
    qc.invalidateQueries({ queryKey: ["clients"] });
    clearSelection();
  }

  async function renewSelected() {
    for (const id of selected) {
      await api.post(`/admin/clients/${id}/renew`, { term: "1m" });
    }
    qc.invalidateQueries({ queryKey: ["clients"] });
    clearSelection();
  }

  async function downloadConfig(id: string) {
    const { data: d } = await api.get(`/admin/clients/${id}/config`);
    const blob = new Blob([d.config], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = d.filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function createClient() {
    if (!clientName.trim()) { setError("Введите имя"); return; }
    setError(""); setCreating(true);
    try {
      await api.post("/admin/clients", { name: clientName.trim(), contact: contact.trim(), term });
      qc.invalidateQueries({ queryKey: ["clients"] });
      setCreateOpen(false);
      setClientName(""); setContact(""); setTerm("1m");
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка");
    } finally {
      setCreating(false);
    }
  }

  const filtered = data;

  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));

  const onlineCount = Object.values(dumpMap).filter(
    d => d.lastHandshake && (Date.now() - d.lastHandshake * 1000) < 3 * 60_000
  ).length;

  return (
    <div className="pb-24">
      {/* Заголовок */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Клиенты</h1>
          <p className="text-sm text-slate-500">{total} записей</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary">
          <Plus size={16} /> Добавить
        </button>
      </div>

      {/* Мини-статистика */}
      {statsData && (
        <div className="flex flex-wrap gap-2 mb-5">
          {[
            { label: "Активных",     value: statsData.clients?.active  ?? 0, color: "text-green-400",  bg: "rgba(34,197,94,0.1)",  border: "rgba(34,197,94,0.2)"  },
            { label: "Истёкших",     value: statsData.clients?.expired ?? 0, color: "text-red-400",    bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.2)"  },
            { label: "Заблокировано",value: statsData.clients?.blocked ?? 0, color: "text-orange-400", bg: "rgba(249,115,22,0.1)", border: "rgba(249,115,22,0.2)" },
            { label: "Онлайн",       value: onlineCount,                     color: "text-blue-400",   bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.2)" },
          ].map(({ label, value, color, bg, border }) => (
            <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs"
              style={{ background: bg, border: `1px solid ${border}` }}>
              <span className={`font-bold ${color}`}>{value}</span>
              <span className="text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Поиск + выбрать все */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-10" placeholder="Поиск по имени, ID, контакту..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button
          type="button"
          onClick={allSelected ? clearSelection : selectAll}
          className="btn-ghost px-3 py-2 text-xs gap-1.5"
          title={allSelected ? "Снять выделение" : "Выбрать всех"}
        >
          {allSelected
            ? <><CheckSquare size={14} className="text-green-400" /> Снять</>
            : <><Square size={14} /> Все</>}
        </button>
      </div>

      {/* Список */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-600">
          <Users size={32} className="mb-3 opacity-40" />
          <p className="text-sm">Клиенты не найдены</p>
          {search && <p className="text-xs mt-1 text-slate-700">Попробуйте изменить запрос</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((client, i) => (
            <motion.div key={client.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.3) }}
            >
              <ClientRow
                client={client}
                selected={selected.has(client.id)}
                selectionActive={selected.size > 0}
                onSelect={e => handleSelect(client.id, i, e)}
                dumpInfo={dumpMap[client.public_key]}
                onDragStart={e => handleCardDragStart(client.id, e)}
                onDragEnter={() => handleCardDragEnter(client.id)}
                onDownload={() => downloadConfig(client.id)}
                onQr={async () => {
                  const { data: d } = await api.get(`/admin/clients/${client.id}/config`);
                  setQrData({ config: d.config, name: client.name });
                }}
                onRenew={() => renewMut.mutate({ id: client.id, term: "1m" })}
                onBlock={() => blockMut.mutate(client.id)}
                onUnblock={() => unblockMut.mutate(client.id)}
                onDelete={() => {
                  if (confirm(`Удалить ${client.name}?`)) deleteMut.mutate(client.id);
                }}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Пагинация */}
      {hasMore && (
        <div className="flex justify-center mt-4">
          <button
            className="btn-ghost text-sm"
            onClick={() => setOffset(o => o + LIMIT)}
          >
            Загрузить ещё ({total - offset - data.length} из {total})
          </button>
        </div>
      )}

      {/* Плашка мультиселекта */}
      <AnimatePresence>
        {selected.size > 0 && (
          <SelectionBar
            count={selected.size}
            onRenewAll={renewSelected}
            onDeleteAll={deleteSelected}
            onClear={clearSelection}
          />
        )}
      </AnimatePresence>

      {/* Модалка создания */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Новый клиент" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Имя</label>
            <input className="input" placeholder="Иван Иванов" value={clientName}
              onChange={e => setClientName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Контакт (email/telegram)</label>
            <input className="input" placeholder="ivan@example.com" value={contact}
              onChange={e => setContact(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Срок</label>
            <select className="input" value={term} onChange={e => setTerm(e.target.value)}>
              <option value="3d">3 дня</option>
              <option value="7d">7 дней</option>
              <option value="1m">1 месяц</option>
              <option value="3m">3 месяца</option>
              <option value="6m">6 месяцев</option>
              <option value="1y">1 год</option>
              <option value="forever">Бессрочно</option>
            </select>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button className="btn-ghost flex-1" onClick={() => setCreateOpen(false)}>Отмена</button>
            <button className="btn-primary flex-1" onClick={createClient} disabled={creating}>
              {creating ? <Spinner className="w-4 h-4" /> : "Создать"}
            </button>
          </div>
        </div>
      </Modal>

      {/* QR модалка */}
      <QrModal
        open={!!qrData}
        onClose={() => setQrData(null)}
        config={qrData?.config ?? ""}
        clientName={qrData?.name}
      />
    </div>
  );
}
