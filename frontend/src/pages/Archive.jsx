import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusBadge, EmptyState, SkeletonRow } from '../components/ui';
import { Archive as ArchiveIcon } from 'lucide-react';

export default function Archive() {
  const { data: assets, isLoading } = useQuery({
    queryKey: ['retired-assets'],
    queryFn: async () => {
      const res = await fetch('http://localhost:4000/assets?status=RETIRED');
      return res.json();
    }
  });

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Retired Assets Archive</h1>
      </div>

      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col relative">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-sm text-text">
            <thead className="bg-gray-50 border-b border-border text-gray-700 sticky top-0 z-10">
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
              <>
                <SkeletonRow columns={5} />
                <SkeletonRow columns={5} />
                <SkeletonRow columns={5} />
              </>
            ) : !Array.isArray(assets) || assets.length === 0 ? (
              <tr>
                <td colSpan="5">
                  <EmptyState icon={ArchiveIcon} title="No retired assets" description="There are no retired assets in the archive." />
                </td>
              </tr>
            ) : (
              assets.map(asset => (
                <tr key={asset.id} className="border-b border-border last:border-0 hover:bg-gray-50 transition-colors group">
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
    </div>
  );
}
