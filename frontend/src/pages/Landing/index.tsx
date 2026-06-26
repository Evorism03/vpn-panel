import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Zap, Globe, Lock, ChevronRight, Check,
  Download, Smartphone, ChevronDown, Wifi, Eye,
  ArrowRight, Star,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { PurchaseModal } from "../Cabinet/PurchaseModal";

// ── Animated grid background ──────────────────────────────────────────────────
function GridBg() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {/* Radial green glow */}
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[900px] h-[700px]
        bg-green-500/8 blur-[140px] rounded-full" />
      <div className="absolute top-[30%] right-[-10%] w-[500px] h-[500px]
        bg-emerald-500/5 blur-[100px] rounded-full" />
      <div className="absolute bottom-[10%] left-[-5%] w-[400px] h-[400px]
        bg-teal-500/5 blur-[100px] rounded-full" />

      {/* Dot grid */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]">
        <defs>
          <pattern id="dots" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#4ade80" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>

      {/* Top fade */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#080b0f] to-transparent" />
      {/* Bottom fade */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#080b0f] to-transparent" />
    </div>
  );
}

// ── Floating shield hero visual ───────────────────────────────────────────────
function HeroVisual() {
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer ring pulse */}
      <div className="absolute w-80 h-80 rounded-full border border-green-500/10 animate-ping"
        style={{ animationDuration: "3s" }} />
      <div className="absolute w-64 h-64 rounded-full border border-green-500/15
        animate-ping" style={{ animationDuration: "2s", animationDelay: "0.5s" }} />

      {/* Connection lines */}
      <svg className="absolute w-96 h-96 opacity-20" viewBox="0 0 200 200">
        <line x1="100" y1="100" x2="20"  y2="30"  stroke="#4ade80" strokeWidth="0.5" strokeDasharray="4 4" />
        <line x1="100" y1="100" x2="180" y2="40"  stroke="#4ade80" strokeWidth="0.5" strokeDasharray="4 4" />
        <line x1="100" y1="100" x2="170" y2="160" stroke="#4ade80" strokeWidth="0.5" strokeDasharray="4 4" />
        <line x1="100" y1="100" x2="30"  y2="170" stroke="#4ade80" strokeWidth="0.5" strokeDasharray="4 4" />
        <circle cx="20"  cy="30"  r="3" fill="#4ade80" opacity="0.6" />
        <circle cx="180" cy="40"  r="3" fill="#4ade80" opacity="0.6" />
        <circle cx="170" cy="160" r="3" fill="#4ade80" opacity="0.6" />
        <circle cx="30"  cy="170" r="3" fill="#4ade80" opacity="0.6" />
      </svg>

      {/* Center shield */}
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
        className="relative z-10 w-36 h-36 rounded-3xl flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(16,185,129,0.1) 100%)",
          border: "1px solid rgba(34,197,94,0.3)",
          boxShadow: "0 0 60px -10px rgba(34,197,94,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
        }}
      >
        <Shield size={60} className="text-green-400" strokeWidth={1.5} />
        {/* Online dot */}
        <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-4 w-4 bg-green-400 border-2 border-[#080b0f]" />
        </span>
      </motion.div>

      {/* Floating badges */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ repeat: Infinity, duration: 3, ease: "easeInOut", delay: 0.5 }}
        className="absolute -left-4 top-16 flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{ background: "rgba(15,20,25,0.9)", border: "1px solid rgba(34,197,94,0.2)" }}
      >
        <Lock size={13} className="text-green-400" />
        <span className="text-xs text-white font-medium">AES-256</span>
      </motion.div>

      <motion.div
        animate={{ y: [0, 6, 0] }}
        transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut", delay: 1 }}
        className="absolute -right-4 top-24 flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{ background: "rgba(15,20,25,0.9)", border: "1px solid rgba(34,197,94,0.2)" }}
      >
        <Wifi size={13} className="text-green-400" />
        <span className="text-xs text-white font-medium">Подключён</span>
      </motion.div>

      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: 0.2 }}
        className="absolute -left-8 bottom-16 flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{ background: "rgba(15,20,25,0.9)", border: "1px solid rgba(34,197,94,0.2)" }}
      >
        <Eye size={13} className="text-green-400" />
        <span className="text-xs text-white font-medium">Без логов</span>
      </motion.div>
    </div>
  );
}

