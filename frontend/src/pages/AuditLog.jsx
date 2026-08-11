import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

export default function AuditLog() {
  const token = localStorage.getItem('token');
  const [filter, setFilter] = useState('');

  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit-log', filter],
    queryFn: async () => {
      const url = new URL('http://localhost:3000/audit-log');
      if (filter) url.searchParams.append('entity_type', filter);
      
      const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.json();
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <select 
          className="border border-border rounded-md px-3 py-2 text-sm focus:border-primary"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        >
          <option value="">All Events</option>
          <option value="ASSET_ALLOCATED">ASSET_ALLOCATED</option>
          <option value="PO_APPROVED">PO_APPROVED</option>
        </select>
      </div>

      <div className="bg-background border border-border rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm text-text">
          <thead className="bg-surface border-b border-border text-muted">
            <tr>
              <th className="px-6 py-4 font-medium">Timestamp</th>
              <th className="px-6 py-4 font-medium">Event Type</th>
              <th className="px-6 py-4 font-medium">Entity ID</th>
              <th className="px-6 py-4 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="4" className="px-6 py-8 text-center text-muted">Loading...</td></tr>
            ) : logs?.length === 0 ? (
              <tr><td colSpan="4" className="px-6 py-8 text-center text-muted">No audit logs found.</td></tr>
            ) : (
              logs?.map(log => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-surface/50">
                  <td className="px-6 py-4 text-muted whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 font-medium">{log.event_type}</td>
                  <td className="px-6 py-4 font-mono">{log.entity_id}</td>
                  <td className="px-6 py-4 font-mono text-xs text-muted max-w-xs truncate" title={JSON.stringify(log.payload_json)}>
                    {JSON.stringify(log.payload_json)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
