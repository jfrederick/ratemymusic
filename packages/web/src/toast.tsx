import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastKind = "info" | "success" | "error";
export type Toast = { id: number; kind: ToastKind; message: string };

type ToastContextValue = {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toasts, push, dismiss }}>
      {children}
      <output className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            <span>{t.message}</span>
            <button
              type="button"
              className="toast__close"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </output>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
