import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatCard } from '../components/ui';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { Activity } from 'lucide-react';

const COLORS = ['#6366f1', '#a5b4fc', '#4338ca', '#3730a3', '#818cf8'];

export default function Dashboard() {
  const token = localStorage.getItem('token');

  const { data: invStats, isLoading: invLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3001/dashboard/stats');
      return res.json();
    }
  });

  const { data: procStats, isLoading: procLoading } = useQuery({
    queryKey: ['procurement-stats'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3000/procurement/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.json();
    }
  });

  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3000/system/health');
      return res.json();
    },
    refetchInterval: 10000 // poll every 10s
  });

  const assetsByCategoryData = invStats?.assetsByCategory?.map(item => ({
    name: item.category_id ? `Category ${item.category_id}` : 'Uncategorized',
    count: item._count._all
  })) || [];

  const stockData = [
    { name: 'In Stock', value: invStats?.inStock || 0 },
    { name: 'Out of Stock', value: invStats?.outOfStock || 0 }
  ];

  const spendData = procStats?.spendOverTime 
    ? Object.keys(procStats.spendOverTime).map(month => ({
        month,
        spend: procStats.spendOverTime[month]
      }))
    : [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Overview Dashboard</h1>
        {health && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-surface text-sm">
            <div className={`w-2 h-2 rounded-full ${health.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="font-medium">System {health.status === 'ok' ? 'Operational' : 'Degraded'}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Assets" value={invStats?.totalAssets || 0} isLoading={invLoading} />
        <StatCard title="Active Issues" value={invStats?.openMaintenance || 0} isLoading={invLoading} />
        <StatCard title="Total Maint. Cost" value={`$${(invStats?.totalMaintenanceCost || 0).toFixed(2)}`} isLoading={invLoading} />
        <StatCard title="Total Spend" value={`$${spendData.reduce((a, b) => a + b.spend, 0).toFixed(2)}`} isLoading={procLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Asset Distribution */}
        <div className="bg-background border border-border rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Asset Distribution (By Category)</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={assetsByCategoryData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
                <YAxis tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
                <Tooltip cursor={{fill: '#f3f4f6'}} contentStyle={{borderRadius: '6px', border: '1px solid #e5e7eb'}} />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Stock Availability */}
        <div className="bg-background border border-border rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Stock Availability</h2>
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
        <div className="bg-background border border-border rounded-lg p-6 lg:col-span-2">
          <h2 className="text-lg font-medium mb-4">Procurement Spend</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
                <YAxis tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
                <Tooltip cursor={{stroke: '#e5e7eb', strokeWidth: 2}} contentStyle={{borderRadius: '6px', border: '1px solid #e5e7eb'}} />
                <Line type="monotone" dataKey="spend" stroke="#4338ca" strokeWidth={2} dot={{r: 4, fill: '#4338ca'}} activeDot={{r: 6}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
