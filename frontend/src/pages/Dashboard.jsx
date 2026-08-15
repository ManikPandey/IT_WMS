import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatCard, Button } from '../components/ui';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area } from 'recharts';
import { Activity, Plus, Upload, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const COLORS = ['#4F46E5', '#6366F1', '#818CF8', '#A5B4FC', '#C7D2FE'];

export default function Dashboard() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  const navigate = useNavigate();
  const [range, setRange] = useState('monthly'); // weekly, monthly, yearly

  const { data: invStats, isLoading: invLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/dashboard/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.json();
    },
    refetchInterval: 10000 // poll every 10s
  });

  const { data: procStats, isLoading: procLoading } = useQuery({
    queryKey: ['procurement-stats', range],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/procurement/stats?range=${range}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.json();
    }
  });

  const { data: maintStats } = useQuery({
    queryKey: ['maintenance-stats', range],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_INVENTORY_URL}/maintenance/stats?range=${range}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.json();
    }
  });

  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/system/health`);
      return res.json();
    },
    refetchInterval: 10000 // poll every 10s
  });

  const assetsByCategoryData = []; // Removed for CQRS lite

  const stockData = [
    { name: 'In Stock', value: invStats?.in_stock_assets || 0 },
    { name: 'Out of Stock', value: invStats?.out_of_stock_assets || 0 }
  ];

  const spendData = procStats?.spendOverTime 
    ? Object.keys(procStats.spendOverTime).map(period => ({
        period,
        spend: procStats.spendOverTime[period]
      }))
    : [];

  const maintCostData = Array.isArray(maintStats) ? maintStats.map(row => ({
    period: new Date(row.period).toISOString().slice(0, range === 'yearly' ? 4 : range === 'monthly' ? 7 : 10),
    cost: row.total_cost
  })) : [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Overview Dashboard</h1>
        {health && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-surface text-sm">
            <div className={`w-2 h-2 rounded-full ${health.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="font-medium">System {health.status === 'ok' ? 'Operational' : 'Degraded'}</span>
          </div>
        )}
      </div>

      {role === 'ADMIN' && (
        <div className="flex gap-4">
          <Button onClick={() => navigate('/inventory')} variant="outline" className="flex-1 justify-center"><Upload size={16} className="mr-2"/> Import Data</Button>
          <Button onClick={() => navigate('/purchase-orders')} variant="outline" className="flex-1 justify-center"><Plus size={16} className="mr-2"/> Create PO</Button>
          <Button onClick={() => navigate('/inventory')} variant="outline" className="flex-1 justify-center"><Activity size={16} className="mr-2"/> Report Issue</Button>
          <Button onClick={() => navigate('/settings')} variant="outline" className="flex-1 justify-center"><FileText size={16} className="mr-2"/> View Audit Logs</Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Assets" value={invStats?.total_assets || 0} isLoading={invLoading} />
        <StatCard title="Total Value (Spend)" value={`$${(Object.values(procStats?.spendOverTime || {}).reduce((a,b)=>a+b,0)).toFixed(2)}`} isLoading={procLoading} />
        <StatCard title="Open Maintenance" value={invStats?.active_issues || 0} isLoading={invLoading} />
        <StatCard title="System Health" value={health?.status === 'ok' ? 'Operational' : 'Degraded'} isLoading={!health} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Asset Distribution */}
  

        {/* Stock Availability */}
        <div className="bg-surface border border-border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Stock Availability</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stockData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {stockData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{borderRadius: '6px', border: '1px solid #e5e7eb'}} />
                <Legend iconType="circle" wrapperStyle={{fontSize: '12px'}} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Procurement Spend */}
        <div className="bg-surface border border-border rounded-xl p-6 shadow-sm lg:col-span-2">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-semibold text-gray-800">Financial Trends</h2>
            <div className="flex border border-border rounded-lg p-1 bg-gray-50">
              {['weekly', 'monthly', 'yearly'].map(r => (
                <button 
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-4 py-1.5 text-xs font-semibold capitalize rounded-md transition-all ${range === r ? 'bg-white text-gray-900 shadow-sm' : 'text-muted hover:text-gray-900'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="h-64 w-full">
              <h3 className="text-sm text-muted mb-2 text-center">Procurement Spend</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="period" tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{stroke: '#e5e7eb', strokeWidth: 2}} contentStyle={{borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Line type="monotone" dataKey="spend" stroke="#4F46E5" strokeWidth={3} dot={{r: 4, fill: '#4F46E5'}} activeDot={{r: 6}} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            
            <div className="h-64 w-full">
              <h3 className="text-sm text-muted mb-2 text-center">Maintenance Cost</h3>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={maintCostData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="period" tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{stroke: '#e5e7eb', strokeWidth: 2}} contentStyle={{borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Area type="monotone" dataKey="cost" stroke="#818CF8" fill="#C7D2FE" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
