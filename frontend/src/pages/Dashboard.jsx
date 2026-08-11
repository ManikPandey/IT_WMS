import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatCard } from '../components/ui';

export default function Dashboard() {
  const token = localStorage.getItem('token');

  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3001/assets');
      return res.json();
    }
  });

  const { data: pos, isLoading: posLoading } = useQuery({
    queryKey: ['pos'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3000/purchase-orders', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.json();
    }
  });

  const totalAssets = assets?.length || 0;
  const inStock = assets?.filter(a => a.status === 'IN_STOCK').length || 0;
  const deployed = assets?.filter(a => a.status === 'DEPLOYED').length || 0;
  const pendingPOs = pos?.filter(p => p.status === 'PENDING').length || 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Overview Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Assets" value={totalAssets} isLoading={assetsLoading} />
        <StatCard title="In Stock" value={inStock} isLoading={assetsLoading} />
        <StatCard title="Deployed" value={deployed} isLoading={assetsLoading} />
        <StatCard title="Pending POs" value={pendingPOs} isLoading={posLoading} />
      </div>
    </div>
  );
}
