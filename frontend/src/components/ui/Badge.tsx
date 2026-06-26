import { Circle } from "lucide-react";

export function StatusBadge({ status }: { status: string }) {
  if (status === "active")   return <span className="badge-active"><Circle size={6} fill="currentColor" />Активен</span>;
  if (status === "expired")  return <span className="badge-expired"><Circle size={6} fill="currentColor" />Истёк</span>;
  if (status === "blocked")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
        text-orange-400 bg-orange-500/15 border border-orange-500/25">
        <Circle size={6} fill="currentColor" />Заблокирован
      </span>
    );
  if (status === "pending")  return <span className="badge-pending"><Circle size={6} fill="currentColor" />Ожидание</span>;
  if (status === "issued")   return <span className="badge-issued"><Circle size={6} fill="currentColor" />Выдан</span>;
  return <span className="badge-pending">{status}</span>;
}
