import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, useToast, StatCard, StatusBadge } from '../components/ui';

export default function Maintenance() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  
  const [filter, setFilter] = useState('ALL');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [cost, setCost] = useState(0);

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['maintenance', filter],
    queryFn: async () => {
      const url = filter === 'ALL' ? 'http://localhost:3001/maintenance' : `http://localhost:3001/maintenance?status=${filter}`;
      const res = await fetch(url);
      return res.json();
    }
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, cost }) => {
      const res = await fetch(`http://localhost:3001/maintenance/${id}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cost })
      });
      if (!res.ok) throw new Error('Failed to resolve ticket');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['maintenance']);
      showToast('Ticket resolved successfully');
      setResolveOpen(false);
      setSelectedTicket(null);
      setCost(0);
    },
    onError: (err) => showToast(err.message, 'error')
  });

  // Calculate stats manually since we might just be showing current view, or we can fetch /dashboard/stats
  const activeCount = tickets?.filter(t => t.status === 'OPEN').length || 0;
  const resolvedCount = tickets?.filter(t => t.status === 'CLOSED').length || 0;
  const totalCost = tickets?.reduce((acc, t) => acc + (t.cost || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Maintenance</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Active Issues" value={activeCount} isLoading={isLoading} />
        <StatCard title="Resolved Issues" value={resolvedCount} isLoading={isLoading} />
        <StatCard title="Total Cost" value={`$${totalCost.toFixed(2)}`} isLoading={isLoading} />
      </div>

      <div className="bg-background border border-border rounded-lg overflow-hidden flex flex-col">
        <div className="border-b border-border flex">
          {['ALL', 'OPEN', 'CLOSED'].map(tab => (
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
              <th className="px-6 py-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="6" className="px-6 py-8 text-center text-muted">Loading...</td></tr>
            ) : tickets?.length === 0 ? (
              <tr><td colSpan="6" className="px-6 py-8 text-center text-muted">No tickets found.</td></tr>
            ) : (
              tickets?.map(ticket => (
                <tr key={ticket.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-6 py-4 whitespace-nowrap">{new Date(ticket.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 font-mono">AST-{ticket.asset_id}</td>
                  <td className="px-6 py-4">{ticket.issue_type}</td>
                  <td className="px-6 py-4">{ticket.description}</td>
                  <td className="px-6 py-4"><StatusBadge status={ticket.status} /></td>
                  <td className="px-6 py-4">
                    {ticket.status === 'OPEN' && (
                      <Button 
                        variant="secondary" 
                        className="h-8 text-xs px-3"
                        onClick={() => {
                          setSelectedTicket(ticket);
                          setResolveOpen(true);
                        }}
                      >
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
        <form onSubmit={e => { e.preventDefault(); resolveMutation.mutate({ id: selectedTicket.id, cost }); }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Repair Cost ($)</label>
            <input 
              type="number"
              step="0.01" 
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:border-primary"
              value={cost}
              onChange={e => setCost(parseFloat(e.target.value))}
            />
          </div>
          <Button type="submit" className="w-full" disabled={resolveMutation.isPending}>
            {resolveMutation.isPending ? 'Resolving...' : 'Confirm Resolution'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
