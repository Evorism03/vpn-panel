import { useState } from "react";
import { deflate } from "pako";
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

// ── Config helpers ────────────────────────────────────────────────────────────

function stripComments(cfg: string): string {
  return cfg
    .split("\n")
    .filter(l => !l.trim().startsWith("#"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseFields(cfg: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of cfg.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("[")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

// ── Qt qCompress ──────────────────────────────────────────────────────────────
// Qt format: [4 bytes big-endian uncompressed_size][zlib compressed data]
// This is exactly what AmneziaVPN generates and expects when scanning QR.

function qCompress(data: Uint8Array): Uint8Array {
  const compressed  = deflate(data);               // pako → zlib format
  const result      = new Uint8Array(4 + compressed.length);
  const view        = new DataView(result.buffer);
  view.setUint32(0, data.length, false);            // big-endian size header
  result.set(compressed, 4);
  return result;
}

// ── Base64 URL (no padding) — what AmneziaVPN uses ───────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ── AmneziaVPN container JSON ─────────────────────────────────────────────────
// Format used by AmneziaVPN when exporting/importing connections:
// vpn://BASE64URL( qCompress( JSON_string ) )

function buildAmneziaUri(config: string): string {
  const clean = stripComments(config);
  const f     = parseFields(clean);

  const ep        = f["Endpoint"] || "";
  const lastColon = ep.lastIndexOf(":");
  const host      = lastColon >= 0 ? ep.slice(0, lastColon) : ep;
  const port      = lastColon >= 0 ? ep.slice(lastColon + 1) : "51820";

  const container = [
    {
      container: "awg",
      awg: {
        last_config:                clean,
        hostName:                   host,
        port:                       port,
        transport_proto:            "udp",
        junkPacketCount:            f["Jc"]   || "4",
        junkPacketMinSize:          f["Jmin"] || "40",
        junkPacketMaxSize:          f["Jmax"] || "70",
        initPacketJunkSize:         f["S1"]   || "0",
        responsePacketJunkSize:     f["S2"]   || "0",
        initPacketMagicHeader:      f["H1"]   || "1",
        responsePacketMagicHeader:  f["H2"]   || "2",
        underloadPacketMagicHeader: f["H3"]   || "3",
        transportPacketMagicHeader: f["H4"]   || "4",
        client_priv_key:            f["PrivateKey"]   || "",
        server_pub_key:             f["PublicKey"]    || "",
        client_psk:                 f["PresharedKey"] || "",
      },
    },
  ];

  const json      = JSON.stringify(container);
  const bytes     = new TextEncoder().encode(json);
  const compressed = qCompress(bytes);

  return "vpn://" + toBase64Url(compressed);
}

// ── WireGuard plain QR ────────────────────────────────────────────────────────

const AWG_RE = /^(Jc|Jmin|Jmax|S1|S2|S3|S4|H1|H2|H3|H4)\s*=/;

function buildWireguardData(config: string): string {
  return stripComments(config)
    .split("\n")
    .filter(l => !AWG_RE.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QrModal({ open, onClose, config, clientName }: Props) {
  const [mode, setMode] = useState<QrMode>("amnezia");

  const qrData = mode === "amnezia"
    ? buildAmneziaUri(config)
    : buildWireguardData(config);

  const tooBig = qrData.length > 2900;

  function downloadQr() {
    const canvas = document.getElementById("qr-canvas-el") as HTMLCanvasElement | null;
    if (!canvas) return;
    const a    = document.createElement("a");
    a.href     = canvas.toDataURL("image/png");
    a.download = `${clientName || "vpn"}-${mode}-qr.png`;
    a.click();
  }

  return (
    <Modal open={open} onClose={onClose} title="QR-код подключения" size="sm">

      {/* Mode toggle */}
      <div className="flex rounded-xl p-0.5 mb-5"
        style={{ background: "rgba(255,255,255,0.05)" }}>
        {([["amnezia", "AmneziaVPN"], ["wireguard", "WireGuard"]] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
              mode === m ? "text-white" : "text-slate-500 hover:text-slate-300"
            }`}
            style={mode === m ? { background: "rgba(255,255,255,0.10)" } : {}}>
            {label}
          </button>
        ))}
      </div>

      {tooBig && (
        <div className="mb-4 px-3 py-2 rounded-xl text-xs text-yellow-400"
          style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)" }}>
          ⚠ Данные слишком большие. Используйте скачивание .conf файла.
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
          <div className="w-[262px] h-[50px] rounded-xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-xs text-slate-500">Слишком большой — скачайте .conf файл</p>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 text-center mb-4">
        {mode === "amnezia"
          ? "AmneziaVPN → + → Добавить туннель → Сканировать QR"
          : "WireGuard → + → Сканировать QR-код"}
      </p>

      {!tooBig && (
        <button type="button" onClick={downloadQr}
          className="btn-ghost w-full justify-center text-xs">
          <Download size={14} /> Сохранить QR как PNG
        </button>
      )}
    </Modal>
  );
}
