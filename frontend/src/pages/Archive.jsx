import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '../components/ui';

export default function Archive() {
  const { data: assets, isLoading } = useQuery({
    queryKey: ['retired-assets'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3001/assets?status=RETIRED');
      return res.json();
    }
  });

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Retired Assets Archive</h1>
      </div>

      <div className="bg-background border border-border rounded-lg overflow-hidden flex-1 flex flex-col">
        <table className="w-full text-left text-sm text-text">
          <thead className="bg-surface border-b border-border text-muted">
            <tr>
              <th className="px-6 py-4 font-medium">Asset Tag</th>
              <th className="px-6 py-4 font-medium">Serial Number</th>
              <th className="px-6 py-4 font-medium">Type</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Archived Date</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="5" className="px-6 py-8 text-center text-muted">Loading...</td></tr>
            ) : !Array.isArray(assets) || assets.length === 0 ? (
              <tr><td colSpan="5" className="px-6 py-8 text-center text-muted">No retired assets found.</td></tr>
            ) : (
              assets.map(asset => (
                <tr key={asset.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-6 py-4 font-mono">{asset.asset_tag}</td>
                  <td className="px-6 py-4 font-mono">{asset.serial_number || '-'}</td>
                  <td className="px-6 py-4">{asset.type}</td>
                  <td className="px-6 py-4"><StatusBadge status={asset.status} /></td>
                  <td className="px-6 py-4">{new Date(asset.updated_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
