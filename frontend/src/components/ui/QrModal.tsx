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
 * Strip comment lines (# ...) to reduce QR size.
 * Both AmneziaVPN and WireGuard ignore comments anyway.
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
 * AmneziaVPN reads CLIENT configs as raw .conf text (same as WireGuard).
 * JSON-array format is only for SERVER container export, not client configs.
 *
 * The difference between modes:
 * - amnezia:   keeps AWG-specific params (Jc/Jmin/Jmax/S1/S2/H1-H4)
 * - wireguard: strips AWG params so standard WireGuard apps don't choke
 */
const AWG_PARAMS = /^(Jc|Jmin|Jmax|S1|S2|S3|S4|H1|H2|H3|H4|I1|I2|I3|I4|I5)\s*=/;

function buildQrData(config: string, mode: QrMode): string {
  const clean = stripComments(config);
  if (mode === "wireguard") {
    // Remove AmneziaWG-only params for standard WireGuard clients
    return clean
      .split("\n")
      .filter(line => !AWG_PARAMS.test(line.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  // AmneziaVPN: full config as-is (with AWG params)
  return clean;
}

export function QrModal({ open, onClose, config, clientName }: Props) {
  const [mode, setMode] = useState<QrMode>("amnezia");

  const qrData  = buildQrData(config, mode);
  const tooBig  = qrData.length > 2800;

  function downloadQr() {
    const canvas = document.getElementById("qr-canvas-el") as HTMLCanvasElement | null;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a   = document.createElement("a");
    a.href    = url;
    a.download = `${clientName || "vpn"}-${mode}-qr.png`;
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

      {/* Too large warning */}
      {tooBig && (
        <div className="mb-4 px-3 py-2 rounded-xl text-xs text-yellow-400"
          style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)" }}>
          ⚠ Конфиг слишком большой для QR. Используйте скачивание .conf файла.
        </div>
      )}

      {/* QR */}
      <div className="flex justify-center mb-4">
        {!tooBig ? (
          <div className="p-4 bg-white rounded-2xl">
            <QRCodeCanvas
              id="qr-canvas-el"
              value={qrData}
              size={230}
              level="L"
              marginSize={1}
            />
          </div>
        ) : (
          <div className="w-[262px] h-[262px] rounded-2xl flex items-center justify-center"
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
          ? "AmneziaVPN → + → Добавить туннель → Сканировать QR"
          : "WireGuard → + → Сканировать QR-код"}
      </p>

      {/* Download QR as PNG */}
      {!tooBig && (
        <button type="button" onClick={downloadQr}
          className="btn-ghost w-full justify-center text-xs">
          <Download size={14} /> Сохранить QR как PNG
        </button>
      )}
    </Modal>
  );
}
