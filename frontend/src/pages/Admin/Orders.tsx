import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Play, Trash2, ShoppingCart, RotateCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";

interface Order {
  id: string; login: string; email: string; term: string;
  status: string; type: string; client_id: string | null;
  expires_at: string | null; payment_amount: number | null;
  created_at: string; processing_error: string | null;
}

const TERM_LABELS: Record<string, string> = {
  "3d": "3 дня", "7d": "7 дней", "14d": "14 дней",
  "1m": "1 мес",  "3m": "3 мес",  "6m": "6 мес",  "1y": "1 год",
};

export default function Orders() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => (await api.get("/admin/orders")).data.orders as Order[],
    refetchInterval: 15_000,
  });

  const processMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/orders/${id}/process`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });

  const filtered = (data || []).filter(o =>
    o.login.toLowerCase().includes(search.toLowerCase()) ||
    o.email.toLowerCase().includes(search.toLowerCase()) ||
    o.id.includes(search)
  );

  const pending = filtered.filter(o => o.status === "pending").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Заказы</h1>
          <p className="text-sm text-slate-500">
            {data?.length ?? 0} записей
            {pending > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium
                text-yellow-400 bg-yellow-500/15 border border-yellow-500/20">
                {pending} ожидает
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="input pl-10"
          placeholder="Поиск по логину, email, ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-600">
          <ShoppingCart size={32} className="mb-3 opacity-40" />
          <p className="text-sm">Заказы не найдены</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((order, i) => (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.25) }}
            >
              <div className="rounded-2xl px-4 py-3.5 flex items-center gap-4"
                style={{
                  background: order.status === "pending"
                    ? "rgba(234,179,8,0.04)"
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${order.status === "pending"
                    ? "rgba(234,179,8,0.15)"
                    : "rgba(255,255,255,0.07)"}`,
                }}>

                {/* Left: icon */}
                <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center"
                  style={{
                    background: order.type === "renewal"
                      ? "rgba(168,85,247,0.12)"
                      : "rgba(34,197,94,0.1)",
                    border: `1px solid ${order.type === "renewal"
                      ? "rgba(168,85,247,0.2)"
                      : "rgba(34,197,94,0.15)"}`,
                  }}>
                  {order.type === "renewal"
                    ? <RotateCw size={15} className="text-purple-400" />
                    : <ShoppingCart size={15} className="text-green-400" />
                  }
                </div>

                {/* Center: info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-sm font-medium text-white">
                      {order.login || order.email || order.id.slice(0, 8)}
                    </span>
                    <StatusBadge status={order.status} />
                    {order.type === "renewal" && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/20">
                        Продление
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                    <span className="font-mono">{order.id.slice(0, 8)}</span>
                    {order.email && order.login && <span>{order.email}</span>}
                    {order.created_at && (
                      <span>{format(new Date(order.created_at), "dd.MM.yy HH:mm")}</span>
                    )}
                  </div>
                  {order.processing_error && (
                    <p className="text-xs text-red-400 mt-1 truncate">{order.processing_error}</p>
                  )}
                </div>

                {/* Right: term + amount + actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Term pill */}
                  <span className="hidden sm:inline text-xs px-2 py-1 rounded-lg font-medium
                    text-slate-300 bg-white/5"
                    style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                    {TERM_LABELS[order.term] ?? order.term}
                  </span>

                  {/* Amount */}
                  {order.payment_amount != null && (
                    <span className="hidden sm:inline text-xs font-semibold text-green-400
                      bg-green-500/10 px-2 py-1 rounded-lg border border-green-500/15">
                      {order.payment_amount} ₽
                    </span>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {order.status === "pending" && (
                      <button
                        onClick={() => processMut.mutate(order.id)}
                        disabled={processMut.isPending}
                        title="Обработать"
                        className="p-2 rounded-xl text-slate-500 hover:text-green-400
                          hover:bg-green-500/10 transition-colors"
                      >
                        <Play size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => { if (confirm("Удалить заказ?")) deleteMut.mutate(order.id); }}
                      className="p-2 rounded-xl text-slate-600 hover:text-red-400
                        hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
