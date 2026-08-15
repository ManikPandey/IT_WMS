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
    <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', colors[status] || 'bg-gray-100 text-gray-800')}>
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

export const Button = ({ children, variant = 'primary', size = 'default', className, ...props }) => {
  const base = "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]";
  
  const sizes = {
    sm: "h-8 px-3 text-xs",
    default: "h-9 px-4 text-sm",
    lg: "h-11 px-8 text-base",
    icon: "h-9 w-9"
  };

  const variants = {
    primary: "bg-primary text-white shadow-sm hover:bg-primary/90 hover:shadow-md hover:-translate-y-0.5",
    secondary: "bg-surface text-text border border-border shadow-sm hover:bg-gray-50",
    outline: "border border-border bg-transparent text-text hover:bg-gray-50",
    ghost: "bg-transparent text-muted hover:text-text hover:bg-surface",
    danger: "bg-red-500 text-white shadow-sm hover:bg-red-600 hover:shadow-md hover:-translate-y-0.5"
  };

  return (
    <button className={cn(base, sizes[size], variants[variant], className)} {...props}>
      {children}
    </button>
  );
};

export const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm transition-opacity">
      <div className="bg-surface border border-border rounded-xl w-full max-w-lg p-6 shadow-2xl relative animate-in zoom-in-95 duration-200">
        <h2 className="text-xl font-semibold mb-4 text-gray-900">{title}</h2>
        {children}
        <button onClick={onClose} className="absolute top-4 right-4 text-muted hover:text-gray-900 transition-colors h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-gray-100">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
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

export const EmptyState = ({ icon: Icon, title, description, action }) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 max-w-sm mb-6">{description}</p>
      {action && action}
    </div>
  );
};

export const SkeletonRow = ({ columns }) => {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <div className="h-4 bg-gray-200 animate-pulse rounded w-3/4" />
        </td>
      ))}
    </tr>
  );
};
