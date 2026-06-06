import { useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Download } from "lucide-react";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  config: string;
  clientName?: string;
}

type QrMode = "awg" | "wg";

// ── Очистка конфига от комментариев ───────────────────────────────────────────
function stripComments(cfg: string): string {
  return cfg
    .split("\n")
    .filter(l => !l.trim().startsWith("#"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── AWG параметры которые не понимает стандартный WireGuard ───────────────────
const AWG_PARAMS = /^(Jc|Jmin|Jmax|S1|S2|S3|S4|H1|H2|H3|H4|I1|I2|I3|I4|I5)\s*=/;

// Режим AmneziaWG — .conf с AWG параметрами (то же что импорт файла в AmneziaVPN)
function buildAwgData(config: string): string {
  return stripComments(config);
}

// Режим WireGuard — .conf без AWG параметров
function buildWgData(config: string): string {
  return stripComments(config)
    .split("\n")
    .filter(l => !AWG_PARAMS.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function QrModal({ open, onClose, config, clientName }: Props) {
  const [mode, setMode]     = useState<QrMode>("awg");
  const [qrData, setQrData] = useState("");

  useEffect(() => {
    if (!open || !config) { setQrData(""); return; }
    setQrData(mode === "awg" ? buildAwgData(config) : buildWgData(config));
  }, [open, mode, config]);

  const tooBig  = qrData.length > 2900;
  const charLen = qrData.length;

  function downloadQr() {
    const canvas = document.getElementById("qr-canvas-el") as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${clientName || "vpn"}-${mode}-qr.png`;
    a.click();
  }

  return (
    <Modal open={open} onClose={onClose} title="QR-код подключения" size="sm">

      {/* Переключатель */}
      <div className="flex rounded-xl p-0.5 mb-5"
        style={{ background: "rgba(255,255,255,0.05)" }}>
        {([
          ["awg", "AmneziaVPN / AmneziaWG"],
          ["wg",  "WireGuard"],
        ] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
              mode === m ? "text-white" : "text-slate-500 hover:text-slate-300"
            }`}
            style={mode === m ? { background: "rgba(255,255,255,0.10)" } : {}}>
            {label}
          </button>
        ))}
      </div>

      {tooBig ? (
        <div className="mb-4 px-3 py-2 rounded-xl text-xs text-red-400"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          ⚠ Конфиг слишком большой для QR ({charLen} символов). Скачайте .conf файл.
        </div>
      ) : (
        <div className="mb-4 px-3 py-1.5 rounded-xl text-xs text-slate-500 text-center"
          style={{ background: "rgba(255,255,255,0.03)" }}>
          Размер данных: {charLen} симв.
        </div>
      )}

      {/* QR */}
      <div className="flex justify-center mb-4">
        {!tooBig && qrData ? (
          <div className="p-4 bg-white rounded-2xl inline-block">
            <QRCodeCanvas
              id="qr-canvas-el"
              value={qrData}
              size={280}
              level="M"
              marginSize={2}
            />
          </div>
        ) : tooBig ? (
          <div className="w-[312px] h-[60px] rounded-xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-xs text-slate-500">Слишком большой — скачайте .conf файл</p>
          </div>
        ) : null}
      </div>

      {/* Подсказка */}
      <p className="text-xs text-slate-500 text-center mb-4">
        {mode === "awg"
          ? "AmneziaVPN → + → Добавить туннель → Сканировать QR"
          : "WireGuard → + → Сканировать QR-код"}
      </p>

      {!tooBig && qrData && (
        <button type="button" onClick={downloadQr}
          className="btn-ghost w-full justify-center text-xs">
          <Download size={14} /> Сохранить QR как PNG
        </button>
      )}
    </Modal>
  );
}
