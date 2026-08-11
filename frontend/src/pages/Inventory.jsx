import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge, Button, Modal, useToast } from '../components/ui';
import { Download, Upload, Plus, X } from 'lucide-react';

export default function Inventory() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  
  const [isAllocateOpen, setIsAllocateOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  
  const [allocateForm, setAllocateForm] = useState({ assetType: 'LAPTOP', assignedTo: 1, warehouseId: 1 });
  const [createForm, setCreateForm] = useState({ asset_tag: '', type: '', warehouse_id: 1, category_id: '' });
  const [properties, setProperties] = useState([]);
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  
  const [newCategoryName, setNewCategoryName] = useState('');

  // Fetch Categories
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3001/categories');
      return res.json();
    }
  });

  // Fetch Assets with filters
  const { data: assets, isLoading } = useQuery({
    queryKey: ['assets', categoryFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (categoryFilter) params.append('category_id', categoryFilter);
      if (search) params.append('search', search);
      const res = await fetch(`http://localhost:3001/assets?${params.toString()}`);
      return res.json();
    }
  });

  // Create Category Mutation
  const createCategoryMutation = useMutation({
    mutationFn: async (name) => {
      const res = await fetch('http://localhost:3001/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!res.ok) throw new Error('Failed to create category');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['categories']);
      setNewCategoryName('');
      showToast('Category created');
    }
  });

  // Create Asset Mutation
  const createAssetMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch('http://localhost:3001/assets', {
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
      setCreateForm({ asset_tag: '', type: '', warehouse_id: 1, category_id: '' });
    },
    onError: (err) => showToast(err.message, 'error')
  });

  // Allocate Asset Mutation
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
    onError: (err) => showToast(err.message, 'error')
  });

  // Handle Excel Upload
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('http://localhost:3001/assets/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Imported ${data.success} assets.`);
      if (data.errors && data.errors.length > 0) {
        // Simple way to show errors; you could render this in the UI
        alert('Some rows failed:\n' + data.errors.join('\n'));
      }
      queryClient.invalidateQueries(['assets']);
    } catch (err) {
      showToast(err.message, 'error');
    }
    e.target.value = ''; // reset
  };

  const filteredAssets = assets?.filter(a => statusFilter ? a.status === statusFilter : true);

  return (
    <div className="flex gap-6 h-full">
      {/* Sidebar (Categories) */}
      <div className="w-64 flex-shrink-0 flex flex-col gap-4">
        <h2 className="font-semibold text-lg">Categories</h2>
        <div className="flex gap-2">
          <input 
            type="text" 
            placeholder="New Category"
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm focus:border-primary"
            value={newCategoryName}
            onChange={e => setNewCategoryName(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={() => { if(newCategoryName) createCategoryMutation.mutate(newCategoryName) }}>
            <Plus size={16} />
          </Button>
        </div>
        <div className="flex flex-col gap-1 mt-2">
          <button 
            className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${categoryFilter === '' ? 'bg-primary text-white' : 'text-muted hover:bg-surface hover:text-text'}`}
            onClick={() => setCategoryFilter('')}
          >
            All Categories
          </button>
          {categories?.map(c => (
            <button 
              key={c.id}
              className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${categoryFilter === c.id.toString() ? 'bg-primary text-white' : 'text-muted hover:bg-surface hover:text-text'}`}
              onClick={() => setCategoryFilter(c.id.toString())}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-semibold">Asset Inventory</h1>
          <div className="flex gap-2">
            <input type="file" id="import-excel" className="hidden" accept=".xlsx" onChange={handleFileUpload} />
            <Button variant="outline" onClick={() => document.getElementById('import-excel').click()}>
              <Upload size={16} className="mr-2" /> Import
            </Button>
            <a href="http://localhost:3001/assets/export" download>
              <Button variant="outline">
                <Download size={16} className="mr-2" /> Export
              </Button>
            </a>
            <Button onClick={() => setIsCreateOpen(true)}>Create Asset</Button>
            <Button variant="outline" onClick={() => setIsAllocateOpen(true)}>Allocate Asset</Button>
          </div>
        </div>

        <div className="flex gap-4 items-center">
          <input 
            type="text" 
            placeholder="Search tags or types..."
            className="border border-border rounded-md px-3 py-2 text-sm w-64 focus:border-primary"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="flex gap-2">
            {['', 'IN_STOCK', 'DEPLOYED', 'MAINTENANCE'].map(status => (
              <button 
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${statusFilter === status ? 'bg-primary text-white border-primary' : 'bg-surface text-muted border-border hover:text-text'}`}
              >
                {status || 'ALL'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-background border border-border rounded-lg overflow-hidden">
          <table className="w-full text-left text-sm text-text">
            <thead className="bg-surface border-b border-border text-muted">
              <tr>
                <th className="px-6 py-4 font-medium">Asset Tag</th>
                <th className="px-6 py-4 font-medium">Type</th>
                <th className="px-6 py-4 font-medium">Category</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td colSpan="5" className="px-6 py-4"><div className="h-4 bg-surface animate-pulse rounded w-full" /></td>
                  </tr>
                ))
              ) : filteredAssets?.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-muted">No assets found.</td>
                </tr>
              ) : (
                filteredAssets?.map(asset => (
                  <tr key={asset.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                    <td className="px-6 py-4 font-mono">{asset.asset_tag}</td>
                    <td className="px-6 py-4">{asset.type}</td>
                    <td className="px-6 py-4">{categories?.find(c => c.id === asset.category_id)?.name || '-'}</td>
                    <td className="px-6 py-4"><StatusBadge status={asset.status} /></td>
                    <td className="px-6 py-4">{asset.assigned_to || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Allocate Modal */}
        <Modal isOpen={isAllocateOpen} onClose={() => setIsAllocateOpen(false)} title="Allocate Asset">
          <form onSubmit={(e) => { e.preventDefault(); allocateMutation.mutate(allocateForm); }} className="space-y-4">
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

        {/* Create Asset Modal */}
        <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create Asset">
          <form onSubmit={(e) => { 
            e.preventDefault(); 
            createAssetMutation.mutate({ ...createForm, category_id: createForm.category_id ? parseInt(createForm.category_id) : null, properties }); 
          }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text mb-1">Asset Tag</label>
                <input required type="text" className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" value={createForm.asset_tag} onChange={e => setCreateForm({...createForm, asset_tag: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-text mb-1">Type</label>
                <input required type="text" className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" value={createForm.type} onChange={e => setCreateForm({...createForm, type: e.target.value})} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">Category</label>
              <select className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary" value={createForm.category_id} onChange={e => setCreateForm({...createForm, category_id: e.target.value})}>
                <option value="">None</option>
                {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            
            {/* Dynamic Properties */}
            <div>
              <label className="block text-sm font-medium text-text mb-2">Dynamic Properties (JSONB)</label>
              <div className="space-y-2 mb-2">
                {properties.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input type="text" placeholder="Key" className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm" value={p.key} onChange={e => { const newP = [...properties]; newP[i].key = e.target.value; setProperties(newP); }} />
                    <input type="text" placeholder="Value" className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm" value={p.value} onChange={e => { const newP = [...properties]; newP[i].value = e.target.value; setProperties(newP); }} />
                    <button type="button" onClick={() => setProperties(properties.filter((_, idx) => idx !== i))} className="text-red-500 p-1"><X size={16} /></button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setProperties([...properties, {key: '', value: ''}])}>+ Add Field</Button>
            </div>

            <Button type="submit" className="w-full" disabled={createAssetMutation.isPending}>
              {createAssetMutation.isPending ? 'Creating...' : 'Create Asset'}
            </Button>
          </form>
        </Modal>
      </div>
    </div>
  );
}
