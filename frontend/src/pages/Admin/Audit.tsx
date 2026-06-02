import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";

const ACTION_COLORS: Record<string, string> = {
  "client.create":  "text-green-400",
  "client.delete":  "text-red-400",
  "client.renew":   "text-blue-400",
  "client.expire":  "text-yellow-400",
  "order.create":   "text-purple-400",
  "order.process":  "text-blue-400",
  "admin.create":   "text-green-400",
  "admin.delete":   "text-red-400",
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
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/6 text-xs text-slate-500">
                  <th className="text-left px-5 py-3 font-medium">Время</th>
                  <th className="text-left px-5 py-3 font-medium">Действие</th>
                  <th className="text-left px-5 py-3 font-medium">Объект</th>
                  <th className="text-left px-5 py-3 font-medium">Администратор</th>
                </tr>
              </thead>
              <tbody>
                {(data || []).map((log: any) => (
                  <tr key={log.id} className="border-b border-white/4 hover:bg-white/3 transition-colors">
                    <td className="px-5 py-3 text-slate-500 whitespace-nowrap text-xs">
                      {log.created_at ? format(new Date(log.created_at), "dd.MM.yy HH:mm:ss") : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`font-mono text-xs ${ACTION_COLORS[log.action] || "text-slate-300"}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs font-mono">{log.entity_id}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{log.admin_username || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!data || data.length === 0) && (
              <div className="text-center py-12 text-slate-500 text-sm">Журнал пуст</div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
