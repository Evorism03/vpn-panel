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

type QrMode = "amnezia" | "wireguard";

// ── adler32 — browser CompressionStream вычисляет неправильно ─────────────────
function adler32(data: Uint8Array): number {
  const MOD = 65521;
  let s1 = 1, s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % MOD;
    s2 = (s2 + s1) % MOD;
  }
  return ((s2 << 16) | s1) >>> 0;
}

// ── Парсинг .conf ──────────────────────────────────────────────────────────────
function parseConf(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      section = line.slice(1, -1).toLowerCase();
      result[section] = result[section] || {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0 || !section) continue;
    result[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return result;
}

// ── Сборка JSON для AmneziaVPN ─────────────────────────────────────────────────
function buildAmneziaJson(config: string, name: string): object {
  const conf  = parseConf(config);
  const iface = conf["interface"] || {};
  const peer  = conf["peer"]      || {};

  const privKey   = iface["PrivateKey"]          || "";
  const addr      = iface["Address"]             || "10.8.0.2/32";
  const dns       = iface["DNS"]                 || "1.1.1.1, 8.8.8.8";
  const mtu       = iface["MTU"]                 || "1280";
  const endpoint  = peer["Endpoint"]             || "";
  const pubKey    = peer["PublicKey"]             || "";
  const psk       = peer["PresharedKey"]         || "";
  const allowed   = peer["AllowedIPs"]           || "0.0.0.0/0, ::/0";
  const keepalive = peer["PersistentKeepalive"]  || "25";

  const lastColon = endpoint.lastIndexOf(":");
  const host    = lastColon >= 0 ? endpoint.slice(0, lastColon) : endpoint;
  const portStr = lastColon >= 0 ? endpoint.slice(lastColon + 1) : "51820";

  const dnsParts = dns.split(",").map(d => d.trim());
  const dns1 = dnsParts[0] || "1.1.1.1";
  const dns2 = dnsParts[1] || "8.8.8.8";
  const clientIp = addr.split("/")[0];

  // AWG параметры обфускации
  const AWG_KEYS = ["Jc","Jmin","Jmax","S1","S2","S3","S4","H1","H2","H3","H4","I1","I2","I3","I4","I5"];
  const awgParams: Record<string, string> = {};
  for (const k of AWG_KEYS) { const v = iface[k]; if (v) awgParams[k] = v; }

  // Внутренний JSON (last_config — это JSON-строка внутри JSON!)
  const lastConfig = {
    ...awgParams,
    allowed_ips:           allowed.split(",").map(s => s.trim()),
    clientId:              "",
    client_ip:             clientIp,
    client_priv_key:       privKey,
    client_pub_key:        "",
    config:                config,
    hostName:              host,
    mtu,
    persistent_keep_alive: keepalive,
    port:                  parseInt(portStr) || 51820,
    psk_key:               psk,
    server_pub_key:        pubKey,
  };

  const awg = {
    ...awgParams,
    last_config:      JSON.stringify(lastConfig),   // вложенная JSON-строка
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

// ── Генерация vpn:// URI ───────────────────────────────────────────────────────
// Формат: vpn:// + Base64Url( [4 байта размер big-endian] + deflate(JSON) )
// Adler32 в конце deflate-потока исправляется вручную (браузер считает неверно)
async function buildAmneziaUri(config: string, name: string): Promise<string> {
  const json = JSON.stringify(buildAmneziaJson(config, name));
  const data = new TextEncoder().encode(json);

  // 4-байтовый заголовок Qt qCompress — размер оригинала big-endian
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, data.length, false);

  // Сжатие через браузерный API
  const cs = new CompressionStream("deflate");
  const w  = cs.writable.getWriter();
  w.write(data); w.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());

  // Правим adler32 — последние 4 байта deflate-потока
  const checksum = adler32(data);
  new DataView(
    compressed.buffer,
    compressed.byteOffset + compressed.length - 4,
    4
  ).setUint32(0, checksum, false);

  // Собираем: заголовок + сжатые данные
  const result = new Uint8Array(4 + compressed.length);
  result.set(header, 0);
  result.set(compressed, 4);

  // Base64 URL-safe без паддинга
  let binary = "";
  result.forEach(b => binary += String.fromCharCode(b));
  return "vpn://" + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── WireGuard: чистый .conf без AWG параметров ────────────────────────────────
const AWG_RE = /^(Jc|Jmin|Jmax|S1|S2|S3|S4|H1|H2|H3|H4|I1|I2|I3|I4|I5)\s*=/;

function buildWireguardData(config: string): string {
  return config
    .split("\n")
    .filter(l => !l.trim().startsWith("#") && !AWG_RE.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Компонент ─────────────────────────────────────────────────────────────────

export function QrModal({ open, onClose, config, clientName }: Props) {
  const [mode, setMode]     = useState<QrMode>("amnezia");
  const [qrData, setQrData] = useState("");
  const [loading, setLoading] = useState(false);

  // Генерируем QR когда открывается модалка или меняется режим
  useEffect(() => {
    if (!open || !config) { setQrData(""); return; }

    let cancelled = false;
    setLoading(true);
    setQrData("");

    if (mode === "amnezia") {
      buildAmneziaUri(config, clientName || "VPN")
        .then(uri => { if (!cancelled) setQrData(uri); })
        .catch(e => { console.error("QR gen error:", e); })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      setQrData(buildWireguardData(config));
      setLoading(false);
    }

    return () => { cancelled = true; };
  }, [open, mode, config, clientName]);

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
    <Modal open={open} onClose={() => { onClose(); }} title="QR-код подключения" size="sm">

      {/* Переключатель режима */}
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
          ⚠ Данные слишком большие. Скачайте .conf файл.
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
            <QRCodeCanvas id="qr-canvas-el" value={qrData} size={230} level="L" marginSize={1} />
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

      {!tooBig && qrData && !loading && (
        <button type="button" onClick={downloadQr}
          className="btn-ghost w-full justify-center text-xs">
          <Download size={14} /> Сохранить QR как PNG
        </button>
      )}
    </Modal>
  );
}