// ── FAQ item ──────────────────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-2xl overflow-hidden cursor-pointer transition-all duration-200"
      style={{
        background: open ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${open ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.07)"}`,
      }}
      onClick={() => setOpen(v => !v)}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <span className="text-sm font-medium text-white">{q}</span>
        <ChevronDown
          size={16}
          className={`text-slate-400 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <p className="px-5 pb-4 text-sm text-slate-400 leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Step card ─────────────────────────────────────────────────────────────────
function Step({ n, icon: Icon, title, desc }: {
  n: number; icon: any; title: string; desc: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: n * 0.15, duration: 0.5 }}
      className="relative flex flex-col items-center text-center px-4"
    >
      {/* Number */}
      <div className="relative mb-5">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(16,185,129,0.08) 100%)",
            border: "1px solid rgba(34,197,94,0.25)",
          }}>
          <Icon size={26} className="text-green-400" />
        </div>
        <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-green-500 text-black
          text-xs font-bold flex items-center justify-center">
          {n}
        </span>
      </div>
      <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-slate-500 leading-relaxed max-w-[200px]">{desc}</p>
    </motion.div>
  );
}

// ── Pricing card ──────────────────────────────────────────────────────────────
const POPULAR_TERM = "3m";

function PriceCard({
  term, label, amount, popular, onBuy,
}: {
  term: string; label: string; amount: number; popular: boolean; onBuy: () => void;
}) {
  const savings: Record<string, string> = {
    "3m": "−15%", "6m": "−25%", "1y": "−37%",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className="relative rounded-2xl p-5 flex flex-col gap-4 cursor-pointer group"
      onClick={onBuy}
      style={{
        background: popular
          ? "linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(16,185,129,0.06) 100%)"
          : "rgba(255,255,255,0.03)",
        border: popular
          ? "1.5px solid rgba(34,197,94,0.45)"
          : "1px solid rgba(255,255,255,0.07)",
        boxShadow: popular ? "0 0 50px -10px rgba(34,197,94,0.25)" : "none",
      }}
    >
      {popular && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1
          px-3 py-1 rounded-full bg-green-500 text-black text-xs font-bold">
          <Star size={10} fill="black" /> Популярный
        </div>
      )}

      {savings[term] && (
        <span className="absolute top-4 right-4 text-xs font-semibold text-green-400
          bg-green-500/15 px-2 py-0.5 rounded-full">
          {savings[term]}
        </span>
      )}

      <div>
        <p className="text-2xl font-bold text-white mb-0.5">
          {amount > 0 ? `${amount} ₽` : "Бесплатно"}
        </p>
        <p className="text-sm text-slate-400">{label}</p>
      </div>

      <ul className="space-y-2 flex-1">
        {["Безлимитный трафик", "AmneziaWG", "Все устройства", "Без логов"].map(f => (
          <li key={f} className="flex items-center gap-2 text-xs text-slate-300">
            <Check size={13} className="text-green-400 shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      <button
        className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200
          flex items-center justify-center gap-1.5
          ${popular
            ? "bg-green-500 text-black hover:bg-green-400"
            : "bg-white/6 text-white hover:bg-white/10 group-hover:border-green-500/30"
          }`}
      >
        Подключиться <ArrowRight size={14} />
      </button>
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TERM_ORDER = ["3d", "7d", "14d", "1m", "3m", "6m", "1y"];

const FAQ = [
  {
    q: "Как быстро активируется подписка?",
    a: "Моментально. После оплаты конфигурационный файл создаётся автоматически — вы получите его в личном кабинете и на email в течение нескольких секунд.",
  },
  {
    q: "Какие устройства поддерживаются?",
    a: "Windows, macOS, Linux, iOS, Android — любое устройство с поддержкой WireGuard или AmneziaWG. Одна подписка — одно устройство.",
  },
  {
    q: "Чем AmneziaWG отличается от обычного VPN?",
    a: "AmneziaWG использует технику обфускации трафика, которая делает его неотличимым от обычного HTTPS. Это делает его устойчивым к DPI-блокировкам.",
  },
  {
    q: "Как войти в личный кабинет?",
    a: "После оформления вам выдаётся уникальный ID клиента. Перейдите в раздел «Кабинет» и введите этот ID — больше никаких паролей.",
  },
  {
    q: "Можно ли продлить подписку заранее?",
    a: "Да. В личном кабинете выберите «Продлить» — новый срок прибавится к текущей дате окончания, а не к сегодняшней.",
  },
];

