import { clsx } from "clsx";
import { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
}

export function Card({ children, className, hover, glow }: Props) {
  return (
    <div
      className={clsx(
        "glass rounded-2xl p-6",
        hover && "glass-hover cursor-pointer",
        glow && "shadow-[0_0_40px_-8px_rgba(34,197,94,0.15)]",
        className
      )}
    >
      {children}
    </div>
  );
}
