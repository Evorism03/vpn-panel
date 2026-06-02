import { useState } from "react";
import { motion } from "framer-motion";
import { Shield, Zap, Globe, Lock, ChevronRight, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { BuyModal } from "./BuyModal";

const PLANS = [
  { term: "1m", label: "1 месяц",  price: 199, popular: false },
  { term: "3m", label: "3 месяца", price: 499, popular: true,  save: "Выгода 15%" },
  { term: "6m", label: "6 месяцев",price: 899, popular: false, save: "Выгода 24%" },
  { term: "1y", label: "1 год",    price: 1499,popular: false, save: "Выгода 37%" },
];

const FEATURES = [
  { icon: Shield, title: "AmneziaWG протокол", desc: "Надёжное шифрование, устойчив к DPI-фильтрации" },
  { icon: Zap,    title: "Высокая скорость",   desc: "Без ограничений трафика и полосы пропускания" },
  { icon: Globe,  title: "Все страны",          desc: "Обходите любые блокировки и ограничения" },
  { icon: Lock,   title: "Без логов",            desc: "Никаких записей активности, полная приватность" },
];

export default function Landing() {
  const [selectedPlan, setSelectedPlan] = useState<typeof PLANS[0] | null>(null);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#080b0f] relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 bg-radial-green pointer-events-none" />
      <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-green-500/6 blur-[120px] rounded-full pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-green-500/20 border border-green-500/30 flex items-center justify-center">
            <Shield size={16} className="text-green-400" />
          </div>
          <span className="font-semibold text-white">VPN Panel</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate("/cabinet")} className="btn-ghost text-sm">
            Кабинет
          </button>
          <button onClick={() => navigate("/admin")} className="btn-ghost text-sm">
            Войти
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 text-center pt-20 pb-24 px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs text-green-400 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Работает прямо сейчас
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-5 leading-tight tracking-tight">
            Безопасный VPN<br />
            <span className="text-green-400">без компромиссов</span>
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto mb-10">
            На базе AmneziaWG — самого надёжного протокола для обхода блокировок.
            Подключение за 2 минуты, поддержка всех устройств.
          </p>
          <button
            onClick={() => setSelectedPlan(PLANS[1])}
            className="btn-primary text-base px-8 py-3.5 rounded-2xl shadow-[0_0_30px_-4px_rgba(34,197,94,0.4)]"
          >
            Подключиться сейчас <ChevronRight size={18} />
          </button>
        </motion.div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-5xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 * i, duration: 0.5 }}
            >
              <Card className="text-center h-full">
                <div className="w-10 h-10 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center mx-auto mb-3">
                  <f.icon size={18} className="text-green-400" />
                </div>
                <p className="text-sm font-medium text-white mb-1">{f.title}</p>
                <p className="text-xs text-slate-500">{f.desc}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="relative z-10 max-w-5xl mx-auto px-4 pb-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl font-bold text-white mb-3">Выберите план</h2>
          <p className="text-slate-400">Все планы включают полный доступ без ограничений</p>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.term}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 * i + 0.4 }}
            >
              <div
                className={`relative rounded-2xl p-5 cursor-pointer transition-all duration-200 border ${
                  plan.popular
                    ? "bg-green-500/10 border-green-500/40 shadow-[0_0_40px_-8px_rgba(34,197,94,0.3)]"
                    : "glass glass-hover border-white/8"
                }`}
                onClick={() => setSelectedPlan(plan)}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-green-500 rounded-full text-xs text-black font-semibold">
                    Популярный
                  </div>
                )}
                {plan.save && (
                  <div className="text-xs text-green-400 mb-2">{plan.save}</div>
                )}
                <div className="text-2xl font-bold text-white mb-0.5">
                  {plan.price} ₽
                </div>
                <div className="text-sm text-slate-400 mb-4">{plan.label}</div>
                <ul className="space-y-1.5 mb-5 text-xs text-slate-300">
                  <li className="flex items-center gap-1.5"><Check size={12} className="text-green-400" />Безлимитный трафик</li>
                  <li className="flex items-center gap-1.5"><Check size={12} className="text-green-400" />AmneziaWG</li>
                  <li className="flex items-center gap-1.5"><Check size={12} className="text-green-400" />Все устройства</li>
                </ul>
                <button
                  className={`w-full py-2 rounded-xl text-sm font-medium transition-colors ${
                    plan.popular
                      ? "bg-green-500 text-black hover:bg-green-400"
                      : "bg-white/8 text-white hover:bg-white/12"
                  }`}
                >
                  Купить
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/6 py-6 text-center text-sm text-slate-600">
        © 2025 VPN Panel · AmneziaWG
      </footer>

      <BuyModal plan={selectedPlan} onClose={() => setSelectedPlan(null)} />
    </div>
  );
}
