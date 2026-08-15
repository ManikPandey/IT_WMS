import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge, Button, Modal, useToast, EmptyState, SkeletonRow } from '../components/ui';
import { X, Search, ArrowUpDown, Plus, FileText } from 'lucide-react';

export default function PurchaseOrders() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ 
    vendor: '', request_date: new Date().toISOString().split('T')[0], gstin: '', department: '', billing_address: '', delivery_address: '', receiving_office: ''
  });
  const [lineItems, setLineItems] = useState([{ category_id: '', description: '', quantity: 1, unit_price: 0 }]);
  const [documentFile, setDocumentFile] = useState(null);
  const [attributes, setAttributes] = useState([]);
  
  const [isGrnOpen, setIsGrnOpen] = useState(false);
  const [grnPoId, setGrnPoId] = useState(null);
  const [grnFile, setGrnFile] = useState(null);

  // Fetch categories for line items
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_INVENTORY_URL}/categories`);
      return res.json();
    }
  });
  
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
      
      const res = await fetch(`${import.meta.env.VITE_API_URL}/purchase-orders?${params.toString()}`, {
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
      
      const formData = new FormData();
      formData.append('vendor', data.vendor);
      formData.append('request_date', data.request_date);
      if (data.gstin) formData.append('gstin', data.gstin);
      if (data.department) formData.append('department', data.department);
      if (data.billing_address) formData.append('billing_address', data.billing_address);
      if (data.delivery_address) formData.append('delivery_address', data.delivery_address);
      
      if (Object.keys(custom_attributes).length > 0) {
        formData.append('custom_attributes', JSON.stringify(custom_attributes));
      }
      
      const parsedItems = lineItems.map(li => ({
        category_id: parseInt(li.category_id, 10),
        description: li.description,
        quantity: parseInt(li.quantity, 10),
        unit_price: parseFloat(li.unit_price)
      }));
      formData.append('line_items', JSON.stringify(parsedItems));

      if (documentFile) {
        if (documentFile.size > 2 * 1024 * 1024) {
          throw new Error('File size exceeds 2MB limit');
        }
        formData.append('document', documentFile);
      }

      const res = await fetch(`${import.meta.env.VITE_API_URL}/purchase-orders`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }, // Removed Content-Type to let browser set boundary
        body: formData
      });
      if (!res.ok) throw new Error('Creation failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['pos']);
      showToast('Purchase Order created');
      setIsCreateOpen(false);
      setAttributes([]);
      setLineItems([{ category_id: '', description: '', quantity: 1, unit_price: 0 }]);
      setDocumentFile(null);
      setCreateForm({ vendor: '', request_date: new Date().toISOString().split('T')[0], gstin: '', department: '', billing_address: '', delivery_address: '', receiving_office: '' });
    },
    onError: (err) => showToast(err.message, 'error')
  });

  const grnMutation = useMutation({
    mutationFn: async () => {
      if (!grnFile) throw new Error('Please select an Excel file');
      const formData = new FormData();
      formData.append('file', grnFile);
      
      const res = await fetch(`${import.meta.env.VITE_API_URL}/purchase-orders/${grnPoId}/receive`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'GRN failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(['pos']);
      showToast(`GRN successful: ${data.assets_created} assets created`);
      setIsGrnOpen(false);
      setGrnFile(null);
      setGrnPoId(null);
    },
    onError: (err) => showToast(err.message, 'error')
  });

  const approveMutation = useMutation({
    mutationFn: async (id) => {
      const idemKey = `idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`; 
      const res = await fetch(`${import.meta.env.VITE_API_URL}/purchase-orders/${id}/approve`, {
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
      const res = await fetch(`${import.meta.env.VITE_API_URL}/purchase-orders/${id}/reject`, {
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
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
        {role === 'ADMIN' && (
          <div className="space-x-2">
            <Button onClick={() => { setGrnPoId(''); setIsGrnOpen(true); }} variant="outline">
              <Download size={16} className="mr-2 inline" /> Bulk Receive
            </Button>
            <Button onClick={() => setIsCreateOpen(true)}><Plus size={16} className="mr-2 inline" /> Create PO</Button>
          </div>
        )}
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

      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden relative">
        <div className="overflow-auto max-h-[600px]">
          <table className="w-full text-left text-sm text-text">
            <thead className="bg-gray-50 border-b border-border text-gray-700 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-4 font-semibold">PO ID</th>
                <th className="px-6 py-4 font-semibold">Vendor</th>
                <th className="px-6 py-4 font-semibold">Department</th>
                <th className="px-6 py-4 font-semibold">Receiving Office</th>
                <th className="px-6 py-4 font-semibold">Budget</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                {role === 'ADMIN' && <th className="px-6 py-4 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <>
                  <SkeletonRow columns={role === 'ADMIN' ? 7 : 6} />
                  <SkeletonRow columns={role === 'ADMIN' ? 7 : 6} />
                  <SkeletonRow columns={role === 'ADMIN' ? 7 : 6} />
                </>
              ) : !Array.isArray(pos) || pos.length === 0 ? (
                <tr>
                  <td colSpan={role === 'ADMIN' ? 7 : 6}>
                    <EmptyState icon={FileText} title="No Purchase Orders" description="There are no purchase orders matching your search or filters." />
                  </td>
                </tr>
              ) : (
                pos.map(po => (
                  <tr key={po.id} className="border-b border-border last:border-0 hover:bg-gray-50 transition-colors group">
                  <td className="px-6 py-4 font-mono">PO-{po.id}</td>
                  <td className="px-6 py-4">{po.vendor}</td>
                  <td className="px-6 py-4">{po.department || '-'}</td>
                  <td className="px-6 py-4">{po.receiving_office || '-'}</td>
                  <td className="px-6 py-4 font-mono">
                    {po.budget ? `$${po.budget}` : 'Auto-calc'}
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={po.status} /></td>
                  {role === 'ADMIN' && (
                    <td className="px-6 py-4 text-right space-x-2">
                      {po.status === 'PENDING' && (
                        <Button variant="secondary" className="h-8 text-xs px-3" onClick={() => approveMutation.mutate(po.id)}>Approve</Button>
                      )}
                      {(po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED') && (
                        <Button variant="secondary" className="h-8 text-xs px-3" onClick={() => { setGrnPoId(po.id); setIsGrnOpen(true); }}>Receive Goods</Button>
                      )}
                      {po.status !== 'REJECTED' && (
                        <Button variant="outline" className="h-8 text-xs px-3 text-red-500 hover:bg-red-50" onClick={() => rejectMutation.mutate(po.id)}>Reject</Button>
                      )}
                      {po.document_url && (
                        <a href={po.document_url} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary hover:underline text-xs">View Doc</a>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
        
        {hasNextPage && (
          <div className="p-4 border-t border-border flex justify-center bg-gray-50/50">
            <Button variant="secondary" onClick={() => setCursor(data.nextCursor)}>Load More</Button>
          </div>
        )}
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create Purchase Order" size="lg">
        <form onSubmit={e => { e.preventDefault(); createMutation.mutate(createForm); }} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm mb-1">Vendor</label><input required className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.vendor} onChange={e => setCreateForm({...createForm, vendor: e.target.value})} /></div>
            <div><label className="block text-sm mb-1">Request Date</label><input required type="date" className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.request_date} onChange={e => setCreateForm({...createForm, request_date: e.target.value})} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm mb-1">Department</label><input className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.department} onChange={e => setCreateForm({...createForm, department: e.target.value})} /></div>
            <div><label className="block text-sm mb-1">GSTIN</label><input className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.gstin} onChange={e => setCreateForm({...createForm, gstin: e.target.value})} /></div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2 mt-4">Line Items</label>
            <div className="space-y-2 border border-border rounded-md p-4 bg-surface/30">
              {lineItems.map((li, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <select required className="flex-1 border rounded-md px-2 py-1.5 text-sm" value={li.category_id} onChange={e => { const newLi = [...lineItems]; newLi[i].category_id = e.target.value; setLineItems(newLi); }}>
                    <option value="">Select Category</option>
                    {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input required placeholder="Description" className="flex-1 border rounded-md px-2 py-1.5 text-sm" value={li.description} onChange={e => { const newLi = [...lineItems]; newLi[i].description = e.target.value; setLineItems(newLi); }} />
                  <input required type="number" min="1" placeholder="Qty" className="w-20 border rounded-md px-2 py-1.5 text-sm" value={li.quantity} onChange={e => { const newLi = [...lineItems]; newLi[i].quantity = e.target.value; setLineItems(newLi); }} />
                  <input required type="number" min="0" step="0.01" placeholder="Price" className="w-24 border rounded-md px-2 py-1.5 text-sm" value={li.unit_price} onChange={e => { const newLi = [...lineItems]; newLi[i].unit_price = e.target.value; setLineItems(newLi); }} />
                  {lineItems.length > 1 && (
                    <button type="button" onClick={() => setLineItems(lineItems.filter((_, idx) => idx !== i))} className="text-red-500 p-1"><X size={16} /></button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setLineItems([...lineItems, { category_id: '', description: '', quantity: 1, unit_price: 0 }])}>
                + Add Line Item
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">Document Attachment (PDF/Image, max 2MB)</label>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="w-full border rounded-md px-3 py-2 text-sm" onChange={e => setDocumentFile(e.target.files[0])} />
          </div>

          <Button type="submit" className="w-full" disabled={createMutation.isPending}>Submit PO</Button>
        </form>
      </Modal>

        <Modal isOpen={isGrnOpen} onClose={() => setIsGrnOpen(false)} title="Receive Goods (GRN)">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Purchase Order ID</label>
              <input 
                type="number" 
                required 
                placeholder="e.g. 1" 
                className="w-full border rounded-md px-3 py-2 text-sm" 
                value={grnPoId || ''} 
                onChange={e => setGrnPoId(e.target.value)} 
              />
            </div>
            <p className="text-sm text-muted">
              Upload an Excel (.xlsx) file containing the goods received.
            </p>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm">Need the format?</span>
              <a href={`${import.meta.env.VITE_API_URL}/purchase-orders/grn-template`} download className="text-primary hover:underline text-sm font-medium">Download Template</a>
            </div>
            <input type="file" accept=".xlsx" className="block w-full text-sm text-text file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-white hover:file:bg-primary/90" onChange={(e) => setGrnFile(e.target.files[0])} />
            <Button className="w-full" onClick={() => grnMutation.mutate()} disabled={!grnFile || grnMutation.isPending}>
              {grnMutation.isPending ? 'Processing...' : 'Upload & Process'}
            </Button>
          </div>
        </Modal>
    </div>
  );
}
