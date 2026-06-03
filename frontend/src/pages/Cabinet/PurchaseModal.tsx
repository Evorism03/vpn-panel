import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";

interface Plan {
  term: string;
  label: string;
  amount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  // Renewal mode: pass clientId + clientName
  clientId?: string;
  clientName?: string;
  // New subscription mode: pass email to pre-fill
  email?: string;
  onSuccess?: () => void;
}

type Step = "select" | "form" | "loading" | "payment" | "success" | "free";

const TERM_ORDER = ["3d", "7d", "14d", "1m", "3m", "6m", "1y"];

export function PurchaseModal({ open, onClose, clientId, clientName, email: prefillEmail, onSuccess }: Props) {
  const isRenewal = !!clientId;

  const [step, setStep]       = useState<Step>("select");
  const [selectedTerm, setSelectedTerm] = useState("1m");
  const [login, setLogin]     = useState("");
  const [email, setEmail]     = useState(prefillEmail || "");
  const [error, setError]     = useState("");
  const [payUrl, setPayUrl]   = useState("");
  const [newExpiry, setNewExpiry] = useState("");

  // Load prices from server
  const { data: shopCfg } = useQuery({
    queryKey: ["shop-config"],
    queryFn: async () => (await api.get("/shop/config")).data,
    staleTime: 60_000,
  });

  const paymentsEnabled: boolean = shopCfg?.payments_enabled ?? false;
  const prices: Record<string, Plan> = shopCfg?.prices ?? {};

  const plans: Plan[] = TERM_ORDER
    .filter(t => prices[t] && prices[t].amount > 0)
    .map(t => prices[t]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("select");
      setError("");
      setPayUrl("");
      setNewExpiry("");
      setEmail(prefillEmail || "");
      setLogin("");
      if (plans.length > 0) setSelectedTerm(plans[0].term);
    }
  }, [open]);

  async function proceed() {
    setError("");

    // New subscription — need login+email
    if (!isRenewal && step === "select") {
      setStep("form");
      return;
    }

    await submit(login, email);
  }

  async function submit(loginVal: string, emailVal: string) {
    if (!isRenewal) {
      if (!loginVal.trim()) { setError("Введите имя"); return; }
      if (!emailVal.trim()) { setError("Введите email"); return; }
    }
    setStep("loading");

    try {
      // 1. Create order
      const payload = isRenewal
        ? { client_id: clientId, term: selectedTerm }
        : { login: loginVal.trim(), email: emailVal.trim(), term: selectedTerm };

      const { data: orderData } = await api.post("/shop/order", payload);
      const order = orderData.order;

      // 2a. Already issued (free / no payment needed)
      if (order.status === "issued") {
        setNewExpiry(order.expires_at || "");
        setStep(paymentsEnabled ? "success" : "free");
        onSuccess?.();
        return;
      }

      // 2b. Needs payment
      if (paymentsEnabled) {
        const { data: payData } = await api.post("/shop/payment", {
          order_id: order.id,
          term: selectedTerm,
          email: emailVal.trim() || order.email || "",
        });
        setPayUrl(payData.pay_url);
        setStep("payment");
      } else {
        // No payment system — order pending
        setStep("free");
      }
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка при создании заказа");
      setStep(isRenewal ? "select" : "form");
    }
  }

  const selectedPlan = prices[selectedTerm];
  const title = isRenewal
    ? `Продлить — ${clientName || clientId}`
    : "Новая подписка";

  return (
    <Modal open={open} onClose={onClose} title={step === "select" || step === "form" ? title : undefined} size="sm">

      {/* ── Step: plan selection ─────────────────────────────────────────── */}
      {step === "select" && (
        <div className="space-y-4">
          {plans.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">
              Цены не настроены. Обратитесь к администратору.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {plans.map(plan => (
                  <button
                    key={plan.term}
                    onClick={() => setSelectedTerm(plan.term)}
                    className={`rounded-xl p-3 text-left border transition-all ${
                      selectedTerm === plan.term
                        ? "border-green-500/50 bg-green-500/10"
                        : "border-white/8 bg-white/3 hover:bg-white/6"
                    }`}
                  >
                    <p className="text-base font-bold text-white">{plan.amount} ₽</p>
                    <p className="text-xs text-slate-400">{plan.label}</p>
                  </button>
                ))}
              </div>

              {selectedPlan && (
                <div className="rounded-xl bg-white/4 border border-white/8 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-slate-300">Итого</span>
                  <span className="text-white font-semibold">
                    {paymentsEnabled ? `${selectedPlan.amount} ₽` : "Бесплатно"}
                  </span>
                </div>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex gap-2">
                <button className="btn-ghost flex-1" onClick={onClose}>Отмена</button>
                <button
                  className="btn-primary flex-1"
                  onClick={proceed}
                  disabled={!selectedPlan}
                >
                  {isRenewal
                    ? paymentsEnabled ? "Оплатить" : "Продлить"
                    : "Продолжить"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Step: fill form (new sub only) ───────────────────────────────── */}
      {step === "form" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Ваше имя</label>
            <input className="input" placeholder="Иван" value={login}
              onChange={e => setLogin(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Email</label>
            <input className="input" type="email" placeholder="ivan@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit(login, email)} />
          </div>

          <div className="rounded-xl bg-white/4 border border-white/8 px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-slate-300">{selectedPlan?.label}</span>
            <span className="text-white font-semibold">
              {paymentsEnabled ? `${selectedPlan?.amount} ₽` : "Бесплатно"}
            </span>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setStep("select")}>← Назад</button>
            <button className="btn-primary flex-1" onClick={() => submit(login, email)}>
              {paymentsEnabled ? "Оплатить" : "Оформить"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: loading ─────────────────────────────────────────────────── */}
      {step === "loading" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Spinner />
          <p className="text-sm text-slate-400">Создаём заказ...</p>
        </div>
      )}

      {/* ── Step: payment ─────────────────────────────────────────────────── */}
      {step === "payment" && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-12 h-12 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center text-xl">
            💳
          </div>
          <div>
            <p className="text-white font-semibold mb-1">Перейдите к оплате</p>
            <p className="text-sm text-slate-400">
              После оплаты подписка активируется автоматически
            </p>
          </div>
          <a
            href={payUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-primary w-full justify-center"
          >
            Оплатить {selectedPlan?.amount} ₽ <ExternalLink size={14} />
          </a>
          <button className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            onClick={() => { onClose(); onSuccess?.(); }}>
            Уже оплатил — закрыть
          </button>
        </div>
      )}

      {/* ── Step: success / free ──────────────────────────────────────────── */}
      {(step === "success" || step === "free") && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <CheckCircle2 size={48} className="text-green-400" />
          <div>
            <p className="text-white font-semibold mb-1">
              {isRenewal ? "Подписка продлена!" : "Подписка оформлена!"}
            </p>
            {newExpiry && (
              <p className="text-sm text-slate-400">
                Активна до{" "}
                <span className="text-white">
                  {new Date(newExpiry).toLocaleDateString("ru-RU", {
                    day: "numeric", month: "long", year: "numeric",
                  })}
                </span>
              </p>
            )}
          </div>
          <button className="btn-primary w-full" onClick={onClose}>Закрыть</button>
        </div>
      )}
    </Modal>
  );
}
