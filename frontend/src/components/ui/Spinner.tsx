import { clsx } from "clsx";

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx("inline-block w-5 h-5 border-2 border-white/20 border-t-green-500 rounded-full animate-spin", className)} />
  );
}
