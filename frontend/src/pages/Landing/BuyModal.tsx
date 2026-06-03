import { useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../api/client";
import { useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

interface Plan { term: string; label: string; price: number }

interface Props {
  plan: Plan | null;
  onClose: () => void;
}

type Step = "form" | "loading" | "success" | "payment";

export function BuyModal({ plan, onClose }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [_orderId, setOrderId] = useState("");
  const [payUrl, setPayUrl] = useState("");
  const navigate = useNavigate();

  function reset() {
    setStep("form");
    setError("");
    setLogin("");
    setEmail("");
  }

  async function submit() {
    if (!login.trim()) { setError("Введите имя"); return; }
    if (!email.trim()) { setError("Введите email"); return; }
    setError("");
    setStep("loading");
    try {
      const { data } = await api.post("/shop/order", {
        login: login.trim(),
        email: email.trim(),
        term: plan!.term,
      });
      setOrderId(data.order.id);

      if (data.order.status === "issued") {
        setStep("success");
        return;
      }

      // Try to create payment link
      try {
        const pay = await api.post("/shop/payment", {
          order_id: data.order.id,
          term: plan!.term,
          email: email.trim(),
        });
        setPayUrl(pay.data.pay_url);
        setStep("payment");
      } catch {
        setStep("success");
      }
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка создания заказа");
      setStep("form");
    }
  }

  return (
    <Modal
      open={!!plan}
      onClose={() => { onClose(); reset(); }}
      title={step === "form" ? `Подключение — ${plan?.label}` : undefined}
      size="sm"
    >
      {step === "form" && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Ваше имя</label>
            <input className="input" placeholder="Иван" value={login} onChange={e => setLogin(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Email</label>
            <input className="input" type="email" placeholder="ivan@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center justify-between pt-1">
            <span className="text-sm text-slate-300">
              Итого: <span className="text-white font-semibold">{plan?.price} ₽</span>
            </span>
            <button className="btn-primary" onClick={submit}>Оформить</button>
          </div>
        </div>
      )}

      {step === "loading" && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Spinner />
          <p className="text-sm text-slate-400">Создаём подключение...</p>
        </div>
      )}

      {step === "success" && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <CheckCircle2 size={48} className="text-green-400" />
          <div>
            <p className="text-white font-semibold mb-1">Готово!</p>
            <p className="text-sm text-slate-400">Конфигурация создана. Войдите в кабинет чтобы скачать файл подключения.</p>
          </div>
          <button
            className="btn-primary w-full"
            onClick={() => { onClose(); reset(); navigate("/cabinet"); }}
          >
            Открыть кабинет
          </button>
        </div>
      )}

      {step === "payment" && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-12 h-12 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center">
            <span className="text-xl">💳</span>
          </div>
          <div>
            <p className="text-white font-semibold mb-1">Оплата</p>
            <p className="text-sm text-slate-400">Заказ создан. Перейдите к оплате для активации подписки.</p>
          </div>
          <a href={payUrl} target="_blank" rel="noreferrer" className="btn-primary w-full">
            Оплатить {plan?.price} ₽
          </a>
          <button className="btn-ghost text-sm" onClick={() => { onClose(); reset(); navigate("/cabinet"); }}>
            Уже оплатил
          </button>
        </div>
      )}
    </Modal>
  );
}
