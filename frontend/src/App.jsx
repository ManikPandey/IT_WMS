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
import AssetRequests from './pages/AssetRequests';
import Archive from './pages/Archive';
import { ToastProvider } from './components/ui';
import { fetchWithAuth } from './utils/api';

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

const SidebarItem = ({ to, icon: Icon, label, isCollapsed }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link 
      to={to} 
      className={`group flex items-center ${isCollapsed ? 'justify-center' : 'justify-start'} gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 relative ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted hover:bg-surface hover:text-gray-900'}`}
      title={isCollapsed ? label : undefined}
    >
      {isActive && !isCollapsed && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
      )}
      <Icon size={20} className={`flex-shrink-0 transition-transform duration-200 ${isActive ? 'text-primary' : 'group-hover:scale-110'}`} />
      {!isCollapsed && <span className="truncate">{label}</span>}
    </Link>
  );
};

const Layout = ({ children }) => {
  const navigate = useNavigate();
  const role = localStorage.getItem('role') || 'VIEWER';
  const name = localStorage.getItem('name') || 'User';
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleLogout = async () => {
    try {
      await fetchWithAuth('http://localhost:3000/auth/logout', { method: 'POST' });
    } catch(e) {}
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('role');
    localStorage.removeItem('name');
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={`bg-white border-r border-border flex flex-col transition-all duration-300 ease-in-out z-20 shadow-sm ${isCollapsed ? 'w-20' : 'w-64'}`}>
        <div className="p-4 flex items-center justify-between">
          {!isCollapsed && <h1 className="text-xl font-bold tracking-tight text-gray-900 truncate">IT_WMS</h1>}
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="p-2 rounded-md text-muted hover:bg-gray-100 hover:text-gray-900 transition-colors flex-shrink-0 mx-auto">
            <LayoutDashboard size={20} />
          </button>
        </div>
        
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto overflow-x-hidden mt-4">
          {role === 'EMPLOYEE' && (
            <SidebarItem to="/asset-requests" icon={FileText} label="My Requests" isCollapsed={isCollapsed} />
          )}
          {(role === 'ADMIN' || role === 'VIEWER') && (
            <>
              <SidebarItem to="/" icon={LayoutDashboard} label="Dashboard" isCollapsed={isCollapsed} />
              <SidebarItem to="/inventory" icon={Package} label="Inventory" isCollapsed={isCollapsed} />
              <SidebarItem to="/purchase-orders" icon={FileText} label="Purchase Orders" isCollapsed={isCollapsed} />
              <SidebarItem to="/asset-requests" icon={FileText} label="Asset Requests" isCollapsed={isCollapsed} />
              <SidebarItem to="/archive" icon={ArchiveIcon} label="Retired Assets" isCollapsed={isCollapsed} />
            </>
          )}
          {(role === 'ADMIN' || role === 'MAINTENANCE_CREW') && (
            <SidebarItem to="/maintenance" icon={Activity} label="Maintenance" isCollapsed={isCollapsed} />
          )}
        </nav>
        
        {/* Settings at the bottom */}
        {role === 'ADMIN' && (
          <div className="px-3 pb-2 mt-auto">
            <SidebarItem to="/settings" icon={Activity} label="Settings" isCollapsed={isCollapsed} />
          </div>
        )}

        <div className={`p-4 border-t border-border flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} transition-all`}>
          {!isCollapsed && (
            <div className="flex flex-col truncate pr-2">
              <span className="text-sm font-semibold text-gray-900 truncate">{name}</span>
              <span className="text-xs text-muted truncate">{role}</span>
            </div>
          )}
          <button onClick={handleLogout} className="text-muted hover:text-red-600 transition-colors p-2 rounded-lg hover:bg-red-50 flex-shrink-0" title="Logout">
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        <div className="max-w-[1400px] mx-auto p-8 animate-in fade-in duration-300">
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
          <Route path="/asset-requests" element={<ProtectedRoute allowedRoles={['ADMIN', 'VIEWER', 'EMPLOYEE']}><Layout><AssetRequests /></Layout></ProtectedRoute>} />
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
