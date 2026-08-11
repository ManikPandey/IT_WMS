import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge, Button, Modal, useToast } from '../components/ui';
import { X, Search, ArrowUpDown } from 'lucide-react';

export default function PurchaseOrders() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ 
    vendor: '', budget: 0, request_date: new Date().toISOString().split('T')[0], gstin: '', department: '', billing_address: '', delivery_address: '', receiving_office: ''
  });
  const [attributes, setAttributes] = useState([]);
  
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState(null);
  const [allPos, setAllPos] = useState([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [sort, setSort] = useState('newest'); // newest, oldest

  const { data, isLoading } = useQuery({
    queryKey: ['pos', sort, search, cursor],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('sort', sort);
      if (search) params.append('search', search);
      if (cursor) params.append('cursor', cursor);
      
      const res = await fetch(`http://localhost:3000/purchase-orders?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.json();
    }
  });

  React.useEffect(() => {
    if (data?.data) {
      if (cursor) setAllPos(prev => [...prev, ...data.data]);
      else setAllPos(data.data);
      setHasNextPage(!!data.nextCursor);
    }
  }, [data, cursor]);

  const pos = allPos;

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const custom_attributes = attributes.reduce((acc, curr) => { acc[curr.key] = curr.value; return acc; }, {});
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
      setCreateForm({ vendor: '', budget: 0, request_date: new Date().toISOString().split('T')[0], gstin: '', department: '', billing_address: '', delivery_address: '', receiving_office: '' });
    }
  });

  const approveMutation = useMutation({
    mutationFn: async (id) => {
      const idemKey = `idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`; 
      const res = await fetch(`http://localhost:3000/purchase-orders/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Idempotency-Key': idemKey },
        body: JSON.stringify({ comments: 'Approved via UI', finalBudget: 2000 })
      });
      if (!res.ok) throw new Error(res.status === 409 ? 'Duplicate request conflict' : 'Approval failed');
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries(['pos']); showToast('PO approved'); },
    onError: (err) => showToast(err.message, 'error')
  });

  const rejectMutation = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`http://localhost:3000/purchase-orders/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Rejection failed');
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries(['pos']); showToast('PO rejected & assets reverted'); },
    onError: (err) => showToast(err.message, 'error')
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Purchase Orders</h1>
        {role === 'ADMIN' && <Button onClick={() => setIsCreateOpen(true)}>Create PO</Button>}
      </div>

      <div className="flex justify-between items-center">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input 
            type="text" 
            placeholder="Search vendor, dept..."
            className="border border-border rounded-md pl-9 pr-3 py-2 text-sm w-64 focus:border-primary"
            value={search}
            onChange={e => { setCursor(null); setSearch(e.target.value); }}
          />
        </div>
        <Button variant="outline" onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}>
          <ArrowUpDown size={16} className="mr-2" />
          {sort === 'newest' ? 'Newest First' : 'Oldest First'}
        </Button>
      </div>

      <div className="bg-background border border-border rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm text-text">
          <thead className="bg-surface border-b border-border text-muted">
            <tr>
              <th className="px-6 py-4 font-medium">PO ID</th>
              <th className="px-6 py-4 font-medium">Vendor</th>
              <th className="px-6 py-4 font-medium">Department</th>
              <th className="px-6 py-4 font-medium">Receiving Office</th>
              <th className="px-6 py-4 font-medium">Budget</th>
              <th className="px-6 py-4 font-medium">Status</th>
              {role === 'ADMIN' && <th className="px-6 py-4 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={role === 'ADMIN' ? 7 : 6} className="px-6 py-8 text-center text-muted">Loading...</td></tr>
            ) : !Array.isArray(pos) || pos.length === 0 ? (
              <tr><td colSpan={role === 'ADMIN' ? 7 : 6} className="px-6 py-8 text-center text-muted">No POs found.</td></tr>
            ) : (
              pos.map(po => (
                <tr key={po.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-6 py-4 font-mono">PO-{po.id}</td>
                  <td className="px-6 py-4">{po.vendor}</td>
                  <td className="px-6 py-4">{po.department || '-'}</td>
                  <td className="px-6 py-4">{po.receiving_office || '-'}</td>
                  <td className="px-6 py-4 font-mono">${po.budget}</td>
                  <td className="px-6 py-4"><StatusBadge status={po.status} /></td>
                  {role === 'ADMIN' && (
                    <td className="px-6 py-4 text-right space-x-2">
                      {po.status === 'PENDING' && (
                        <Button variant="secondary" className="h-8 text-xs px-3" onClick={() => approveMutation.mutate(po.id)}>Approve</Button>
                      )}
                      {po.status !== 'REJECTED' && (
                        <Button variant="outline" className="h-8 text-xs px-3 text-red-500 hover:bg-red-50" onClick={() => rejectMutation.mutate(po.id)}>Reject</Button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
        
        {hasNextPage && (
          <div className="p-4 border-t border-border flex justify-center bg-surface/50">
            <Button variant="secondary" onClick={() => setCursor(data.nextCursor)}>Load More</Button>
          </div>
        )}
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create Purchase Order">
        <form onSubmit={e => { e.preventDefault(); createMutation.mutate(createForm); }} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm mb-1">Vendor</label><input required className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.vendor} onChange={e => setCreateForm({...createForm, vendor: e.target.value})} /></div>
            <div><label className="block text-sm mb-1">Budget ($)</label><input required type="number" className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.budget} onChange={e => setCreateForm({...createForm, budget: parseFloat(e.target.value)})} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm mb-1">Request Date</label><input required type="date" className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.request_date} onChange={e => setCreateForm({...createForm, request_date: e.target.value})} /></div>
            <div><label className="block text-sm mb-1">Department</label><input className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.department} onChange={e => setCreateForm({...createForm, department: e.target.value})} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm mb-1">GSTIN</label><input className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.gstin} onChange={e => setCreateForm({...createForm, gstin: e.target.value})} /></div>
            <div><label className="block text-sm mb-1">Receiving Office</label><input className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.receiving_office} onChange={e => setCreateForm({...createForm, receiving_office: e.target.value})} /></div>
          </div>
          <div><label className="block text-sm mb-1">Billing Address</label><textarea className="w-full border rounded-md px-3 py-2 text-sm" rows="2" value={createForm.billing_address} onChange={e => setCreateForm({...createForm, billing_address: e.target.value})} /></div>
          <div><label className="block text-sm mb-1">Delivery Address</label><textarea className="w-full border rounded-md px-3 py-2 text-sm" rows="2" value={createForm.delivery_address} onChange={e => setCreateForm({...createForm, delivery_address: e.target.value})} /></div>
          
          <div>
            <label className="block text-sm mb-2">Additional Attributes</label>
            <div className="space-y-2 mb-2">
              {attributes.map((attr, i) => (
                <div key={i} className="flex gap-2">
                  <input placeholder="Key" className="flex-1 border rounded-md px-3 py-1.5 text-sm" value={attr.key} onChange={e => { const newA = [...attributes]; newA[i].key = e.target.value; setAttributes(newA); }} />
                  <input placeholder="Value" className="flex-1 border rounded-md px-3 py-1.5 text-sm" value={attr.value} onChange={e => { const newA = [...attributes]; newA[i].value = e.target.value; setAttributes(newA); }} />
                  <button type="button" onClick={() => setAttributes(attributes.filter((_, idx) => idx !== i))} className="text-red-500 p-1"><X size={16} /></button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setAttributes([...attributes, {key: '', value: ''}])}>+ Add Field</Button>
          </div>
          <Button type="submit" className="w-full" disabled={createMutation.isPending}>Submit</Button>
        </form>
      </Modal>
    </div>
  );
}
