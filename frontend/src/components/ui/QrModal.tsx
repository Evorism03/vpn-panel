import { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Download } from "lucide-react";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  config: string;
  clientName?: string;
}

type QrMode = "amnezia" | "wireguard";

/**
 * Strip comment lines from config to reduce QR code size.
 * AmneziaVPN doesn't need them and QR codes have a size limit.
 */
function stripComments(config: string): string {
  return config
    .split("\n")
    .filter(line => !line.trim().startsWith("#"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * AmneziaVPN QR format — single JSON object (NOT array):
 * {"config": "...conf...", "description": "name"}
 *
 * WireGuard QR format — raw .conf text (comments stripped for size)
 */
function buildQrData(config: string, name: string, mode: QrMode): string {
  const clean = stripComments(config);
  if (mode === "amnezia") {
    return JSON.stringify({ config: clean, description: name || "VPN" });
  }
  return clean;
}

export function QrModal({ open, onClose, config, clientName }: Props) {
  const [mode, setMode] = useState<QrMode>("amnezia");

  const qrData = buildQrData(config, clientName || "VPN", mode);
  const tooBig = qrData.length > 2800; // QR v40 limit ~2953 bytes

  function downloadQr() {
    const canvas = document.getElementById("qr-canvas-el") as HTMLCanvasElement | null;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${clientName || "vpn"}-qr.png`;
    a.click();
  }

  return (
    <Modal open={open} onClose={onClose} title="QR-код подключения" size="sm">
      {/* Format toggle */}
      <div className="flex rounded-xl p-0.5 mb-5"
        style={{ background: "rgba(255,255,255,0.05)" }}>
        {([
          ["amnezia",   "AmneziaVPN"],
          ["wireguard", "WireGuard"],
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

      {/* Warning if config too large */}
      {tooBig && (
        <div className="mb-4 px-3 py-2 rounded-xl text-xs text-yellow-400"
          style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)" }}>
          ⚠ Конфиг слишком большой для QR. Используйте скачивание .conf файла.
        </div>
      )}

      {/* QR code */}
      <div className="flex justify-center mb-4">
        {!tooBig ? (
          <div className="p-4 bg-white rounded-2xl">
            <QRCodeCanvas
              id="qr-canvas-el"
              value={qrData}
              size={220}
              level="L"          // L = lowest correction = most data capacity
              marginSize={1}
            />
          </div>
        ) : (
          <div className="w-[252px] h-[252px] rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-xs text-slate-500 text-center px-4">
              Конфиг слишком большой.<br />Скачайте файл и импортируйте вручную.
            </p>
          </div>
        )}
      </div>

      {/* Hint */}
      <p className="text-xs text-slate-500 text-center mb-4">
        {mode === "amnezia"
          ? "AmneziaVPN → + → Сканировать QR-код"
          : "WireGuard → + → Сканировать QR-код"}
      </p>

      {/* Download */}
      {!tooBig && (
        <button type="button" onClick={downloadQr}
          className="btn-ghost w-full justify-center text-xs">
          <Download size={14} /> Сохранить QR как PNG
        </button>
      )}
    </Modal>
  );
}
