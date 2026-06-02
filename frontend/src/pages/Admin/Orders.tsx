import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Play, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";

interface Order {
  id: string; login: string; email: string; term: string;
  status: string; type: string; client_id: string | null;
  expires_at: string | null; payment_amount: number | null;
  created_at: string; processing_error: string | null;
}

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white mb-1">Заказы</h1>
        <p className="text-sm text-slate-500">{data?.length ?? 0} записей</p>
      </div>

      <div className="relative mb-5">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input className="input pl-10" placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-slate-500 text-sm">Заказы не найдены</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((order, i) => (
            <motion.div key={order.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Card hover className="!p-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white">{order.login || order.email || order.id}</span>
                      <StatusBadge status={order.status} />
                      {order.type === "renewal" && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400">Продление</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                      <span>ID: {order.id.slice(0, 8)}</span>
                      {order.email && <span>· {order.email}</span>}
                      <span>· {order.term}</span>
                      {order.payment_amount && <span>· {order.payment_amount} ₽</span>}
                      {order.created_at && <span>· {format(new Date(order.created_at), "dd.MM.yy HH:mm")}</span>}
                    </div>
                    {order.processing_error && (
                      <p className="text-xs text-red-400 mt-1">{order.processing_error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {order.status === "pending" && (
                      <button
                        onClick={() => processMut.mutate(order.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-green-400 hover:bg-green-500/10 transition-colors"
                        title="Обработать"
                      >
                        <Play size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => { if (confirm("Удалить заказ?")) deleteMut.mutate(order.id); }}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
