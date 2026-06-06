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

const CHUNK_SIZE   = 1200;   // chars per QR frame
const FRAME_MS     = 2000;   // ms per frame

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

// Разбить строку на чанки с префиксом "N/TOTAL\n"
function makeFrames(data: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    chunks.push(data.slice(i, i + CHUNK_SIZE));
  }
  const total = chunks.length;
  return chunks.map((chunk, idx) =>
    total > 1 ? `${idx + 1}/${total}\n${chunk}` : chunk
  );
}

export function QrModal({ open, onClose, config, clientName }: Props) {
  const [mode, setMode]       = useState<QrMode>("awg");
  const [frames, setFrames]   = useState<string[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null);

  // Пересчёт кадров при смене конфига или режима
  useEffect(() => {
    if (!open || !config) { setFrames([]); setFrameIdx(0); return; }
    const data = mode === "awg" ? buildAwgData(config) : buildWgData(config);
    setFrames(makeFrames(data));
    setFrameIdx(0);
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
  const charLen      = (mode === "awg" ? buildAwgData(config) : buildWgData(config)).length;

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
        {isAnimated
          ? `Анимированный QR • ${frames.length} кадра • ${charLen} симв.`
          : `Размер данных: ${charLen} симв.`}
      </div>

      {/* QR */}
      <div className="flex justify-center mb-3">
        {currentFrame ? (
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

      {!isAnimated && currentFrame && (
        <button type="button" onClick={downloadQr}
          className="btn-ghost w-full justify-center text-xs">
          <Download size={14} /> Сохранить QR как PNG
        </button>
      )}
    </Modal>
  );
}
