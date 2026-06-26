import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Shield, Trash2 } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../api/client";
import { useAuthStore } from "../../store/auth";

export default function Settings() {
  const qc = useQueryClient();
  const { admin: me } = useAuthStore();
  const isSuperAdmin = me?.role === "superadmin";

  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("admin");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);

  async function downloadBackup() {
    setBackupLoading(true);
    try {
      const resp = await api.get("/admin/backup", { responseType: "blob" });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vpn-backup.zip";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBackupLoading(false);
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admins"],
    queryFn: async () => (await api.get("/admin/admins")).data.admins,
    enabled: isSuperAdmin,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/admins/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admins"] }),
  });

  async function createAdmin() {
    if (!username.trim() || !password.trim()) { setError("Заполните все поля"); return; }
    setError(""); setCreating(true);
    try {
      await api.post("/admin/admins", { username: username.trim(), password, display_name: displayName.trim(), role });
      qc.invalidateQueries({ queryKey: ["admins"] });
      setCreateOpen(false);
      setUsername(""); setPassword(""); setDisplayName(""); setRole("admin");
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Настройки</h1>
          <p className="text-sm text-slate-500">Управление администраторами</p>
        </div>
        <button
          onClick={downloadBackup}
          disabled={backupLoading}
          className="btn-ghost text-xs px-3 py-2 gap-1.5"
          title="Скачать резервную копию БД и конфига"
        >
          {backupLoading ? <Spinner className="w-3.5 h-3.5" /> : <Download size={14} />}
          Резервная копия
        </button>
      </div>

      {!isSuperAdmin ? (
        <Card className="text-center py-12">
          <Shield size={32} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Только суперадмин может управлять аккаунтами</p>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-400">Администраторы</p>
            <button onClick={() => setCreateOpen(true)} className="btn-primary text-xs px-4 py-2">
              <Plus size={14} /> Добавить
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <div className="space-y-2">
              {(data || []).map((a: any) => (
                <Card key={a.id} hover className="!p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center text-sm text-green-400 font-semibold">
                      {a.display_name?.[0] || a.username?.[0]}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{a.display_name || a.username}</p>
                      <p className="text-xs text-slate-500">@{a.username} · {a.role}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!a.is_active && <span className="badge-expired">Неактивен</span>}
                      {a.id !== me?.id && (
                        <button
                          onClick={() => { if (confirm(`Удалить ${a.username}?`)) deleteMut.mutate(a.id); }}
                          className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Новый администратор" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Логин</label>
            <input className="input" value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Пароль</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Отображаемое имя</label>
            <input className="input" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Роль</label>
            <select className="input" value={role} onChange={e => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button className="btn-ghost flex-1" onClick={() => setCreateOpen(false)}>Отмена</button>
            <button className="btn-primary flex-1" onClick={createAdmin} disabled={creating}>
              {creating ? <Spinner className="w-4 h-4" /> : "Создать"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
