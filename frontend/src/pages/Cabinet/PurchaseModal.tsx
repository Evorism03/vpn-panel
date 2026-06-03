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
  clientId?: string;
  clientName?: string;
  email?: string;
  onSuccess?: () => void;
}

type Step = "select" | "form" | "loading" | "payment" | "success";

const TERM_ORDER = ["3d", "7d", "14d", "1m", "3m", "6m", "1y"];

export function PurchaseModal({
  open, onClose, clientId, clientName, email: prefillEmail, onSuccess,
}: Props) {
  const isRenewal = !!clientId;

  const [step, setStep]       = useState<Step>("select");
  const [login, setLogin]     = useState("");
  const [email, setEmail]     = useState(prefillEmail || "");
  const [error, setError]     = useState("");
  const [payUrl, setPayUrl]   = useState("");
  const [newExpiry, setNewExpiry] = useState("");

  // term lives purely in state, no ref, no effects touching it
  const [term, setTerm] = useState("1m");

  const { data: shopCfg, isLoading: cfgLoading } = useQuery({
    queryKey: ["shop-config"],
    queryFn: async () => (await api.get("/shop/config")).data,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: false,     // never background-refetch while open
  });

  const paymentsEnabled = shopCfg?.payments_enabled ?? false;
  const rawPrices: Record<string, Plan> = shopCfg?.prices ?? {};
  // Include `term` key explicitly — rawPrices[t] only has {amount, label}
  const plans: Plan[] = TERM_ORDER
    .filter(t => rawPrices[t])
    .map(t => ({ amount: rawPrices[t].amount, label: rawPrices[t].label, term: t }));

  // Reset form when modal opens — keep term as-is so user doesn't lose selection
  useEffect(() => {
    if (open) {
      setStep("select");
      setError(""); setPayUrl(""); setNewExpiry("");
      setEmail(prefillEmail || "");
      setLogin("");
    }
  }, [open]); // eslint-disable-line

  // Set initial term once — only when plans first arrive AND term isn't valid yet
  useEffect(() => {
    if (plans.length > 0 && !plans.find(p => p.term === term)) {
      setTerm(plans[0].term);
    }
  }, [plans.length]); // eslint-disable-line — depend only on count, not on array reference

  const selectedPlan = plans.find(p => p.term === term);
  const showPrice    = paymentsEnabled && (selectedPlan?.amount ?? 0) > 0;

  // ── Submit reads `term` from the closure of the CURRENT render ────────────
  async function submit(loginVal: string, emailVal: string, submitTerm: string) {
    if (!isRenewal && !loginVal.trim()) { setError("Введите имя"); return; }
    if (!isRenewal && !emailVal.trim()) { setError("Введите email"); return; }

    setStep("loading");
    try {
      const payload = isRenewal
        ? { client_id: clientId, term: submitTerm }
        : { login: loginVal.trim(), email: emailVal.trim(), term: submitTerm };

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
          term: submitTerm,
          email: emailVal || order.email || "",
        });
        setPayUrl(pd.pay_url);
        setStep("payment");
      } else {
        setNewExpiry(order.expires_at || "");
        setStep("success");
        onSuccess?.();
      }
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка при создании заказа");
      setStep(isRenewal ? "select" : "form");
    }
  }

  const title = (step === "select" || step === "form")
    ? (isRenewal ? `Продлить — ${clientName || clientId}` : "Новая подписка")
    : undefined;

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">

      {/* ── Select plan ────────────────────────────────────────────────── */}
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
              {plans.map(plan => {
                const active = term === plan.term;
                return (
                  <button
                    key={plan.term}
                    type="button"
                    onClick={() => setTerm(plan.term)}
                    className="rounded-xl p-3 text-left transition-all relative outline-none"
                    style={{
                      background: active
                        ? "rgba(34,197,94,0.13)"
                        : "rgba(255,255,255,0.04)",
                      border: `1.5px solid ${active
                        ? "rgba(34,197,94,0.55)"
                        : "rgba(255,255,255,0.10)"}`,
                      boxShadow: active
                        ? "0 0 18px -4px rgba(34,197,94,0.3)"
                        : "none",
                    }}
                  >
                    {active && (
                      <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-400" />
                    )}
                    <p className="text-base font-bold text-white">
                      {plan.amount > 0 ? `${plan.amount} ₽` : "Бесплатно"}
                    </p>
                    <p className="text-xs text-slate-400">{plan.label}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Summary row */}
          {selectedPlan && (
            <div className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span className="text-sm text-slate-300">{selectedPlan.label}</span>
              <span className="text-white font-semibold">
                {showPrice ? `${selectedPlan.amount} ₽` : "Бесплатно"}
              </span>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={onClose}>
              Отмена
            </button>
            {/* Pass current `term` value explicitly at click time */}
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={cfgLoading || !selectedPlan}
              onClick={() => {
                const t = term; // capture synchronously
                if (isRenewal) submit("", email, t);
                else setStep("form");
              }}
            >
              {isRenewal
                ? showPrice ? `Оплатить ${selectedPlan?.amount} ₽` : "Продлить"
                : "Продолжить →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Form (new subscription) ─────────────────────────────────────── */}
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
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="flex items-center justify-between px-4 py-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <span className="text-sm text-slate-300">{selectedPlan?.label}</span>
            <span className="text-white font-semibold">
              {showPrice ? `${selectedPlan?.amount} ₽` : "Бесплатно"}
            </span>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost flex-1"
              onClick={() => setStep("select")}>← Назад</button>
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={() => {
                const t = term; // capture synchronously
                submit(login, email, t);
              }}
            >
              {showPrice ? `Оплатить ${selectedPlan?.amount} ₽` : "Оформить"}
            </button>
          </div>
        </div>
      )}

      {/* ── Loading ─────────────────────────────────────────────────────── */}
      {step === "loading" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Spinner />
          <p className="text-sm text-slate-400">Обрабатываем заказ...</p>
        </div>
      )}

      {/* ── Payment ─────────────────────────────────────────────────────── */}
      {step === "payment" && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
            style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.2)" }}>
            💳
          </div>
          <div>
            <p className="text-white font-semibold mb-1">Перейдите к оплате</p>
            <p className="text-sm text-slate-400">
              После оплаты подписка активируется автоматически
            </p>
          </div>
          <a href={payUrl} target="_blank" rel="noreferrer"
            className="btn-primary w-full justify-center">
            Оплатить {selectedPlan?.amount} ₽ <ExternalLink size={14} />
          </a>
          <button type="button"
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            onClick={() => { onClose(); onSuccess?.(); }}>
            Уже оплатил — закрыть
          </button>
        </div>
      )}

      {/* ── Success ─────────────────────────────────────────────────────── */}
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
                  {new Date(newExpiry).toLocaleDateString("ru-RU",
                    { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </p>
            ) : (
              <p className="text-sm text-slate-400">
                Заказ принят, администратор обработает его в ближайшее время.
              </p>
            )}
          </div>
          <button type="button" className="btn-primary w-full" onClick={onClose}>
            Закрыть
          </button>
        </div>
      )}
    </Modal>
  );
}
