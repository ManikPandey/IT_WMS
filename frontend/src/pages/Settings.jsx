import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, useToast } from '../components/ui';
import { Download } from 'lucide-react';

export default function Settings() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  const [activeTab, setActiveTab] = useState('Audit Logs');
  
  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      <div className="bg-background border border-border rounded-lg overflow-hidden flex flex-col flex-1">
        <div className="border-b border-border flex bg-surface">
          {['Audit Logs', 'Users', 'Data Management'].map(tab => {
            if (tab === 'Users' && role !== 'ADMIN') return null; // hide Users tab for non-admins
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-primary text-primary bg-background' : 'border-transparent text-muted hover:text-text'}`}
              >
                {tab}
              </button>
            )
          })}
        </div>
        
        <div className="p-6 flex-1 overflow-auto">
          {activeTab === 'Audit Logs' && <AuditLogsTab token={token} />}
          {activeTab === 'Users' && role === 'ADMIN' && <UsersTab token={token} />}
          {activeTab === 'Data Management' && <DataManagementTab token={token} />}
        </div>
      </div>
    </div>
  );
}

function AuditLogsTab({ token }) {
  const [filter, setFilter] = useState('');

  const [cursor, setCursor] = useState(null);
  const [allLogs, setAllLogs] = useState([]);
  const [hasNextPage, setHasNextPage] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', filter, cursor],
    queryFn: async () => {
      const url = new URL('http://localhost:3000/audit-log');
      if (filter) url.searchParams.append('entity_type', filter);
      if (cursor) url.searchParams.append('cursor', cursor);
      const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${token}` } });
      return res.json();
    }
  });

  React.useEffect(() => {
    if (data?.data) {
      if (cursor) setAllLogs(prev => [...prev, ...data.data]);
      else setAllLogs(data.data);
      setHasNextPage(!!data.nextCursor);
    }
  }, [data, cursor]);

  const logs = allLogs;

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h2 className="text-lg font-medium">System Audit Logs</h2>
        <select 
          className="border border-border rounded-md px-3 py-1.5 text-sm focus:border-primary"
          value={filter}
          onChange={e => { setCursor(null); setFilter(e.target.value); }}
        >
          <option value="">All Events</option>
          <option value="ASSET_ALLOCATED">ASSET_ALLOCATED</option>
          <option value="PO_APPROVED">PO_APPROVED</option>
        </select>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm text-text">
          <thead className="bg-surface border-b border-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Event Type</th>
              <th className="px-4 py-3 font-medium">Entity ID</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="4" className="px-4 py-6 text-center text-muted">Loading...</td></tr>
            ) : !Array.isArray(logs) || logs.length === 0 ? (
              <tr><td colSpan="4" className="px-4 py-6 text-center text-muted">No logs found.</td></tr>
            ) : (
              logs.map(log => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium">{log.event_type}</td>
                  <td className="px-4 py-3 font-mono">{log.entity_id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted max-w-sm truncate" title={JSON.stringify(log.payload_json)}>
                    {JSON.stringify(log.payload_json)}
                  </td>
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
    </div>
  );
}

function UsersTab({ token }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({ username: '', name: '', email: '', password: '', role: 'VIEWER' });

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3000/users', { headers: { 'Authorization': `Bearer ${token}` } });
      return res.json();
    }
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch('http://localhost:3000/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Creation failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      showToast('User created');
      setIsCreateOpen(false);
      setForm({ username: '', name: '', email: '', password: '', role: 'VIEWER' });
    },
    onError: (e) => showToast(e.message, 'error')
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h2 className="text-lg font-medium">User Management</h2>
        <Button onClick={() => setIsCreateOpen(true)} size="sm">Add User</Button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm text-text">
          <thead className="bg-surface border-b border-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="4" className="px-4 py-6 text-center text-muted">Loading...</td></tr>
            ) : !Array.isArray(users) || users.length === 0 ? (
              <tr><td colSpan="4" className="px-4 py-6 text-center text-muted">No users found.</td></tr>
            ) : (
              users.map(user => (
                <tr key={user.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-4 py-3 font-medium">{user.name}</td>
                  <td className="px-4 py-3 text-muted">{user.username}</td>
                  <td className="px-4 py-3 text-muted">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded bg-surface border border-border text-xs">{user.role}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create User">
        <form onSubmit={e => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4">
          <div><label className="block text-sm mb-1">Name</label><input required className="w-full border rounded-md px-3 py-2 text-sm" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
          <div><label className="block text-sm mb-1">Username</label><input required className="w-full border rounded-md px-3 py-2 text-sm" value={form.username} onChange={e => setForm({...form, username: e.target.value})} /></div>
          <div><label className="block text-sm mb-1">Email</label><input required type="email" className="w-full border rounded-md px-3 py-2 text-sm" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
          <div><label className="block text-sm mb-1">Password</label><input required type="password" className="w-full border rounded-md px-3 py-2 text-sm" value={form.password} onChange={e => setForm({...form, password: e.target.value})} /></div>
          <div>
            <label className="block text-sm mb-1">Role</label>
            <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
              <option value="VIEWER">VIEWER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <Button type="submit" className="w-full" disabled={createMutation.isPending}>Submit</Button>
        </form>
      </Modal>
    </div>
  );
}

function DataManagementTab({ token }) {
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  const handleExport = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/system/export', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Export failed');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'system-export.json';
      a.click();
      window.URL.revokeObjectURL(url);
      showToast('Export successful');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Data Management</h2>
      <p className="text-sm text-muted">
        Export a complete snapshot of all databases (Core and Inventory) as a single JSON file. 
        This is useful for local backups and migrations.
      </p>
      <Button onClick={handleExport} disabled={loading}>
        <Download size={16} className="mr-2" />
        {loading ? 'Exporting...' : 'Export All System Data'}
      </Button>
    </div>
  );
}
