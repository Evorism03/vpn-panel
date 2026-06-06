import { useEffect, useRef, useState } from "react";
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

const FRAME_MS    = 2000;   // ms per frame
const CHUNK_BYTES = 600;    // raw bytes per chunk (fits comfortably in one QR)
const QR_MAGIC    = [0x07, 0xC0]; // AmneziaVPN qrMagicCode (qint16)

// ── Очистка конфига от комментариев ───────────────────────────────────────────
function stripComments(cfg: string): string {
  return cfg
    .split("\n")
    .filter(l => !l.trim().startsWith("#"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const AWG_PARAMS = /^(Jc|Jmin|Jmax|S1|S2|S3|S4|H1|H2|H3|H4|I1|I2|I3|I4|I5)\s*=/;

function buildAwgData(config: string): string {
  return stripComments(config);
}

function buildWgData(config: string): string {
  return stripComments(config)
    .split("\n")
    .filter(l => !AWG_PARAMS.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Qt qCompress: [4B BE uncompressed_size] + zlib_deflate(data) ──────────────
async function qCompress(text: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const raw = encoder.encode(text);

  // CompressionStream('deflate') = zlib format (78 9C header) matching Qt qCompress
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(raw);
  writer.close();

  const compressedBuf = await new Response(cs.readable).arrayBuffer();
  const compressed = new Uint8Array(compressedBuf);

  const out = new Uint8Array(4 + compressed.length);
  new DataView(out.buffer).setUint32(0, raw.length, false); // big-endian
  out.set(compressed, 4);
  return out;
}

// ── Бинарный фрейм AmneziaVPN: magic + total + id + size + chunk ─────────────
function buildAmneziaFrames(compressed: Uint8Array): string[] {
  // Split compressed bytes into chunks
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < compressed.length; i += CHUNK_BYTES) {
    chunks.push(compressed.slice(i, i + CHUNK_BYTES));
  }
  const total = chunks.length;

  return chunks.map((chunk, id) => {
    // Frame layout: magic(2) + total(1) + id(1) + chunk_size(4) + chunk_data
    const frame = new Uint8Array(8 + chunk.length);
    frame[0] = QR_MAGIC[0];
    frame[1] = QR_MAGIC[1];
    frame[2] = total;
    frame[3] = id;
    new DataView(frame.buffer).setUint32(4, chunk.length, false); // uint32 BE
    frame.set(chunk, 8);

    // Base64url, no padding
    let bin = "";
    frame.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  });
}

// ── Fallback: plain text в base64 (для WG или если CompressionStream нет) ────
function buildPlainFrames(text: string): string[] {
  return [text]; // single static QR
}

export function QrModal({ open, onClose, config, clientName }: Props) {
  const [mode, setMode]         = useState<QrMode>("awg");
  const [frames, setFrames]     = useState<string[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [loading, setLoading]   = useState(false);
  const timerRef                = useRef<ReturnType<typeof setInterval> | null>(null);

  // Строим фреймы при открытии или смене режима
  useEffect(() => {
    if (!open || !config) { setFrames([]); setFrameIdx(0); return; }

    const text = mode === "awg" ? buildAwgData(config) : buildWgData(config);

    if (mode === "awg" && typeof CompressionStream !== "undefined") {
      setLoading(true);
      qCompress(text).then(compressed => {
        setFrames(buildAmneziaFrames(compressed));
        setFrameIdx(0);
        setLoading(false);
      }).catch(() => {
        // Fallback to plain text if compression fails
        setFrames(buildPlainFrames(text));
        setFrameIdx(0);
        setLoading(false);
      });
    } else {
      setFrames(buildPlainFrames(text));
      setFrameIdx(0);
    }
  }, [open, mode, config]);

  // Анимация кадров
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (frames.length <= 1) return;
    timerRef.current = setInterval(() => {
      setFrameIdx(i => (i + 1) % frames.length);
    }, FRAME_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [frames]);

  const currentFrame = frames[frameIdx] ?? "";
  const isAnimated   = frames.length > 1;

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

      {/* Переключатель режима */}
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

      {/* Инфо-строка */}
      <div className="mb-4 px-3 py-1.5 rounded-xl text-xs text-center"
        style={{
          background: isAnimated ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)",
          border: isAnimated ? "1px solid rgba(99,102,241,0.25)" : "none",
          color: isAnimated ? "#a5b4fc" : "#64748b",
        }}>
        {loading
          ? "Сжатие данных..."
          : isAnimated
            ? `Анимированный QR • ${frames.length} кадра`
            : `Статичный QR • AmneziaVPN формат`}
      </div>

      {/* QR */}
      <div className="flex justify-center mb-3">
        {loading ? (
          <div className="w-[312px] h-[312px] rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)" }}>
            <p className="text-xs text-slate-500">Генерация...</p>
          </div>
        ) : currentFrame ? (
          <div className="p-4 bg-white rounded-2xl inline-block">
            <QRCodeCanvas
              key={frameIdx}
              id="qr-canvas-el"
              value={currentFrame}
              size={280}
              level="M"
              marginSize={2}
            />
          </div>
        ) : null}
      </div>

      {/* Индикатор кадра */}
      {isAnimated && (
        <div className="flex justify-center gap-1.5 mb-3">
          {frames.map((_, i) => (
            <div key={i}
              className="rounded-full transition-all duration-200"
              style={{
                width: i === frameIdx ? 20 : 6,
                height: 6,
                background: i === frameIdx ? "#818cf8" : "rgba(255,255,255,0.15)",
              }}
            />
          ))}
        </div>
      )}

      {/* Подсказка */}
      <p className="text-xs text-slate-500 text-center mb-4">
        {mode === "awg"
          ? "AmneziaVPN → + → Добавить туннель → Сканировать QR"
          : "WireGuard → + → Сканировать QR-код"}
        {isAnimated && <><br /><span className="text-indigo-400">Держите камеру — код сканируется автоматически</span></>}
      </p>

      {!isAnimated && !loading && currentFrame && (
        <button type="button" onClick={downloadQr}
          className="btn-ghost w-full justify-center text-xs">
          <Download size={14} /> Сохранить QR как PNG
        </button>
      )}
    </Modal>
  );
}
