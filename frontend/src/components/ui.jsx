import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const StatusBadge = ({ status }) => {
  const colors = {
    IN_STOCK: 'bg-success/10 text-success',
    DEPLOYED: 'bg-primary/10 text-primary',
    MAINTENANCE: 'bg-warning/10 text-warning',
    IN_TRANSIT: 'bg-purple-500/10 text-purple-500',
    SCRAPPED: 'bg-muted/10 text-muted',
    PENDING: 'bg-warning/10 text-warning',
    APPROVED: 'bg-success/10 text-success',
  };
  
  return (
    <span className={cn('px-2.5 py-1 text-xs font-medium rounded', colors[status] || 'bg-gray-100 text-gray-800')}>
      {status}
    </span>
  );
};

export const StatCard = ({ title, value, isLoading }) => {
  return (
    <div className="bg-background border border-border p-6 rounded-lg flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted">{title}</h3>
      {isLoading ? (
        <div className="h-8 bg-surface animate-pulse rounded w-16" />
      ) : (
        <p className="text-3xl font-mono font-medium text-text">{value}</p>
      )}
    </div>
  );
};

export const Button = ({ children, variant = 'primary', className, ...props }) => {
  const base = "inline-flex items-center justify-center rounded-md font-medium text-sm transition-colors h-9 px-4 disabled:opacity-50";
  const variants = {
    primary: "bg-primary text-white hover:bg-primary/90",
    secondary: "bg-surface text-text border border-border hover:bg-border/50",
    danger: "bg-red-500 text-white hover:bg-red-600"
  };
  return (
    <button className={cn(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
};

export const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-lg w-full max-w-md p-6 shadow-xl relative">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>
        {children}
        <button onClick={onClose} className="absolute top-4 right-4 text-muted hover:text-text">
          &times;
        </button>
      </div>
    </div>
  );
};

export const ToastContext = React.createContext(null);

export const ToastProvider = ({ children }) => {
  const [toast, setToast] = React.useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div className={cn(
          "fixed top-4 right-4 px-4 py-3 rounded-md shadow-lg font-medium text-sm z-[100] transition-all",
          toast.type === 'error' ? "bg-red-50 text-red-900 border border-red-200" : "bg-success/10 text-success border border-success/20"
        )}>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => React.useContext(ToastContext);
