import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge, Button, Modal, useToast } from '../components/ui';

export default function PurchaseOrders() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ vendor: 'Apple', budget: 2000 });

  const { data: pos, isLoading } = useQuery({
    queryKey: ['pos'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3000/purchase-orders', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.json();
    }
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch('http://localhost:3000/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Creation failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['pos']);
      showToast('Purchase Order created');
      setIsCreateOpen(false);
    }
  });

  const approveMutation = useMutation({
    mutationFn: async (id) => {
      // Generate client-side Idempotency Key
      const idemKey = crypto.randomUUID(); 
      const res = await fetch(`http://localhost:3000/purchase-orders/${id}/approve`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': idemKey
        },
        body: JSON.stringify({ comments: 'Approved via UI', finalBudget: 2000 })
      });
      if (!res.ok) {
        if (res.status === 409) throw new Error('Duplicate request conflict');
        if (res.status === 403) throw new Error('Forbidden: ADMIN role required');
        throw new Error('Approval failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['pos']);
      showToast('Purchase Order approved');
    },
    onError: (err) => {
      showToast(err.message, 'error');
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Purchase Orders</h1>
        <Button onClick={() => setIsCreateOpen(true)}>Create PO</Button>
      </div>

      <div className="bg-background border border-border rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm text-text">
          <thead className="bg-surface border-b border-border text-muted">
            <tr>
              <th className="px-6 py-4 font-medium">PO ID</th>
              <th className="px-6 py-4 font-medium">Vendor</th>
              <th className="px-6 py-4 font-medium">Budget</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="5" className="px-6 py-8 text-center text-muted">Loading...</td></tr>
            ) : pos?.length === 0 ? (
              <tr><td colSpan="5" className="px-6 py-8 text-center text-muted">No POs found.</td></tr>
            ) : (
              pos?.map(po => (
                <tr key={po.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-6 py-4 font-mono">PO-{po.id}</td>
                  <td className="px-6 py-4">{po.vendor}</td>
                  <td className="px-6 py-4 font-mono">${po.budget}</td>
                  <td className="px-6 py-4"><StatusBadge status={po.status} /></td>
                  <td className="px-6 py-4">
                    {po.status === 'PENDING' && role === 'ADMIN' && (
                      <Button 
                        variant="secondary" 
                        className="h-8 text-xs px-3"
                        onClick={() => approveMutation.mutate(po.id)}
                        disabled={approveMutation.isPending}
                      >
                        Approve
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create Purchase Order">
        <form onSubmit={e => { e.preventDefault(); createMutation.mutate(createForm); }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Vendor</label>
            <input 
              type="text" 
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary"
              value={createForm.vendor}
              onChange={e => setCreateForm({...createForm, vendor: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Budget ($)</label>
            <input 
              type="number" 
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary"
              value={createForm.budget}
              onChange={e => setCreateForm({...createForm, budget: parseFloat(e.target.value)})}
            />
          </div>
          <Button type="submit" className="w-full" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Submit'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
