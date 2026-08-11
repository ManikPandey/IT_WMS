import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LayoutDashboard, Package, FileText, Activity, LogOut } from 'lucide-react';
import React, { useState, useEffect } from 'react';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import PurchaseOrders from './pages/PurchaseOrders';
import AuditLog from './pages/AuditLog';
import { ToastProvider } from './components/ui';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } }
});

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
};

const SidebarItem = ({ to, icon: Icon, label }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link to={to} className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted hover:bg-surface hover:text-text'}`}>
      <Icon size={18} />
      <span>{label}</span>
    </Link>
  );
};

const Layout = ({ children }) => {
  const navigate = useNavigate();
  const role = localStorage.getItem('role') || 'VIEWER';

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-surface">
      {/* Sidebar */}
      <aside className="w-64 bg-background border-r border-border flex flex-col">
        <div className="p-6">
          <h1 className="text-xl font-bold tracking-tight text-text">IT_WMS</h1>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          <SidebarItem to="/" icon={LayoutDashboard} label="Dashboard" />
          <SidebarItem to="/inventory" icon={Package} label="Inventory" />
          <SidebarItem to="/purchase-orders" icon={FileText} label="Purchase Orders" />
          <SidebarItem to="/audit-log" icon={Activity} label="Audit Log" />
        </nav>
        <div className="p-4 border-t border-border flex items-center justify-between">
          <div className="text-sm font-medium px-2 py-1 bg-surface border border-border rounded-md text-text">
            {role}
          </div>
          <button onClick={handleLogout} className="text-muted hover:text-text transition-colors p-2" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background">
        <div className="max-w-[1200px] mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Router>
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute><Layout><Inventory /></Layout></ProtectedRoute>} />
          <Route path="/purchase-orders" element={<ProtectedRoute><Layout><PurchaseOrders /></Layout></ProtectedRoute>} />
          <Route path="/audit-log" element={<ProtectedRoute><Layout><AuditLog /></Layout></ProtectedRoute>} />
        </Routes>
      </Router>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
