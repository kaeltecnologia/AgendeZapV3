import React, { useEffect, useState } from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

const icons = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
};

const colors = {
  success: 'border-green-500 bg-green-50 text-green-800',
  error:   'border-red-500 bg-red-50 text-red-800',
  info:    'border-orange-500 bg-orange-50 text-orange-800',
};

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 3200);
    const t2 = setTimeout(() => onRemove(toast.id), 3500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [toast.id, onRemove]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-2xl border-l-4 shadow-xl text-sm font-bold max-w-xs w-full
        ${colors[toast.type]}
        ${leaving ? 'animate-toastOut' : 'animate-toastIn'}`}
    >
      <span className="text-base flex-shrink-0">{icons[toast.type]}</span>
      <span className="flex-1 text-[11px] uppercase tracking-wide">{toast.message}</span>
      <button
        onClick={() => { setLeaving(true); setTimeout(() => onRemove(toast.id), 300); }}
        className="text-current opacity-50 hover:opacity-100 font-black text-xs ml-1"
      >✕</button>
    </div>
  );
};

const Toast: React.FC<ToastProps> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[9998] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
};

export default Toast;
