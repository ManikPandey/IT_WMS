import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LayoutDashboard, Package, FileText, Activity, LogOut, Archive as ArchiveIcon, Sun, Moon, Zap } from 'lucide-react';
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
import ConcurrencyDemo from './pages/ConcurrencyDemo';
import { ToastProvider } from './components/ui';
import { fetchWithAuth } from './utils/api';
import { useTheme } from './components/ThemeProvider';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } }
});

const SidebarItem = ({ icon: Icon, label, to, isCollapsed }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative
        ${isActive 
          ? 'bg-primary/10 text-primary font-medium' 
          : 'text-muted hover:bg-background hover:text-text  '
        }
      `}
      title={isCollapsed ? label : undefined}
    >
      <Icon size={20} className={`flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted group-hover:text-text dark:group-hover:text-slate-100'}`} />
      {!isCollapsed && <span className="truncate">{label}</span>}
      {isCollapsed && isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
      )}
    </Link>
  );
};

const ProtectedRoute = ({ children, allowedRoles }) => {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  if (!token) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(role)) {
    if (role === 'MAINTENANCE_CREW') return <Navigate to="/maintenance" replace />;
    return <Navigate to="/" replace />;
  }
  return children;
};

const Layout = ({ children }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const role = localStorage.getItem('role');
  const name = localStorage.getItem('name');
  const { theme, setTheme } = useTheme();

  const handleLogout = async () => {
    try {
      await fetchWithAuth(`${import.meta.env.VITE_API_URL}/auth/logout`, { method: 'POST' });
    } catch(e) {}
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('role');
    localStorage.removeItem('name');
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-background  transition-colors">
      {/* Sidebar */}
      <aside className={`bg-surface  border-r border-border  flex flex-col transition-all duration-300 ease-in-out z-20 shadow-sm ${isCollapsed ? 'w-20' : 'w-64'}`}>
        <div className="p-4 flex items-center justify-between">
          {!isCollapsed && <h1 className="text-xl font-bold tracking-tight text-text  truncate">IT_WMS</h1>}
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="p-2 rounded-md text-muted hover:bg-background  hover:text-text  transition-colors flex-shrink-0 mx-auto">
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
          <div className="px-3 pb-2 mt-auto space-y-1">
            <SidebarItem to="/concurrency-demo" icon={Zap} label="Concurrency Demo" isCollapsed={isCollapsed} />
            <SidebarItem to="/settings" icon={Activity} label="Settings" isCollapsed={isCollapsed} />
          </div>
        )}

        <div className={`p-4 border-t border-border  flex items-center ${isCollapsed ? 'justify-center flex-col gap-2' : 'justify-between'} transition-all`}>
          {!isCollapsed && (
            <div className="flex flex-col truncate pr-2">
              <span className="text-sm font-semibold text-text  truncate">{name}</span>
              <span className="text-xs text-muted truncate">{role}</span>
            </div>
          )}
          
          <div className="flex gap-1">
            <button 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              className="text-muted hover:text-primary dark:hover:text-primary transition-colors p-2 rounded-lg hover:bg-background  flex-shrink-0" 
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button onClick={handleLogout} className="text-muted hover:text-red-600 transition-colors p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 flex-shrink-0" title="Logout">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background  relative transition-colors">
        <div className="max-w-[1400px] mx-auto p-8 animate-in fade-in duration-300 text-text ">
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
          <Route path="/concurrency-demo" element={<ProtectedRoute allowedRoles={['ADMIN']}><Layout><ConcurrencyDemo /></Layout></ProtectedRoute>} />
        </Routes>
      </Router>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
