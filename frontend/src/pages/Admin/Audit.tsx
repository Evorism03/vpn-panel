import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { motion } from "framer-motion";
import {
  UserPlus, UserMinus, RefreshCw, ShoppingBag,
  ShieldOff, ShieldCheck, Trash2, ClipboardList, Server,
} from "lucide-react";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";

const ACTION_META: Record<string, {
  label: string; icon: any;
  iconColor: string; bgColor: string;
}> = {
  "client.create":  { label: "Создан клиент",  icon: UserPlus,    iconColor: "text-green-400",  bgColor: "bg-green-500/12"  },
  "client.delete":  { label: "Удалён клиент",   icon: UserMinus,   iconColor: "text-red-400",    bgColor: "bg-red-500/12"    },
  "client.renew":   { label: "Продлен клиент",  icon: RefreshCw,   iconColor: "text-blue-400",   bgColor: "bg-blue-500/12"   },
  "client.block":   { label: "Заблокирован",    icon: ShieldOff,   iconColor: "text-orange-400", bgColor: "bg-orange-500/12" },
  "client.unblock": { label: "Разблокирован",   icon: ShieldCheck, iconColor: "text-teal-400",   bgColor: "bg-teal-500/12"   },
  "order.process":  { label: "Обработан заказ", icon: ShoppingBag, iconColor: "text-purple-400", bgColor: "bg-purple-500/12" },
  "order.delete":   { label: "Удалён заказ",    icon: Trash2,      iconColor: "text-slate-400",  bgColor: "bg-slate-500/12"  },
  "admin.create":   { label: "Добавлен админ",  icon: UserPlus,    iconColor: "text-green-400",  bgColor: "bg-green-500/12"  },
  "admin.delete":   { label: "Удалён админ",    icon: UserMinus,   iconColor: "text-red-400",    bgColor: "bg-red-500/12"    },
};

const FALLBACK = {
  label: "Действие", icon: ClipboardList,
  iconColor: "text-slate-400", bgColor: "bg-slate-500/10",
};

export default function Audit() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit"],
    queryFn: async () => (await api.get("/admin/audit?limit=200")).data.logs,
    refetchInterval: 30_000,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white mb-1">Аудит</h1>
        <p className="text-sm text-slate-500">Журнал действий администраторов</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-600">
          <ClipboardList size={32} className="mb-3 opacity-40" />
          <p className="text-sm">Журнал пуст</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[23px] top-4 bottom-4 w-px"
            style={{ background: "rgba(255,255,255,0.06)" }} />

          <div className="space-y-1">
            {data.map((log: any, i: number) => {
              const meta = ACTION_META[log.action] ?? FALLBACK;
              const Icon = meta.icon;
              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  className="flex items-start gap-4"
                >
                  {/* Icon bubble */}
                  <div className={`relative z-10 w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${meta.bgColor}`}
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <Icon size={16} className={meta.iconColor} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 py-3 flex items-center justify-between gap-4 border-b"
                    style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${meta.iconColor}`}>
                        {meta.label}
                        {(() => {
                          try {
                            const d = JSON.parse(log.details || "{}");
                            if (d.name) return <span className="font-normal text-slate-300"> — {d.name}</span>;
                          } catch {}
                          return null;
                        })()}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 mt-0.5">
                        {log.admin_username && (
                          <span className="text-xs text-slate-500">@{log.admin_username}</span>
                        )}
                        {log.entity_id && (
                          <span className="text-xs text-slate-700 font-mono truncate max-w-[200px]">
                            {log.entity_id}
                          </span>
                        )}
                        {(() => {
                          try {
                            const d = JSON.parse(log.details || "{}");
                            if (d.server_name) return (
                              <span className="flex items-center gap-1 text-xs text-slate-600">
                                <Server size={10} />
                                {d.server_name}
                              </span>
                            );
                          } catch {}
                          return null;
                        })()}
                      </div>
                    </div>
                    <span className="text-xs text-slate-700 shrink-0">
                      {log.created_at
                        ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: ru })
                        : ""}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
