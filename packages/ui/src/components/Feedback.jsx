import { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import Modal from "./Modal";
export default function Feedback() {
  const [toasts, setToasts] = useState([]),
    [question, setQuestion] = useState(null);
  const pending = useRef(null);
  useEffect(() => {
    const notice = (e) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [
        ...prev.slice(-2),
        { id, ...e.detail, expiresAt: Date.now() + 7000 },
      ]);
    };
    const confirm = (e) => {
      pending.current?.resolve(false);
      pending.current = e.detail;
      setQuestion(e.detail);
    };
    window.addEventListener("invent:notice", notice);
    window.addEventListener("invent:confirm", confirm);
    return () => {
      window.removeEventListener("invent:notice", notice);
      window.removeEventListener("invent:confirm", confirm);
      pending.current?.resolve(false);
    };
  }, []);
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.expiresAt > Date.now())),
      Math.max(0, Math.min(...toasts.map((t) => t.expiresAt)) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [toasts]);
  const answer = (value) => {
    pending.current?.resolve(value);
    pending.current = null;
    setQuestion(null);
  };
  return (
    <>
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pro-toast ${t.kind}`}
            role={t.kind === "error" ? "alert" : "status"}
          >
            {t.kind === "error" ? (
              <AlertCircle size={20} />
            ) : (
              <CheckCircle2 size={20} />
            )}
            <span>{t.message}</span>
            <button
              className="icon-button"
              aria-label="Fechar mensagem"
              onClick={() =>
                setToasts((prev) => prev.filter((v) => v.id !== t.id))
              }
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
      {question && (
        <Modal title={question.title} onClose={() => answer(false)}>
          <p className="dialog-description">{question.description}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => answer(false)}
              autoFocus
            >
              Cancelar
            </button>
            <button
              type="button"
              className={question.danger ? "danger-button" : "primary-button"}
              onClick={() => answer(true)}
            >
              {question.confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
