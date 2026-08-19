import React, { useState, useEffect } from 'react';
import { fetchWithAuth } from '../utils/api';
import { Button, Modal, StatusBadge, EmptyState, SkeletonRow } from '../components/ui';
import { FileText } from 'lucide-react';

export default function AssetRequests() {
  const [requests, setRequests] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [categoryId, setCategoryId] = useState('');
  const [justification, setJustification] = useState('');
  
  const role = localStorage.getItem('role');
  const isAdmin = role === 'ADMIN';

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [reqRes, catRes] = await Promise.all([
        fetchWithAuth(`${import.meta.env.VITE_API_URL}/asset-requests`),
        fetchWithAuth(`${import.meta.env.VITE_INVENTORY_URL}/categories`)
      ]);
      const reqData = await reqRes.json();
      const catData = await catRes.json();
      setRequests(reqData);
      setCategories(catData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/asset-requests`, {
        method: 'POST',
        body: JSON.stringify({
          category_id: parseInt(categoryId),
          justification
        })
      });
      if (res.ok) {
        setIsModalOpen(false);
        setCategoryId('');
        setJustification('');
        fetchData();
      } else {
        const data = await res.json();
        alert('Error: ' + JSON.stringify(data.error));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAction = async (id, action) => {
    try {
      const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/asset-requests/${id}/${action}`, {
        method: 'PATCH'
      });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        alert('Error: ' + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getCategoryName = (id) => categories.find(c => c.id === id)?.name || id;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-text">Asset Requests</h1>
        {!isAdmin && (
          <Button onClick={() => setIsModalOpen(true)}>Request Asset</Button>
        )}
      </div>

      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden relative">
        <div className="overflow-auto max-h-[600px]">
          <table className="w-full text-left text-sm text-text">
            <thead className="bg-background border-b border-border text-muted sticky top-0 z-10">
              <tr>
                <th className="px-6 py-4 font-semibold">ID</th>
                <th className="px-6 py-4 font-semibold">Category</th>
                <th className="px-6 py-4 font-semibold">Justification</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Date</th>
                {isAdmin && <th className="px-6 py-4 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>
                  <SkeletonRow columns={isAdmin ? 6 : 5} />
                  <SkeletonRow columns={isAdmin ? 6 : 5} />
                  <SkeletonRow columns={isAdmin ? 6 : 5} />
                </>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5}>
                    <EmptyState icon={FileText} title="No Asset Requests" description="You have not made any asset requests yet." />
                  </td>
                </tr>
              ) : (
                requests.map(req => (
                  <tr key={req.id} className="border-b border-border last:border-0 hover:bg-background transition-colors group">
                    <td className="px-6 py-4 font-mono">REQ-{req.id}</td>
                    <td className="px-6 py-4">{getCategoryName(req.category_id)}</td>
                    <td className="px-6 py-4 max-w-xs truncate">{req.justification}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="px-6 py-4">{new Date(req.created_at).toLocaleDateString()}</td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right space-x-2">
                        {req.status === 'PENDING' && (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => handleAction(req.id, 'approve')}>Approve</Button>
                            <Button variant="danger" size="sm" onClick={() => handleAction(req.id, 'reject')}>Reject</Button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Request Asset">
        <form onSubmit={handleCreateRequest} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Category</label>
            <select 
              required
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
            >
              <option value="">Select Category</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Justification</label>
            <textarea
              required
              rows={4}
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              value={justification}
              onChange={e => setJustification(e.target.value)}
              placeholder="Why do you need this asset?"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button type="submit">Submit Request</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
