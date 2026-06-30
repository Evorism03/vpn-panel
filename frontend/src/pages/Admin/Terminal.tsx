import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { Terminal as TerminalIcon, ShieldOff } from "lucide-react";
import { useAuthStore } from "../../store/auth";

export default function TerminalPage() {
  const { admin } = useAuthStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const token = localStorage.getItem("access_token");
    if (!token) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: {
        background:    "#080b0f",
        foreground:    "#e2e8f0",
        cursor:        "#22c55e",
        cursorAccent:  "#080b0f",
        selectionBackground: "rgba(34,197,94,0.25)",
        black:         "#1e293b",
        red:           "#f87171",
        green:         "#4ade80",
        yellow:        "#facc15",
        blue:          "#60a5fa",
        magenta:       "#c084fc",
        cyan:          "#22d3ee",
        white:         "#f1f5f9",
        brightBlack:   "#475569",
        brightRed:     "#fca5a5",
        brightGreen:   "#86efac",
        brightYellow:  "#fde047",
        brightBlue:    "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan:    "#67e8f9",
        brightWhite:   "#ffffff",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/api/admin/terminal?token=${encodeURIComponent(token)}`
    );
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      term.focus();
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data));
      } else {
        term.write(e.data as string);
      }
    };

    ws.onclose = (e) => {
      const msg = e.code === 4403
        ? "\r\n\x1b[31mДоступ запрещён: требуется роль superadmin.\x1b[0m\r\n"
        : e.code === 4401
        ? "\r\n\x1b[31mОшибка аутентификации.\x1b[0m\r\n"
        : "\r\n\x1b[90mСоединение закрыто.\x1b[0m\r\n";
      term.write(msg);
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31mОшибка WebSocket.\x1b[0m\r\n");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    const sendResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    const ro = new ResizeObserver(sendResize);
    ro.observe(containerRef.current);
    window.addEventListener("resize", sendResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sendResize);
      ws.close();
      term.dispose();
    };
  }, []);

  if (admin?.role !== "superadmin") {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-slate-600">
        <ShieldOff size={32} className="mb-3 opacity-40" />
        <p className="text-sm">Только для суперадмина</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 100px)" }}>
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <TerminalIcon size={18} className="text-green-400" />
        <div>
          <h1 className="text-xl font-semibold text-white leading-tight">Терминал</h1>
          <p className="text-xs text-slate-500">Прямой доступ к серверу — только superadmin</p>
        </div>
      </div>

      <div
        className="flex-1 rounded-2xl overflow-hidden"
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#080b0f",
          padding: "8px",
        }}
      >
        <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}
