import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";

interface Plan { term: string; label: string; amount: number }

interface Props {
  open: boolean;
  onClose: () => void;
  clientId?: string;     // set → renewal mode
  clientName?: string;
  email?: string;        // pre-fill email
  onSuccess?: () => void;
}

type Step = "select" | "form" | "loading" | "payment" | "success";

const TERM_ORDER = ["3d", "7d", "14d", "1m", "3m", "6m", "1y"];

// Static fallback when server prices haven't loaded yet
const FALLBACK_PLANS: Plan[] = [
  { term: "1m", label: "1 месяц",   amount: 0 },
  { term: "3m", label: "3 месяца",  amount: 0 },
  { term: "6m", label: "6 месяцев", amount: 0 },
  { term: "1y", label: "1 год",     amount: 0 },
];

export function PurchaseModal({
  open, onClose, clientId, clientName, email: prefillEmail, onSuccess,
}: Props) {
  const isRenewal = !!clientId;

  const [step, setStep]             = useState<Step>("select");
  const [selectedTerm, setTerm]     = useState("1m");
  const [login, setLogin]           = useState("");
  const [email, setEmail]           = useState(prefillEmail || "");
  const [error, setError]           = useState("");
  const [payUrl, setPayUrl]         = useState("");
  const [newExpiry, setNewExpiry]   = useState("");

  const { data: shopCfg, isLoading: cfgLoading } = useQuery({
    queryKey: ["shop-config"],
    queryFn: async () => (await api.get("/shop/config")).data,
    staleTime: 60_000,
  });

  const paymentsEnabled: boolean      = shopCfg?.payments_enabled ?? false;
  const rawPrices: Record<string, Plan> = shopCfg?.prices ?? {};

  // Build plan list — fallback while loading, then real data
  const plans: Plan[] = cfgLoading
    ? FALLBACK_PLANS
    : TERM_ORDER
        .filter(t => rawPrices[t])
        .map(t => rawPrices[t]);

  // Pick first valid plan as default once data arrives
  useEffect(() => {
    if (!cfgLoading && plans.length > 0) {
      setTerm(t => plans.find(p => p.term === t) ? t : plans[0].term);
    }
  }, [cfgLoading]);

  // Reset state every time modal opens
  useEffect(() => {
    if (open) {
      setStep("select");
      setError(""); setPayUrl(""); setNewExpiry("");
      setEmail(prefillEmail || "");
      setLogin("");
    }
  }, [open, prefillEmail]);

  const selectedPlan = plans.find(p => p.term === selectedTerm) ?? plans[0];
  const showPrice    = paymentsEnabled && selectedPlan?.amount > 0;
  const btnLabel     = isRenewal
    ? showPrice ? `Оплатить ${selectedPlan?.amount} ₽` : "Продлить"
    : "Продолжить";

  async function handleProceed() {
    setError("");
    if (!isRenewal) { setStep("form"); return; }
    await doSubmit("", email);
  }

  async function doSubmit(loginVal: string, emailVal: string) {
    if (!isRenewal && !loginVal.trim()) { setError("Введите имя"); return; }
    if (!isRenewal && !emailVal.trim()) { setError("Введите email"); return; }
    setStep("loading");

    try {
      const payload = isRenewal
        ? { client_id: clientId, term: selectedTerm }
        : { login: loginVal.trim(), email: emailVal.trim(), term: selectedTerm };

      const { data: od } = await api.post("/shop/order", payload);
      const order = od.order;

      if (order.status === "issued") {
        setNewExpiry(order.expires_at || "");
        setStep("success");
        onSuccess?.();
        return;
      }

      if (paymentsEnabled) {
        const { data: pd } = await api.post("/shop/payment", {
          order_id: order.id,
          term: selectedTerm,
          email: emailVal || order.email || "",
        });
        setPayUrl(pd.pay_url);
        setStep("payment");
      } else {
        // No payment system — show success anyway (order pending, admin will process)
        setNewExpiry(order.expires_at || "");
        setStep("success");
        onSuccess?.();
      }
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка при создании заказа");
      setStep(isRenewal ? "select" : "form");
    }
  }

  const title = step === "select" || step === "form"
    ? isRenewal ? `Продлить — ${clientName || clientId}` : "Новая подписка"
    : undefined;

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">

      {/* ── Select plan ─────────────────────────────────────────────────── */}
      {step === "select" && (
        <div className="space-y-4">
          {cfgLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : plans.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">
              Тарифы не настроены. Обратитесь к администратору.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {plans.map(plan => (
                <button
                  key={plan.term}
                  onClick={() => setTerm(plan.term)}
                  className={`rounded-xl p-3 text-left border transition-all ${
                    selectedTerm === plan.term
                      ? "border-green-500/50 bg-green-500/10"
                      : "border-white/8 bg-white/3 hover:bg-white/6"
                  }`}
                >
                  <p className="text-base font-bold text-white">
                    {showPrice || plan.amount > 0 ? `${plan.amount} ₽` : "Бесплатно"}
                  </p>
                  <p className="text-xs text-slate-400">{plan.label}</p>
                </button>
              ))}
            </div>
          )}

          {selectedPlan && !cfgLoading && (
            <div className="rounded-xl bg-white/4 border border-white/8 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-slate-300">Итого</span>
              <span className="text-white font-semibold">
                {showPrice ? `${selectedPlan.amount} ₽` : "Бесплатно"}
              </span>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={onClose}>Отмена</button>
            <button
              className="btn-primary flex-1"
              onClick={handleProceed}
              disabled={cfgLoading || plans.length === 0}
            >
              {btnLabel}
            </button>
          </div>
        </div>
      )}

      {/* ── Fill form (new subscription) ────────────────────────────────── */}
      {step === "form" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Ваше имя</label>
            <input className="input" placeholder="Иван" value={login} autoFocus
              onChange={e => setLogin(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Email</label>
            <input className="input" type="email" placeholder="ivan@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSubmit(login, email)} />
          </div>

          <div className="rounded-xl bg-white/4 border border-white/8 px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-slate-300">{selectedPlan?.label}</span>
            <span className="text-white font-semibold">
              {showPrice ? `${selectedPlan?.amount} ₽` : "Бесплатно"}
            </span>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setStep("select")}>← Назад</button>
            <button className="btn-primary flex-1" onClick={() => doSubmit(login, email)}>
              {showPrice ? `Оплатить ${selectedPlan?.amount} ₽` : "Оформить"}
            </button>
          </div>
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {step === "loading" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Spinner />
          <p className="text-sm text-slate-400">Обрабатываем заказ...</p>
        </div>
      )}

      {/* ── Payment ──────────────────────────────────────────────────────── */}
      {step === "payment" && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-12 h-12 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center text-2xl">
            💳
          </div>
          <div>
            <p className="text-white font-semibold mb-1">Перейдите к оплате</p>
            <p className="text-sm text-slate-400">
              После оплаты подписка активируется автоматически
            </p>
          </div>
          <a href={payUrl} target="_blank" rel="noreferrer" className="btn-primary w-full justify-center">
            Оплатить {selectedPlan?.amount} ₽ <ExternalLink size={14} />
          </a>
          <button
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            onClick={() => { onClose(); onSuccess?.(); }}
          >
            Уже оплатил — закрыть
          </button>
        </div>
      )}

      {/* ── Success ──────────────────────────────────────────────────────── */}
      {step === "success" && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <CheckCircle2 size={48} className="text-green-400" />
          <div>
            <p className="text-white font-semibold mb-1">
              {isRenewal ? "Подписка продлена!" : "Подписка оформлена!"}
            </p>
            {newExpiry ? (
              <p className="text-sm text-slate-400">
                Активна до{" "}
                <span className="text-white font-medium">
                  {new Date(newExpiry).toLocaleDateString("ru-RU", {
                    day: "numeric", month: "long", year: "numeric",
                  })}
                </span>
              </p>
            ) : (
              <p className="text-sm text-slate-400">
                Заказ принят. Администратор обработает его в ближайшее время.
              </p>
            )}
          </div>
          <button className="btn-primary w-full" onClick={onClose}>Закрыть</button>
        </div>
      )}
    </Modal>
  );
}
