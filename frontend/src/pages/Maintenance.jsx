import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, useToast, StatCard, StatusBadge } from '../components/ui';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Upload, FileText } from 'lucide-react';

export default function Maintenance() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  
  const [filter, setFilter] = useState('OPEN');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  
  const [resolveForm, setResolveForm] = useState({ cost: 0, parts_used: '' });
  const [billFile, setBillFile] = useState(null);
  
  const [range, setRange] = useState('monthly');

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['maintenance', filter],
    queryFn: async () => {
      const url = filter === 'ALL' ? 'http://localhost:4000/maintenance' : `http://localhost:4000/maintenance?status=${filter}`;
      const res = await fetch(url);
      return res.json();
    }
  });

  const { data: maintStats } = useQuery({
    queryKey: ['maintenance-stats', range],
    queryFn: async () => {
      const res = await fetch(`http://localhost:4000/maintenance/stats?range=${range}`);
      return res.json();
    }
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, cost, parts_used, status, file }) => {
      // First, update ticket details
      const res = await fetch(`http://localhost:4000/maintenance/${id}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          cost, 
          parts_used: parts_used ? parts_used.split(',').map(p => p.trim()) : [],
          status
        })
      });
      if (!res.ok) throw new Error('Failed to update ticket');
      const ticket = await res.json();

      // If there's a bill file, upload it
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await fetch(`http://localhost:4000/maintenance/${id}/bill`, {
          method: 'POST',
          body: formData
        });
        if (!uploadRes.ok) throw new Error('Failed to upload bill');
      }
      return ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['maintenance']);
      queryClient.invalidateQueries(['maintenance-stats']);
      showToast('Ticket updated successfully');
      setResolveOpen(false);
      setSelectedTicket(null);
      setResolveForm({ cost: 0, parts_used: '' });
      setBillFile(null);
    },
    onError: (err) => showToast(err.message, 'error')
  });

  const startWorkMutation = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`http://localhost:4000/maintenance/${id}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RUNNING' })
      });
      if (!res.ok) throw new Error('Failed to start work');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['maintenance']);
      showToast('Work started');
    }
  });

  const activeCount = tickets?.filter(t => t.status === 'OPEN' || t.status === 'RUNNING').length || 0;
  const resolvedCount = tickets?.filter(t => t.status === 'CLOSED').length || 0;
  const totalCost = tickets?.reduce((acc, t) => acc + (t.cost || 0), 0) || 0;

  const maintCostData = maintStats?.map(row => ({
    period: new Date(row.period).toISOString().slice(0, range === 'yearly' ? 4 : range === 'monthly' ? 7 : 10),
    cost: row.total_cost
  })) || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Maintenance Portal</h1>
      </div>

      <div className="bg-background border border-border rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium">Cost Trend</h2>
          <div className="flex border border-border rounded-md overflow-hidden">
            {['weekly', 'monthly', 'yearly'].map(r => (
              <button 
                key={r} onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs font-medium capitalize ${range === r ? 'bg-primary text-white' : 'bg-surface text-muted hover:text-text'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={maintCostData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="period" tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
              <YAxis tick={{fontSize: 12, fill: '#6b7280'}} axisLine={false} tickLine={false} />
              <Tooltip cursor={{stroke: '#e5e7eb', strokeWidth: 2}} contentStyle={{borderRadius: '6px', border: '1px solid #e5e7eb'}} />
              <Area type="monotone" dataKey="cost" stroke="#ef4444" fill="#fecaca" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Active Issues" value={activeCount} isLoading={isLoading} />
        <StatCard title="Resolved Issues" value={resolvedCount} isLoading={isLoading} />
        <StatCard title="Total Cost (Current View)" value={`$${totalCost.toFixed(2)}`} isLoading={isLoading} />
      </div>

      <div className="bg-background border border-border rounded-lg overflow-hidden flex flex-col">
        <div className="border-b border-border flex">
          {['OPEN', 'RUNNING', 'CLOSED', 'ALL'].map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${filter === tab ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        <table className="w-full text-left text-sm text-text">
          <thead className="bg-surface border-b border-border text-muted">
            <tr>
              <th className="px-6 py-4 font-medium">Date</th>
              <th className="px-6 py-4 font-medium">Asset ID</th>
              <th className="px-6 py-4 font-medium">Issue Type</th>
              <th className="px-6 py-4 font-medium">Description</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Bill</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="7" className="px-6 py-8 text-center text-muted">Loading...</td></tr>
            ) : !Array.isArray(tickets) || tickets.length === 0 ? (
              <tr><td colSpan="7" className="px-6 py-8 text-center text-muted">No tickets found.</td></tr>
            ) : (
              tickets.map(ticket => (
                <tr key={ticket.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-6 py-4 whitespace-nowrap">{new Date(ticket.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 font-mono">AST-{ticket.asset_id}</td>
                  <td className="px-6 py-4">{ticket.issue_type}</td>
                  <td className="px-6 py-4 max-w-xs truncate">{ticket.description}</td>
                  <td className="px-6 py-4"><StatusBadge status={ticket.status} /></td>
                  <td className="px-6 py-4">
                    {ticket.bill_url ? (
                      <a href={ticket.bill_url} target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1">
                        <FileText size={14} /> View
                      </a>
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    {ticket.status === 'OPEN' && (
                      <Button variant="secondary" className="h-8 text-xs px-3" onClick={() => startWorkMutation.mutate(ticket.id)} disabled={startWorkMutation.isPending}>
                        Start Work
                      </Button>
                    )}
                    {ticket.status === 'RUNNING' && (
                      <Button variant="outline" className="h-8 text-xs px-3 text-green-600 border-green-200 hover:bg-green-50" onClick={() => { setSelectedTicket(ticket); setResolveOpen(true); }}>
                        Resolve
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={resolveOpen} onClose={() => setResolveOpen(false)} title="Resolve Ticket">
        <form onSubmit={e => { e.preventDefault(); resolveMutation.mutate({ id: selectedTicket.id, ...resolveForm, status: 'CLOSED', file: billFile }); }} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Parts Used (comma separated)</label>
            <input 
              type="text"
              placeholder="e.g. Screen, Battery"
              className="w-full border rounded-md px-3 py-2 text-sm"
              value={resolveForm.parts_used}
              onChange={e => setResolveForm({...resolveForm, parts_used: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Repair Cost ($)</label>
            <input 
              type="number" step="0.01" 
              className="w-full border rounded-md px-3 py-2 text-sm"
              value={resolveForm.cost}
              onChange={e => setResolveForm({...resolveForm, cost: parseFloat(e.target.value)})}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Upload Bill (Optional)</label>
            <div className="flex items-center gap-2">
              <input type="file" id="bill-upload" className="hidden" onChange={e => setBillFile(e.target.files[0])} />
              <Button type="button" variant="outline" onClick={() => document.getElementById('bill-upload').click()} className="w-full justify-center">
                <Upload size={16} className="mr-2" /> {billFile ? billFile.name : 'Select File'}
              </Button>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={resolveMutation.isPending}>
            {resolveMutation.isPending ? 'Resolving...' : 'Confirm Resolution'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}