export default function Landing() {
  const navigate   = useNavigate();
  const [buyOpen,  setBuyOpen]  = useState(false);
  const pricingRef = useRef<HTMLElement>(null);

  const { data: shopCfg } = useQuery({
    queryKey: ["shop-config"],
    queryFn: async () => (await api.get("/shop/config")).data,
    staleTime: 10 * 60_000,
  });

  const rawPrices = shopCfg?.prices ?? {};
  const plans = TERM_ORDER
    .filter(t => rawPrices[t] && rawPrices[t].amount > 0)
    .map(t => ({ term: t, label: rawPrices[t].label as string, amount: rawPrices[t].amount as number }));

  const popularPlan = plans.find(p => p.term === POPULAR_TERM) ?? plans[0];

  function scrollToPricing() {
    pricingRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-[#080b0f] relative overflow-x-hidden">
      <GridBg />

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav className="relative z-20 flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-green-500/20 border border-green-500/30
            flex items-center justify-center">
            <Shield size={15} className="text-green-400" />
          </div>
          <span className="font-bold text-white tracking-tight">
            {shopCfg?.panel_name || "VPN Panel"}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1">
          <button
            onClick={scrollToPricing}
            className="text-sm text-slate-400 hover:text-white px-4 py-2 rounded-xl
              hover:bg-white/5 transition-colors"
          >
            Тарифы
          </button>
          <button
            onClick={() => navigate("/cabinet")}
            className="text-sm text-slate-400 hover:text-white px-4 py-2 rounded-xl
              hover:bg-white/5 transition-colors"
          >
            Кабинет
          </button>
        </div>

        <button
          onClick={() => setBuyOpen(true)}
          className="btn-primary text-sm px-5 py-2"
        >
          Подключиться
        </button>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pt-16 pb-24
        grid lg:grid-cols-2 gap-12 items-center">

        {/* Left */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full mb-7
            text-xs font-medium text-green-400"
            style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Сервер онлайн · AmneziaWG
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white
            leading-[1.08] tracking-tight mb-6">
            VPN без<br />
            <span className="text-green-400">лишнего шума</span>
          </h1>

          <p className="text-slate-400 text-lg leading-relaxed mb-8 max-w-lg">
            Обходите блокировки с AmneziaWG — протоколом, который не отличить от
            обычного трафика. Подключение за 2 минуты, без регистрации аккаунтов.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap items-center gap-3 mb-10">
            <button
              onClick={() => setBuyOpen(true)}
              className="btn-primary text-base px-7 py-3.5 rounded-2xl
                shadow-[0_0_40px_-6px_rgba(34,197,94,0.5)]"
            >
              Купить подписку <ChevronRight size={18} />
            </button>
            <button
              onClick={() => navigate("/cabinet")}
              className="btn-ghost text-base px-6 py-3.5 rounded-2xl"
            >
              Войти в кабинет
            </button>
          </div>

          {/* Trust row */}
          <div className="flex flex-wrap gap-4">
            {[
              { icon: Lock,   text: "Шифрование AES-256" },
              { icon: Eye,    text: "Без логов" },
              { icon: Globe,  text: "Обход любых блокировок" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-1.5 text-xs text-slate-500">
                <Icon size={12} className="text-green-500" />
                {text}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right */}
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.15 }}
          className="flex justify-center lg:justify-end"
        >
          <HeroVisual />
        </motion.div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 mb-24">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.06)" }}>
          {[
            { value: "≤5 мс", label: "Задержка" },
            { value: "∞",     label: "Трафик" },
            { value: "1",     label: "Клик для подключения" },
            { value: "24/7",  label: "Работает всегда" },
          ].map(({ value, label }) => (
            <div key={label}
              className="flex flex-col items-center py-6 px-4 text-center"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <span className="text-2xl font-bold text-green-400 mb-1">{value}</span>
              <span className="text-xs text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 mb-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <p className="text-xs text-green-400 font-semibold tracking-widest uppercase mb-3">
            Как это работает
          </p>
          <h2 className="text-3xl font-bold text-white">Три шага до защиты</h2>
        </motion.div>

        <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-10">
          {/* Connector line (desktop) */}
          <div className="hidden sm:block absolute top-8 left-[20%] right-[20%] h-px
            border-t border-dashed border-green-500/20" />

          <Step n={1} icon={Shield}     title="Выберите тариф"
            desc="Выберите срок подписки и оплатите онлайн — принимаем карты" />
          <Step n={2} icon={Download}   title="Скачайте конфиг"
            desc="Конфиг-файл появится в личном кабинете сразу после оплаты" />
          <Step n={3} icon={Smartphone} title="Подключитесь"
            desc="Импортируйте файл в AmneziaWG — готово за 30 секунд" />
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 mb-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <p className="text-xs text-green-400 font-semibold tracking-widest uppercase mb-3">
            Почему мы
          </p>
          <h2 className="text-3xl font-bold text-white">Всё что нужно</h2>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              icon: Shield, title: "AmneziaWG", color: "green",
              desc: "Форк WireGuard с обфускацией — трафик неотличим от HTTPS, обходит DPI",
            },
            {
              icon: Zap, title: "Без ограничений", color: "yellow",
              desc: "Никаких лимитов по трафику и скорости. Смотрите 4K — не заметите разницы",
            },
            {
              icon: Globe, title: "Любые сайты", color: "blue",
              desc: "Работает со всеми заблокированными ресурсами. Ни один фильтр не остановит",
            },
            {
              icon: Eye, title: "Приватность", color: "purple",
              desc: "Мы не храним логи активности. Никому не известно, что вы делали онлайн",
            },
            {
              icon: Smartphone, title: "Все устройства", color: "orange",
              desc: "Windows, macOS, Linux, iOS, Android — один конфиг, одно устройство",
            },
            {
              icon: Lock, title: "Шифрование", color: "teal",
              desc: "ChaCha20-Poly1305 + Curve25519. Военный уровень защиты данных",
            },
          ].map(({ icon: Icon, title, desc, color }, i) => {
            const colors: Record<string, string> = {
              green: "rgba(34,197,94,0.12)", yellow: "rgba(234,179,8,0.12)",
              blue: "rgba(59,130,246,0.12)",  purple: "rgba(168,85,247,0.12)",
              orange: "rgba(249,115,22,0.12)",teal: "rgba(20,184,166,0.12)",
            };
            const border: Record<string, string> = {
              green: "rgba(34,197,94,0.2)",   yellow: "rgba(234,179,8,0.2)",
              blue: "rgba(59,130,246,0.2)",   purple: "rgba(168,85,247,0.2)",
              orange: "rgba(249,115,22,0.2)", teal: "rgba(20,184,166,0.2)",
            };
            const text: Record<string, string> = {
              green: "text-green-400",   yellow: "text-yellow-400",
              blue: "text-blue-400",     purple: "text-purple-400",
              orange: "text-orange-400", teal: "text-teal-400",
            };
            return (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07, duration: 0.4 }}
                className="rounded-2xl p-5"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: colors[color], border: `1px solid ${border[color]}` }}>
                  <Icon size={18} className={text[color]} />
                </div>
                <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section ref={pricingRef} className="relative z-10 max-w-5xl mx-auto px-6 mb-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <p className="text-xs text-green-400 font-semibold tracking-widest uppercase mb-3">
            Тарифы
          </p>
          <h2 className="text-3xl font-bold text-white mb-3">Выберите план</h2>
          <p className="text-slate-500 text-sm">Все планы включают полный доступ. Продление добавляет срок к текущему.</p>
        </motion.div>

        {plans.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">
            Тарифы не настроены. Обратитесь к администратору.
          </div>
        ) : (
          <div className={`grid gap-4 ${
            plans.length <= 2 ? "grid-cols-1 sm:grid-cols-2 max-w-xl mx-auto" :
            plans.length === 3 ? "grid-cols-1 sm:grid-cols-3" :
            "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
          }`}>
            {plans.map(plan => (
              <PriceCard
                key={plan.term}
                {...plan}
                popular={plan.term === (popularPlan?.term ?? "")}
                onBuy={() => setBuyOpen(true)}
              />
            ))}
          </div>
        )}

        {/* Money-back note */}
        <p className="text-center text-xs text-slate-600 mt-6">
          Есть вопросы? Напишите администратору до покупки.
        </p>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-2xl mx-auto px-6 mb-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <p className="text-xs text-green-400 font-semibold tracking-widest uppercase mb-3">
            FAQ
          </p>
          <h2 className="text-3xl font-bold text-white">Частые вопросы</h2>
        </motion.div>

        <div className="space-y-2">
          {FAQ.map(item => (
            <motion.div
              key={item.q}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3 }}
            >
              <FaqItem {...item} />
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── CTA banner ────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 mb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="rounded-3xl px-10 py-12 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(16,185,129,0.05) 100%)",
            border: "1px solid rgba(34,197,94,0.2)",
            boxShadow: "0 0 80px -20px rgba(34,197,94,0.2)",
          }}
        >
          <h2 className="text-3xl font-bold text-white mb-3">
            Готовы выйти в открытый интернет?
          </h2>
          <p className="text-slate-400 mb-8 max-w-md mx-auto">
            Подключитесь прямо сейчас — подписка активируется мгновенно.
          </p>
          <button
            onClick={() => setBuyOpen(true)}
            className="btn-primary text-base px-10 py-3.5 rounded-2xl
              shadow-[0_0_40px_-6px_rgba(34,197,94,0.5)]"
          >
            Подключиться сейчас <ChevronRight size={18} />
          </button>
        </motion.div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/6 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center
          justify-between gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-green-500/60" />
            <span>{shopCfg?.panel_name || "VPN Panel"} · AmneziaWG</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/cabinet")}
              className="hover:text-slate-400 transition-colors"
            >
              Личный кабинет
            </button>
            <button
              onClick={() => navigate("/admin")}
              className="hover:text-slate-400 transition-colors"
            >
              Администрирование
            </button>
          </div>
        </div>
      </footer>

      {/* Purchase modal */}
      <PurchaseModal
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
      />
    </div>
  );
}
