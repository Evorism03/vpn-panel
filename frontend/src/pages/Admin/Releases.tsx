import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Trash2, Package, Smartphone, Monitor, FileUp, X } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";
import { useAuthStore } from "../../store/auth";

const PLATFORM_LABEL: Record<string, string> = { android: "Android", windows: "Windows" };
const PLATFORM_ICON: Record<string, any> = { android: Smartphone, windows: Monitor };

export default function Releases() {
  const qc = useQueryClient();
  const { admin: me } = useAuthStore();
  const isSuperAdmin = me?.role === "superadmin";

  const [platform, setPlatform] = useState("android");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["releases"],
    queryFn: async () => (await api.get("/admin/releases")).data.releases,
    enabled: isSuperAdmin,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/releases/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["releases"] }),
  });

  async function upload() {
    if (!file) { setError("Выберите файл"); return; }
    if (!version.trim()) { setError("Укажите версию"); return; }
    setError(""); setUploading(true); setProgress({ loaded: 0, total: file.size });
    try {
      const fd = new FormData();
      fd.append("platform", platform);
      fd.append("version", version.trim());
      fd.append("notes", notes.trim());
      fd.append("file", file);
      await api.post("/admin/releases", fd, {
        onUploadProgress: (e) => setProgress({ loaded: e.loaded, total: e.total ?? file.size }),
      });
      qc.invalidateQueries({ queryKey: ["releases"] });
      setVersion(""); setNotes(""); setFile(null);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка загрузки");
    } finally {
      setUploading(false); setProgress(null);
    }
  }

  if (!isSuperAdmin) {
    return (
      <Card className="text-center py-12">
        <Package size={32} className="text-slate-600 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">Только суперадмин может публиковать версии приложения</p>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white mb-1">Версии приложения</h1>
        <p className="text-sm text-slate-500">Загрузка APK/EXE для скачивания на сайте</p>
      </div>

      <Card className="mb-6">
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Платформа</label>
            <select className="input" value={platform} onChange={e => { setPlatform(e.target.value); setFile(null); }}>
              <option value="android">Android (.apk)</option>
              <option value="windows">Windows (.exe)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Версия</label>
            <input className="input" placeholder="1.0.2" value={version} onChange={e => setVersion(e.target.value)} />
          </div>
        </div>
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1.5">Заметки (необязательно)</label>
          <input className="input" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1.5">
            Файл ({platform === "android" ? ".apk" : ".exe"})
          </label>
          <input
            key={platform}
            ref={fileInputRef}
            type="file"
            accept={platform === "android" ? ".apk" : ".exe"}
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm text-left transition-colors hover:bg-white/5"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <FileUp size={15} className="text-slate-500 shrink-0" />
            {file ? (
              <span className="flex-1 min-w-0 flex items-center gap-2">
                <span className="text-white truncate">{file.name}</span>
                <span className="text-slate-500 text-xs shrink-0">
                  {(file.size / 1024 / 1024).toFixed(1)} МБ
                </span>
              </span>
            ) : (
              <span className="flex-1 text-slate-500">
                Выбрать файл ({platform === "android" ? ".apk" : ".exe"})
              </span>
            )}
            {file && (
              <span
                role="button"
                onClick={e => { e.stopPropagation(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
              >
                <X size={13} />
              </span>
            )}
          </button>
        </div>
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {progress && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span>
                {(progress.loaded / 1024 / 1024).toFixed(1)} / {(progress.total / 1024 / 1024).toFixed(1)} МБ
              </span>
              <span className="text-green-400 font-medium">
                {Math.round((progress.loaded / Math.max(progress.total, 1)) * 100)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${Math.round((progress.loaded / Math.max(progress.total, 1)) * 100)}%`,
                  background: "#22c55e",
                }}
              />
            </div>
          </div>
        )}

        <button className="btn-primary text-sm px-4 py-2" onClick={upload} disabled={uploading}>
          {uploading ? <Spinner className="w-4 h-4" /> : <Upload size={14} />}
          {uploading ? "Загрузка..." : "Загрузить"}
        </button>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-2">
          {(data || []).map((r: any) => {
            const Icon = PLATFORM_ICON[r.platform] || Package;
            return (
              <Card key={r.id} hover className="!p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center text-green-400">
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">
                      {PLATFORM_LABEL[r.platform] || r.platform} · v{r.version}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {(r.size_bytes / 1024 / 1024).toFixed(1)} МБ
                      {r.notes ? ` · ${r.notes}` : ""}
                      {r.uploaded_by ? ` · ${r.uploaded_by}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => { if (confirm(`Удалить версию ${r.version}?`)) deleteMut.mutate(r.id); }}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            );
          })}
          {(data || []).length === 0 && (
            <p className="text-center text-sm text-slate-500 py-8">Версий пока нет</p>
          )}
        </div>
      )}
    </div>
  );
}
