import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  leaving?: boolean;
}

interface ToastCtx {
  push: (kind: ToastKind, message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, message }]);
    // Start the leave animation, then remove.
    setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 250);
    }, 4000);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div key={t.id} className={`toast toast-${t.kind} ${t.leaving ? 'toast-leaving' : ''}`}>
              <Icon size={18} className="toast-icon" />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
