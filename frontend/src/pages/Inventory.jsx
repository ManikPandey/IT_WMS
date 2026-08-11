import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge, Button, Modal, useToast } from '../components/ui';

export default function Inventory() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [isAllocateOpen, setIsAllocateOpen] = useState(false);
  const [allocateForm, setAllocateForm] = useState({ assetType: 'LAPTOP', assignedTo: 1, warehouseId: 1 });

  const { data: assets, isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3001/assets');
      return res.json();
    }
  });

  const allocateMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch('http://localhost:3001/allocate?strategy=redis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Allocation failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['assets']);
      showToast('Asset allocated successfully');
      setIsAllocateOpen(false);
    },
    onError: (err) => {
      showToast(err.message, 'error');
    }
  });

  const handleAllocate = (e) => {
    e.preventDefault();
    allocateMutation.mutate(allocateForm);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Asset Inventory</h1>
        <Button onClick={() => setIsAllocateOpen(true)}>Allocate Asset</Button>
      </div>

      <div className="bg-background border border-border rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm text-text">
          <thead className="bg-surface border-b border-border text-muted">
            <tr>
              <th className="px-6 py-4 font-medium">Asset Tag</th>
              <th className="px-6 py-4 font-medium">Type</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Assigned To</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="px-6 py-4"><div className="h-4 bg-surface animate-pulse rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 bg-surface animate-pulse rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 bg-surface animate-pulse rounded" /></td>
                  <td className="px-6 py-4"><div className="h-4 bg-surface animate-pulse rounded" /></td>
                </tr>
              ))
            ) : assets?.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-6 py-8 text-center text-muted">No assets found.</td>
              </tr>
            ) : (
              assets?.map(asset => (
                <tr key={asset.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-6 py-4 font-mono">{asset.asset_tag}</td>
                  <td className="px-6 py-4">{asset.type}</td>
                  <td className="px-6 py-4"><StatusBadge status={asset.status} /></td>
                  <td className="px-6 py-4">{asset.assigned_to || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isAllocateOpen} onClose={() => setIsAllocateOpen(false)} title="Allocate Asset">
        <form onSubmit={handleAllocate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Asset Type</label>
            <input 
              type="text" 
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary"
              value={allocateForm.assetType}
              onChange={e => setAllocateForm({...allocateForm, assetType: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Assign To (User ID)</label>
            <input 
              type="number" 
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary"
              value={allocateForm.assignedTo}
              onChange={e => setAllocateForm({...allocateForm, assignedTo: parseInt(e.target.value)})}
            />
          </div>
          <Button type="submit" className="w-full" disabled={allocateMutation.isPending}>
            {allocateMutation.isPending ? 'Allocating...' : 'Allocate'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
