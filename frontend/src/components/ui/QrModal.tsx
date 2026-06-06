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

// ── adler32 checksum (browser CompressionStream computes it wrong) ─────────────
function adler32(data: Uint8Array): number {
  const MOD = 65521;
  let s1 = 1, s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % MOD;
    s2 = (s2 + s1) % MOD;
  }
  return ((s2 << 16) | s1) >>> 0;
}

// ── Config parsing ─────────────────────────────────────────────────────────────
function parseConf(text: string): Record<string, Record<string, string>> {
  const lines  = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  const result: Record<string, Record<string, string>> = {};
  let section  = "";
  for (const line of lines) {
    if (line.startsWith("[")) { section = line.slice(1, -1).toLowerCase(); result[section] = result[section] || {}; continue; }
    const eq = line.indexOf("=");
    if (eq < 0 || !section) continue;
    result[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return result;
}

// ── Build AmneziaVPN JSON container ───────────────────────────────────────────
function buildAmneziaJson(config: string, name: string) {
  const conf  = parseConf(config);
  const iface = conf["interface"] || {};
  const peer  = conf["peer"]      || {};

  const privKey   = iface["PrivateKey"]         || "";
  const addr      = iface["Address"]            || "10.8.0.2/32";
  const dns       = iface["DNS"]                || "1.1.1.1, 8.8.8.8";
  const mtu       = iface["MTU"]                || "1280";
  const endpoint  = peer["Endpoint"]            || "";
  const pubKey    = peer["PublicKey"]            || "";
  const psk       = peer["PresharedKey"]        || "";
  const allowed   = peer["AllowedIPs"]          || "0.0.0.0/0, ::/0";
  const keepalive = peer["PersistentKeepalive"] || "25";

  const lastColon = endpoint.lastIndexOf(":");
  const host      = lastColon >= 0 ? endpoint.slice(0, lastColon) : endpoint;
  const portStr   = lastColon >= 0 ? endpoint.slice(lastColon + 1) : "51820";

  const dnsParts = dns.split(",").map(d => d.trim());
  const dns1     = dnsParts[0] || "1.1.1.1";
  const dns2     = dnsParts[1] || "8.8.8.8";
  const clientIp = addr.split("/")[0];

  const AWG_KEYS = ["Jc","Jmin","Jmax","S1","S2","S3","S4","H1","H2","H3","H4","I1","I2","I3","I4","I5"];
  const awgParams: Record<string, string> = {};
  for (const k of AWG_KEYS) { const v = iface[k]; if (v) awgParams[k] = v; }

  // last_config is itself a JSON string (nested JSON)
  const lastConfig = {
    ...awgParams,
    allowed_ips:          allowed.split(",").map(s => s.trim()),
    clientId:             "",
    client_ip:            clientIp,
    client_priv_key:      privKey,
    client_pub_key:       "",
    config:               config,
    hostName:             host,
    mtu,
    persistent_keep_alive: keepalive,
    port:                 parseInt(portStr) || 51820,
    psk_key:              psk,
    server_pub_key:       pubKey,
  };

  const awg = {
    ...awgParams,
    last_config:      JSON.stringify(lastConfig),  // nested JSON string!
    port:             portStr,
    protocol_version: "2",
    transport_proto:  "udp",
  };

  return {
    containers:       [{ awg, container: "amnezia-awg2" }],
    defaultContainer: "amnezia-awg2",
    description:      name || `AWG ${host}`,
    dns1,
    dns2,
    hostName:         host,
  };
}

// ── AmneziaVPN URI: vpn:// + base64url( qCompress( JSON ) ) ─────────────────
// Uses native browser DeflateStream + manual adler32 fix (browser gets it wrong)
async function toAmneziaUri(config: string, name: string): Promise<string> {
  const json  = JSON.stringify(buildAmneziaJson(config, name));
  const data  = new TextEncoder().encode(json);

  // 4-byte big-endian uncompressed size header (Qt qCompress format)
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, data.length, false);

  // Deflate compress (browser API)
  const cs = new CompressionStream("deflate");
  const w  = cs.writable.getWriter();
  w.write(data); w.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());

  // Fix adler32 — browser CompressionStream computes it wrong
  const checksum = adler32(data);
  const dv = new DataView(compressed.buffer, compressed.byteOffset + compressed.length - 4, 4);
  dv.setUint32(0, checksum, false);

  // Combine header + compressed
  const result = new Uint8Array(4 + compressed.length);
  result.set(header, 0);
  result.set(compressed, 4);

  // Base64 URL-safe (no padding)
  let binary = "";
  result.forEach(b => binary += String.fromCharCode(b));
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return "vpn://" + b64;
}

// ── Standard WireGuard QR (raw .conf, no AWG params) ─────────────────────────
const AWG_RE = /^(Jc|Jmin|Jmax|S1|S2|S3|S4|H1|H2|H3|H4|I1|I2|I3|I4|I5)\s*=/;

function buildWireguardData(config: string): string {
  return config
    .split("\n")
    .filter(l => !l.trim().startsWith("#") && !AWG_RE.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QrModal({ open, onClose, config, clientName }: Props) {
  const [mode, setMode]     = useState<QrMode>("amnezia");
  const [qrData, setQrData] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Generate QR data when mode or config changes
  async function generate(m: QrMode, cfg: string) {
    if (!cfg) return;
    setLoading(true);
    try {
      if (m === "amnezia") {
        setQrData(await toAmneziaUri(cfg, clientName || "VPN"));
      } else {
        setQrData(buildWireguardData(cfg));
      }
    } finally {
      setLoading(false);
    }
  }

  // Generate on open / mode change
  useState(() => { if (open && config) generate(mode, config); });

  function switchMode(m: QrMode) {
    setMode(m);
    generate(m, config);
  }

  // Also generate when modal first opens
  if (open && config && !qrData && !loading) {
    generate(mode, config);
  }

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
    <Modal open={open} onClose={() => { onClose(); setQrData(""); }} title="QR-код подключения" size="sm">

      {/* Mode toggle */}
      <div className="flex rounded-xl p-0.5 mb-5"
        style={{ background: "rgba(255,255,255,0.05)" }}>
        {([["amnezia", "AmneziaVPN"], ["wireguard", "WireGuard"]] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => switchMode(m)}
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
          ⚠ Данные слишком большие для QR. Используйте скачивание .conf файла.
        </div>
      )}

      {/* QR */}
      <div className="flex justify-center mb-4">
        {loading ? (
          <div className="w-[262px] h-[262px] flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white/20 border-t-green-500 rounded-full animate-spin" />
          </div>
        ) : !tooBig && qrData ? (
          <div className="p-4 bg-white rounded-2xl">
            <QRCodeCanvas
              id="qr-canvas-el"
              value={qrData}
              size={230}
              level="L"
              marginSize={1}
            />
          </div>
        ) : tooBig ? (
          <div className="w-[262px] h-[50px] rounded-xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-xs text-slate-500">Слишком большой — скачайте .conf файл</p>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-slate-500 text-center mb-4">
        {mode === "amnezia"
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
