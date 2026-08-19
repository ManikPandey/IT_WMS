import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge, Button, Modal, useToast, EmptyState, SkeletonRow } from '../components/ui';
import { Download, Upload, Plus, X, AlertTriangle, Activity, Package } from 'lucide-react';

export default function Inventory() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const role = localStorage.getItem('role');
  
  const [isAllocateOpen, setIsAllocateOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  
  const [allocateForm, setAllocateForm] = useState({ assetType: 'LAPTOP', assignedTo: 1, warehouseId: 1 });
  const [createForm, setCreateForm] = useState({ asset_tag: '', serial_number: '', type: '', warehouse_id: 1, category_id: '' });
  const [editForm, setEditForm] = useState({ asset_tag: '', serial_number: '', type: '', category_id: '' });
  const [properties, setProperties] = useState([]);
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryParent, setNewCategoryParent] = useState('');

  const [selectedAsset, setSelectedAsset] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  const [issueForm, setIssueForm] = useState({ issue_type: '', description: '' });

  // Fetch Categories
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_INVENTORY_URL}/categories`);
      return res.json();
    }
  });

  const [cursor, setCursor] = useState(null);
  const [allAssets, setAllAssets] = useState([]);
  const [hasNextPage, setHasNextPage] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['assets', categoryFilter, search, statusFilter, cursor],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (categoryFilter) params.append('category_id', categoryFilter);
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      if (cursor) params.append('cursor', cursor);
      const res = await fetch(`${import.meta.env.VITE_INVENTORY_URL}/assets?${params.toString()}`);
      return res.json();
    }
  });

  const { data: timelineData, isLoading: isTimelineLoading } = useQuery({
    queryKey: ['timeline', selectedAsset?.id],
    queryFn: async () => {
      if (!selectedAsset) return [];
      const res = await fetch(`${import.meta.env.VITE_API_URL}/assets/${selectedAsset.id}/timeline`);
      return res.json();
    },
    enabled: !!selectedAsset && isTimelineOpen
  });

  React.useEffect(() => {
    if (data?.data) {
      if (cursor) setAllAssets(prev => [...prev, ...data.data]);
      else setAllAssets(data.data);
      setHasNextPage(!!data.nextCursor);
    }
  }, [data, cursor]);

  const assets = allAssets;

  // Create Category Mutation
  const createCategoryMutation = useMutation({
    mutationFn: async ({ name, parent_id }) => {
      const res = await fetch(`${import.meta.env.VITE_INVENTORY_URL}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: parent_id ? parseInt(parent_id) : null })
      });
      if (!res.ok) throw new Error('Failed to create category');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['categories']);
      setNewCategoryName('');
      setNewCategoryParent('');
      showToast('Category created');
    }
  });

  // Create Asset Mutation
  const createAssetMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch(`${import.meta.env.VITE_INVENTORY_URL}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to create asset');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['assets']);
      showToast('Asset created successfully');
      setIsCreateOpen(false);
      setProperties([]);
      setCreateForm({ asset_tag: '', serial_number: '', type: '', warehouse_id: 1, category_id: '' });
    },
    onError: (err) => showToast(err.message, 'error')
  });

  const editAssetMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch(`${import.meta.env.VITE_INVENTORY_URL}/assets/${selectedAsset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to edit asset');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['assets']);
      showToast('Asset updated successfully');
      setIsEditOpen(false);
      setProperties([]);
    },
    onError: (err) => showToast(err.message, 'error')
  });

  const allocateMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/allocate?strategy=redis`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Allocation failed');
      }
      return res.json();
    },
    onMutate: async (newAllocation) => {
      await queryClient.cancelQueries(['assets']);
      const previousAssets = queryClient.getQueryData(['assets']);
      
      // Optimistically update the first available asset of the requested type
      queryClient.setQueryData(['assets'], old => {
        if (!old || !old.assets) return old;
        const newAssets = [...old.assets];
        const targetIndex = newAssets.findIndex(a => a.type === newAllocation.asset_type && a.status === 'IN_STOCK');
        if (targetIndex !== -1) {
          newAssets[targetIndex] = { ...newAssets[targetIndex], status: 'ALLOCATED' };
        }
        return { ...old, assets: newAssets };
      });
      
      setIsAllocateOpen(false); // Optimistically close modal
      return { previousAssets };
    },
    onError: (err, newAllocation, context) => {
      queryClient.setQueryData(['assets'], context.previousAssets);
      showToast(err.message + ' (Rolled back UI)', 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries(['assets']);
    },
    onSuccess: () => {
      showToast('Asset allocated successfully');
    }
  });

  const reportIssueMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch(`${import.meta.env.VITE_INVENTORY_URL}/assets/${selectedAsset.id}/report-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to report issue');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['assets']);
      showToast('Issue reported and maintenance ticket created');
      setIsIssueOpen(false);
      setSelectedAsset(null);
      setIssueForm({ issue_type: '', description: '' });
    },
    onError: (err) => showToast(err.message, 'error')
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${import.meta.env.VITE_INVENTORY_URL}/assets/import`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Imported ${data.success} assets.`);
      if (data.errors && data.errors.length > 0) alert('Some rows failed:\n' + data.errors.join('\n'));
      queryClient.invalidateQueries(['assets']);
    } catch (err) {
      showToast(err.message, 'error');
    }
    e.target.value = ''; // reset
  };

  const getCategoryName = (id) => categories?.find(c => c.id === id)?.name || '-';

  return (
    <div className="flex gap-6 h-full">
      {/* Sidebar (Categories) */}
      <div className="w-64 flex-shrink-0 flex flex-col gap-4">
        <h2 className="font-semibold text-lg text-text">Categories</h2>
        <div className="bg-surface border border-border p-4 rounded-xl shadow-sm space-y-3">
          <input type="text" placeholder="New Category Name" className="w-full border border-border rounded-md px-2 py-1.5 focus:border-primary" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
          <select className="w-full border border-border rounded-md px-2 py-1.5 focus:border-primary" value={newCategoryParent} onChange={e => setNewCategoryParent(e.target.value)}>
            <option value="">No Parent (Root)</option>
            {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button variant="secondary" size="sm" className="w-full" onClick={() => { if(newCategoryName) createCategoryMutation.mutate({ name: newCategoryName, parent_id: newCategoryParent }) }}>
            <Plus size={16} className="mr-1" /> Add Category
          </Button>
        </div>
        <div className="flex flex-col gap-1 mt-2">
          <button className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${categoryFilter === '' ? 'bg-primary text-white' : 'text-muted hover:bg-surface hover:text-text'}`} onClick={() => { setCursor(null); setCategoryFilter(''); }}>
            All Categories
          </button>
          {categories?.map(c => (
            <button key={c.id} className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${categoryFilter === c.id.toString() ? 'bg-primary text-white' : 'text-muted hover:bg-surface hover:text-text'}`} onClick={() => { setCursor(null); setCategoryFilter(c.id.toString()); }}>
              {c.parent_id ? '— ' : ''}{c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-text">Asset Inventory</h1>
          <div className="flex gap-2">
            {role === 'ADMIN' && (
              <>
                <input type="file" id="import-excel" className="hidden" accept=".xlsx" onChange={handleFileUpload} />
                <Button variant="outline" onClick={() => document.getElementById('import-excel').click()}><Upload size={16} className="mr-2" /> Import</Button>
                <a href={`${import.meta.env.VITE_INVENTORY_URL}/assets/export`} download>
                  <Button variant="outline"><Download size={16} className="mr-2" /> Export</Button>
                </a>
                <Button onClick={() => setIsCreateOpen(true)}><Plus size={16} className="mr-2" /> Create Asset</Button>
                <Button variant="secondary" onClick={() => setIsAllocateOpen(true)}>Allocate Asset</Button>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-4 items-center">
          <input 
            type="text" 
            placeholder="Search tags, type, serial..."
            className="border border-border rounded-lg px-4 py-2.5 text-sm w-80 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow outline-none shadow-sm bg-surface"
            value={search}
            onChange={e => { setCursor(null); setSearch(e.target.value); }}
          />
        </div>

        {/* Status Filter Chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {['IN_STOCK', 'DEPLOYED', 'MAINTENANCE', 'RETIRED'].map(status => (
            <button
              key={status}
              onClick={() => {
                setCursor(null);
                setStatusFilter(prev => {
                  const current = prev ? prev.split(',') : [];
                  if (current.includes(status)) return current.filter(s => s !== status).join(',');
                  return [...current, status].join(',');
                });
              }}
              className={`px-3 py-1 rounded-full text-xs ${statusFilter.includes(status) ? 'bg-primary text-white' : 'bg-surface border border-border text-muted'}`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden relative">
          <div className="overflow-auto max-h-[600px]">
            <table className="w-full text-left text-sm text-text">
              <thead className="bg-background border-b border-border text-muted sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-4 font-semibold">Asset Tag</th>
                  <th className="px-6 py-4 font-semibold">Serial Number</th>
                  <th className="px-6 py-4 font-semibold">Category</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  {role === 'ADMIN' && <th className="px-6 py-4 font-semibold text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {isLoading && !cursor ? (
                  <>
                    <SkeletonRow columns={role === 'ADMIN' ? 5 : 4} />
                    <SkeletonRow columns={role === 'ADMIN' ? 5 : 4} />
                    <SkeletonRow columns={role === 'ADMIN' ? 5 : 4} />
                  </>
                ) : !Array.isArray(assets) || assets.length === 0 ? (
                  <tr>
                    <td colSpan={role === 'ADMIN' ? 5 : 4}>
                      <EmptyState icon={Package} title="No assets found" description="There are no assets matching your current search or filters." />
                    </td>
                  </tr>
                ) : (
                  assets.map(asset => (
                    <tr key={asset.id} className="border-b border-border last:border-0 hover:bg-background transition-colors group">
                    <td className="px-6 py-4 font-mono">{asset.asset_tag}</td>
                    <td className="px-6 py-4 font-mono">{asset.serial_number || '-'}</td>
                    <td className="px-6 py-4">{getCategoryName(asset.category_id)}</td>
                    <td className="px-6 py-4"><StatusBadge status={asset.status} /></td>
                    {role === 'ADMIN' && (
                      <td className="px-6 py-4 text-right">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-2">
                          <button 
                            onClick={() => {
                              setSelectedAsset(asset);
                              setEditForm({
                                asset_tag: asset.asset_tag,
                                serial_number: asset.serial_number || '',
                                type: asset.type,
                                category_id: asset.category_id || ''
                              });
                              const props = [];
                              if (asset.jsonb_attributes) {
                                for (const [k, v] of Object.entries(asset.jsonb_attributes)) {
                                  props.push({ key: k, value: v });
                                }
                              }
                              setProperties(props);
                              setIsEditOpen(true);
                            }}
                            className="text-blue-500 hover:text-blue-600 px-2 flex items-center gap-1 inline-flex"
                            title="Edit Asset"
                          >
                            Edit
                          </button>
                          <button 
                            onClick={() => { setSelectedAsset(asset); setIsTimelineOpen(true); }}
                            className="text-primary hover:text-primary/80 px-2 flex items-center gap-1 inline-flex"
                            title="View Timeline"
                          >
                            <Activity size={16} /> Timeline
                          </button>
                          {asset.status !== 'MAINTENANCE' && (
                            <button 
                              onClick={() => { setSelectedAsset(asset); setIsIssueOpen(true); }}
                              className="text-amber-500 hover:text-amber-600 px-2 flex items-center gap-1 inline-flex"
                              title="Report Issue"
                            >
                              <AlertTriangle size={16} /> Report
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {hasNextPage && (
            <div className="p-4 border-t border-border flex justify-center bg-background/50">
              <Button variant="secondary" onClick={() => setCursor(data.nextCursor)}>Load More</Button>
            </div>
          )}
        </div>

        {/* Allocate Modal */}
        <Modal isOpen={isAllocateOpen} onClose={() => setIsAllocateOpen(false)} title="Allocate Asset">
          <form onSubmit={(e) => { e.preventDefault(); allocateMutation.mutate(allocateForm); }} className="space-y-4">
            <div><label className="block text-sm mb-1">Asset Type</label><input type="text" className="w-full border rounded-md px-3 py-2 text-sm" value={allocateForm.assetType} onChange={e => setAllocateForm({...allocateForm, assetType: e.target.value})} /></div>
            <div><label className="block text-sm mb-1">Assign To (User ID)</label><input type="number" className="w-full border rounded-md px-3 py-2 text-sm" value={allocateForm.assignedTo} onChange={e => setAllocateForm({...allocateForm, assignedTo: parseInt(e.target.value)})} /></div>
            <Button type="submit" className="w-full" disabled={allocateMutation.isPending}>Allocate</Button>
          </form>
        </Modal>

        {/* Create Asset Modal */}
        <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create Asset">
          <form onSubmit={(e) => { e.preventDefault(); createAssetMutation.mutate({ ...createForm, category_id: createForm.category_id ? parseInt(createForm.category_id) : null, properties }); }} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm mb-1">Asset Tag</label><input required className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.asset_tag} onChange={e => setCreateForm({...createForm, asset_tag: e.target.value})} /></div>
              <div><label className="block text-sm mb-1">Serial Number</label><input className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.serial_number} onChange={e => setCreateForm({...createForm, serial_number: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm mb-1">Type</label><input required className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.type} onChange={e => setCreateForm({...createForm, type: e.target.value})} /></div>
              <div><label className="block text-sm mb-1">Category</label><select className="w-full border rounded-md px-3 py-2 text-sm" value={createForm.category_id} onChange={e => setCreateForm({...createForm, category_id: e.target.value})}><option value="">None</option>{categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            </div>
            
            {/* Dynamic Properties */}
            <div>
              <label className="block text-sm mb-2">Dynamic Properties (JSONB)</label>
              <div className="space-y-2 mb-2">
                {properties.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input placeholder="Key" className="flex-1 border rounded-md px-3 py-1.5 text-sm" value={p.key} onChange={e => { const newP = [...properties]; newP[i].key = e.target.value; setProperties(newP); }} />
                    <input placeholder="Value" className="flex-1 border rounded-md px-3 py-1.5 text-sm" value={p.value} onChange={e => { const newP = [...properties]; newP[i].value = e.target.value; setProperties(newP); }} />
                    <button type="button" onClick={() => setProperties(properties.filter((_, idx) => idx !== i))} className="text-red-500 p-1"><X size={16} /></button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setProperties([...properties, {key: '', value: ''}])}>+ Add Field</Button>
            </div>
            <Button type="submit" className="w-full" disabled={createAssetMutation.isPending}>Create Asset</Button>
          </form>
        </Modal>

        {/* Edit Asset Modal */}
        <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit Asset">
          <form onSubmit={(e) => { e.preventDefault(); editAssetMutation.mutate({ ...editForm, category_id: editForm.category_id ? parseInt(editForm.category_id) : null, properties }); }} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm mb-1">Asset Tag</label><input required className="w-full border rounded-md px-3 py-2 text-sm" value={editForm.asset_tag} onChange={e => setEditForm({...editForm, asset_tag: e.target.value})} /></div>
              <div><label className="block text-sm mb-1">Serial Number</label><input className="w-full border rounded-md px-3 py-2 text-sm" value={editForm.serial_number} onChange={e => setEditForm({...editForm, serial_number: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm mb-1">Type</label><input required className="w-full border rounded-md px-3 py-2 text-sm" value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})} /></div>
              <div><label className="block text-sm mb-1">Category</label><select className="w-full border rounded-md px-3 py-2 text-sm" value={editForm.category_id} onChange={e => setEditForm({...editForm, category_id: e.target.value})}><option value="">None</option>{categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            </div>
            
            {/* Dynamic Properties */}
            <div>
              <label className="block text-sm mb-2">Dynamic Properties (JSONB)</label>
              <div className="space-y-2 mb-2">
                {properties.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input placeholder="Key" className="flex-1 border rounded-md px-3 py-1.5 text-sm" value={p.key} onChange={e => { const newP = [...properties]; newP[i].key = e.target.value; setProperties(newP); }} />
                    <input placeholder="Value" className="flex-1 border rounded-md px-3 py-1.5 text-sm" value={p.value} onChange={e => { const newP = [...properties]; newP[i].value = e.target.value; setProperties(newP); }} />
                    <button type="button" onClick={() => setProperties(properties.filter((_, idx) => idx !== i))} className="text-red-500 p-1"><X size={16} /></button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setProperties([...properties, {key: '', value: ''}])}>+ Add Field</Button>
            </div>
            <Button type="submit" className="w-full" disabled={editAssetMutation.isPending}>Save Changes</Button>
          </form>
        </Modal>

        {/* Report Issue Modal */}
        <Modal isOpen={isIssueOpen} onClose={() => setIsIssueOpen(false)} title="Report Issue">
          {selectedAsset && (
            <form onSubmit={(e) => { e.preventDefault(); reportIssueMutation.mutate(issueForm); }} className="space-y-4">
              <p className="text-sm text-muted">Reporting issue for asset <span className="font-mono text-text">{selectedAsset.asset_tag}</span>.</p>
              <div><label className="block text-sm mb-1">Issue Type</label><input required placeholder="e.g. Broken screen" className="w-full border rounded-md px-3 py-2 text-sm" value={issueForm.issue_type} onChange={e => setIssueForm({...issueForm, issue_type: e.target.value})} /></div>
              <div><label className="block text-sm mb-1">Description</label><textarea required className="w-full border rounded-md px-3 py-2 text-sm" rows="3" value={issueForm.description} onChange={e => setIssueForm({...issueForm, description: e.target.value})} /></div>
              <Button type="submit" className="w-full" disabled={reportIssueMutation.isPending}>Submit Report</Button>
            </form>
          )}
        </Modal>

        {/* Timeline Modal */}
        <Modal isOpen={isTimelineOpen} onClose={() => setIsTimelineOpen(false)} title="Asset Timeline" size="lg">
          {selectedAsset && (
            <div className="space-y-6">
              <div className="mb-4">
                <h3 className="font-semibold text-lg">{selectedAsset.asset_tag}</h3>
                <p className="text-sm text-muted">Serial: {selectedAsset.serial_number || 'N/A'}</p>
              </div>

              {isTimelineLoading ? (
                <div className="text-center text-muted py-8">Loading timeline...</div>
              ) : !timelineData || timelineData.length === 0 ? (
                <div className="text-center text-muted py-8">No timeline events found.</div>
              ) : (
                <div className="relative pl-6 border-l-2 border-border space-y-6">
                  {timelineData.map((event, idx) => (
                    <div key={idx} className="relative">
                      {/* Timeline dot */}
                      <div className="absolute -left-[31px] w-4 h-4 rounded-full bg-primary ring-4 ring-background" />
                      
                      <div className="bg-surface rounded-lg p-4 border border-border shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-semibold text-text">{event.event_type}</span>
                          <span className="text-xs text-muted">{new Date(event.created_at).toLocaleString()}</span>
                        </div>
                        {event.payload_json && (
                          <div className="text-sm text-muted bg-background p-2 rounded border border-border overflow-auto max-h-32">
                            <pre className="font-mono text-xs">{JSON.stringify(event.payload_json, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>

      </div>
    </div>
  );
}
