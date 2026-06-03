import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, Download, Trash2, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../api/client";
import { useDebounce } from "../../hooks/useDebounce";

interface Client {
  id: string; name: string; public_key: string; contact: string;
  status: string; expires_at: string | null; created_at: string; server_id: string;
}

export default function Clients() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [contact, setContact] = useState("");
  const [term, setTerm] = useState("1m");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const debouncedSearch = useDebounce(search, 200);

  const { data, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await api.get("/admin/clients")).data.clients as Client[],
    staleTime: 10_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/clients/${id}`),
    // Optimistic: remove from cache immediately, rollback on error
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["clients"] });
      const prev = qc.getQueryData<Client[]>(["clients"]);
      qc.setQueryData<Client[]>(["clients"], old => old?.filter(c => c.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["clients"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });

  const renewMut = useMutation({
    mutationFn: ({ id, term }: { id: string; term: string }) =>
      api.post(`/admin/clients/${id}/renew`, { term }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });

  async function downloadConfig(id: string, name: string) {
    const { data: d } = await api.get(`/admin/clients/${id}/config`);
    const blob = new Blob([d.config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
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

  const filtered = (data || []).filter(c =>
    c.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    c.id.includes(debouncedSearch) ||
    c.contact.toLowerCase().includes(debouncedSearch.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Клиенты</h1>
          <p className="text-sm text-slate-500">{data?.length ?? 0} записей</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary">
          <Plus size={16} /> Добавить
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="input pl-10"
          placeholder="Поиск по имени, ID, контакту..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-slate-500 text-sm">Клиенты не найдены</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((client, i) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Card hover className="!p-4">
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center text-sm text-green-400 font-semibold shrink-0">
                    {client.name?.[0]?.toUpperCase() || "?"}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium text-white truncate">{client.name || "—"}</p>
                      <StatusBadge status={client.status} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>ID: {client.id}</span>
                      {client.contact && <span>· {client.contact}</span>}
                      {client.expires_at && (
                        <span>· до {format(new Date(client.expires_at), "dd.MM.yy")}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => downloadConfig(client.id, client.name)}
                      className="p-2 rounded-lg text-slate-400 hover:text-green-400 hover:bg-green-500/10 transition-colors"
                      title="Скачать конфиг"
                    >
                      <Download size={15} />
                    </button>
                    <button
                      onClick={() => renewMut.mutate({ id: client.id, term: "1m" })}
                      className="p-2 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                      title="Продлить на 1 месяц"
                    >
                      <RefreshCw size={15} />
                    </button>
                    <button
                      onClick={() => { if (confirm(`Удалить ${client.name}?`)) deleteMut.mutate(client.id); }}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Новый клиент" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Имя</label>
            <input className="input" placeholder="Иван Иванов" value={clientName} onChange={e => setClientName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Контакт (email/telegram)</label>
            <input className="input" placeholder="ivan@example.com" value={contact} onChange={e => setContact(e.target.value)} />
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
    </div>
  );
}
