import { motion } from "framer-motion";
import { Users, ShoppingCart, Activity, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => (await api.get("/admin/stats")).data,
    refetchInterval: 15_000,
  });

  const stats = [
    {
      label: "Активных клиентов",
      value: data?.clients?.active ?? "—",
      sub: `Всего: ${data?.clients?.total ?? "—"}`,
      icon: Users,
      color: "text-green-400",
      bg: "bg-green-500/12",
    },
    {
      label: "Истёкших подписок",
      value: data?.clients?.expired ?? "—",
      sub: "Требуют продления",
      icon: Activity,
      color: "text-red-400",
      bg: "bg-red-500/12",
    },
    {
      label: "Заказов в ожидании",
      value: data?.orders?.pending ?? "—",
      sub: `Выдано: ${data?.orders?.issued ?? "—"}`,
      icon: ShoppingCart,
      color: "text-yellow-400",
      bg: "bg-yellow-500/12",
    },
    {
      label: "Статус сети",
      value: data ? "Online" : "—",
      sub: "AWG Interface",
      icon: TrendingUp,
      color: "text-blue-400",
      bg: "bg-blue-500/12",
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white mb-1">Дашборд</h1>
        <p className="text-sm text-slate-500">Обзор состояния системы</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
            >
              <Card glow={i === 0}>
                <div className={`w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center mb-3`}>
                  <s.icon size={18} className={s.color} />
                </div>
                <p className="text-2xl font-bold text-white mb-0.5">{s.value}</p>
                <p className="text-xs text-slate-500 mb-0.5">{s.label}</p>
                <p className="text-xs text-slate-600">{s.sub}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {data?.dump && (
        <Card>
          <p className="text-xs font-medium text-slate-400 mb-3">AWG dump</p>
          <pre className="text-xs text-slate-500 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {data.dump}
          </pre>
        </Card>
      )}
    </div>
  );
}
