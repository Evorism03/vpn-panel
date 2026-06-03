import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download } from "lucide-react";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  config: string;        // raw .conf text
  clientName?: string;
}

type QrMode = "amnezia" | "wireguard";

/**
 * AmneziaVPN QR format: JSON array wrapping the config
 * WireGuard QR format:  raw .conf text
 */
function buildQrData(config: string, name: string, mode: QrMode): string {
  if (mode === "amnezia") {
    return JSON.stringify([{ config, description: name || "VPN" }]);
  }
  return config;
}

export function QrModal({ open, onClose, config, clientName }: Props) {
  const [mode, setMode] = useState<QrMode>("amnezia");

  const qrData = buildQrData(config, clientName || "VPN", mode);

  // Save QR as PNG via canvas
  function downloadQr() {
    const canvas = document.querySelector<HTMLCanvasElement>("#qr-canvas canvas");
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
      <div className="flex rounded-xl p-0.5 mb-5" style={{ background: "rgba(255,255,255,0.05)" }}>
        {([
          ["amnezia",   "AmneziaVPN"],
          ["wireguard", "WireGuard"],
        ] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
              mode === m ? "text-white" : "text-slate-500 hover:text-slate-300"
            }`}
            style={mode === m ? { background: "rgba(255,255,255,0.10)" } : {}}
          >
            {label}
          </button>
        ))}
      </div>

      {/* QR code */}
      <div id="qr-canvas" className="flex justify-center mb-4">
        <div className="p-4 bg-white rounded-2xl">
          <QRCodeSVG
            value={qrData}
            size={220}
            level="M"
          />
        </div>
      </div>

      {/* Hint */}
      <p className="text-xs text-slate-500 text-center mb-4">
        {mode === "amnezia"
          ? "Откройте AmneziaVPN → + → Сканировать QR-код"
          : "Откройте WireGuard → + → Сканировать QR-код"}
      </p>

      {/* Download button */}
      <button
        type="button"
        onClick={downloadQr}
        className="btn-ghost w-full justify-center text-xs"
      >
        <Download size={14} /> Сохранить QR как PNG
      </button>
    </Modal>
  );
}
