import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LayoutDashboard, Package, FileText, Activity, LogOut, Archive as ArchiveIcon } from 'lucide-react';
import React, { useState, useEffect } from 'react';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import PurchaseOrders from './pages/PurchaseOrders';
import Maintenance from './pages/Maintenance';
import Settings from './pages/Settings';
import Archive from './pages/Archive';
import { ToastProvider } from './components/ui';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } }
});

const ProtectedRoute = ({ children, allowedRoles }) => {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  if (!token) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(role)) {
    // If not allowed, redirect to their home based on role
    if (role === 'MAINTENANCE_CREW') return <Navigate to="/maintenance" replace />;
    return <Navigate to="/" replace />;
  }
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
  const name = localStorage.getItem('name') || 'User';

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('name');
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
          {role !== 'MAINTENANCE_CREW' && (
            <>
              <SidebarItem to="/" icon={LayoutDashboard} label="Dashboard" />
              <SidebarItem to="/inventory" icon={Package} label="Inventory" />
              <SidebarItem to="/purchase-orders" icon={FileText} label="Purchase Orders" />
              <SidebarItem to="/archive" icon={ArchiveIcon} label="Retired Assets" />
            </>
          )}
          {(role === 'ADMIN' || role === 'MAINTENANCE_CREW') && (
            <SidebarItem to="/maintenance" icon={Activity} label="Maintenance" />
          )}
        </nav>
        
        {/* Settings at the bottom */}
        {role === 'ADMIN' && (
          <div className="px-4 pb-4">
            <SidebarItem to="/settings" icon={Activity} label="Settings" />
          </div>
        )}

        <div className="p-4 border-t border-border flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text">{name}</span>
            <span className="text-xs text-muted">{role}</span>
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
          <Route path="/" element={<ProtectedRoute allowedRoles={['ADMIN', 'VIEWER']}><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute allowedRoles={['ADMIN', 'VIEWER']}><Layout><Inventory /></Layout></ProtectedRoute>} />
          <Route path="/purchase-orders" element={<ProtectedRoute allowedRoles={['ADMIN', 'VIEWER']}><Layout><PurchaseOrders /></Layout></ProtectedRoute>} />
          <Route path="/archive" element={<ProtectedRoute allowedRoles={['ADMIN', 'VIEWER']}><Layout><Archive /></Layout></ProtectedRoute>} />
          <Route path="/maintenance" element={<ProtectedRoute allowedRoles={['ADMIN', 'MAINTENANCE_CREW']}><Layout><Maintenance /></Layout></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute allowedRoles={['ADMIN']}><Layout><Settings /></Layout></ProtectedRoute>} />
        </Routes>
      </Router>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
