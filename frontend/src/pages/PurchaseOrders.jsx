import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge, Button, Modal, useToast } from '../components/ui';
import { X } from 'lucide-react';

export default function PurchaseOrders() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ 
    vendor: '', 
    budget: 0,
    request_date: new Date().toISOString().split('T')[0],
    gstin: '',
    department: '',
    billing_address: '',
    delivery_address: ''
  });
  const [attributes, setAttributes] = useState([]);

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
      const custom_attributes = attributes.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {});
      
      const res = await fetch('http://localhost:3000/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...data, custom_attributes: Object.keys(custom_attributes).length > 0 ? custom_attributes : undefined })
      });
      if (!res.ok) throw new Error('Creation failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['pos']);
      showToast('Purchase Order created');
      setIsCreateOpen(false);
      setAttributes([]);
      setCreateForm({ vendor: '', budget: 0, request_date: new Date().toISOString().split('T')[0], gstin: '', department: '', billing_address: '', delivery_address: '' });
    }
  });

  const approveMutation = useMutation({
    mutationFn: async (id) => {
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
              <th className="px-6 py-4 font-medium">Department</th>
              <th className="px-6 py-4 font-medium">Budget</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="6" className="px-6 py-8 text-center text-muted">Loading...</td></tr>
            ) : pos?.length === 0 ? (
              <tr><td colSpan="6" className="px-6 py-8 text-center text-muted">No POs found.</td></tr>
            ) : (
              pos?.map(po => (
                <tr key={po.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-6 py-4 font-mono">PO-{po.id}</td>
                  <td className="px-6 py-4">{po.vendor}</td>
                  <td className="px-6 py-4">{po.department || '-'}</td>
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
        <form onSubmit={e => { e.preventDefault(); createMutation.mutate(createForm); }} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text mb-1">Vendor</label>
              <input required type="text" className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" value={createForm.vendor} onChange={e => setCreateForm({...createForm, vendor: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">Budget ($)</label>
              <input required type="number" className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" value={createForm.budget} onChange={e => setCreateForm({...createForm, budget: parseFloat(e.target.value)})} />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text mb-1">Request Date</label>
              <input required type="date" className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" value={createForm.request_date} onChange={e => setCreateForm({...createForm, request_date: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">Department</label>
              <input type="text" className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" value={createForm.department} onChange={e => setCreateForm({...createForm, department: e.target.value})} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">GSTIN</label>
            <input type="text" className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" value={createForm.gstin} onChange={e => setCreateForm({...createForm, gstin: e.target.value})} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text mb-1">Billing Address</label>
              <textarea className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" rows="2" value={createForm.billing_address} onChange={e => setCreateForm({...createForm, billing_address: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">Delivery Address</label>
              <textarea className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" rows="2" value={createForm.delivery_address} onChange={e => setCreateForm({...createForm, delivery_address: e.target.value})} />
            </div>
          </div>

          {/* Dynamic Attributes */}
          <div>
            <label className="block text-sm font-medium text-text mb-2">Additional Attributes</label>
            <div className="space-y-2 mb-2">
              {attributes.map((attr, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" placeholder="Key" className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm" value={attr.key} onChange={e => { const newA = [...attributes]; newA[i].key = e.target.value; setAttributes(newA); }} />
                  <input type="text" placeholder="Value" className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm" value={attr.value} onChange={e => { const newA = [...attributes]; newA[i].value = e.target.value; setAttributes(newA); }} />
                  <button type="button" onClick={() => setAttributes(attributes.filter((_, idx) => idx !== i))} className="text-red-500 p-1"><X size={16} /></button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setAttributes([...attributes, {key: '', value: ''}])}>+ Add Field</Button>
          </div>

          <Button type="submit" className="w-full" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Submit'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
