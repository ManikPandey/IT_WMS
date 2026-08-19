import React, { useState, useEffect } from 'react';
import { Play, RotateCcw, Activity } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { useToast } from '../components/ui';

const ConcurrencyDemo = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(100);
  const showToast = useToast();

  const successCount = results.filter(r => r.status === 200).length;
  const failCount = results.filter(r => r.status === 400 || r.status === 409).length;
  const pendingCount = total - results.length;

  const handleSimulate = async () => {
    setIsRunning(true);
    setResults([]);

    try {
      // 1. Reset Database State via Proxy Endpoint
      const seedRes = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/system/seed`, {
        method: 'POST',
        body: JSON.stringify({ type: 'DEMO_LAPTOP', count: 50 })
      });
      if (!seedRes.ok) {
        const d = await seedRes.json().catch(()=>({}));
        throw new Error(d.error || 'Failed to seed assets.');
      }

      showToast('Seeded 50 DEMO_LAPTOPs. Initiating 100 concurrent requests...', 'success');

      // 2. Fire 100 requests concurrently
      const promises = Array.from({ length: total }).map(async (_, index) => {
        try {
          const res = await fetchWithAuth(`${import.meta.env.VITE_API_URL}/allocate`, {
            method: 'POST',
            body: JSON.stringify({ assetType: 'DEMO_LAPTOP', assignedTo: 1, warehouseId: 1 })
          });
          setResults(prev => [...prev, { index, status: res.status }]);
          return res;
        } catch (error) {
          setResults(prev => [...prev, { index, status: 500 }]);
          return { status: 500 };
        }
      });

      await Promise.all(promises);
      showToast('Simulation complete', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Live Concurrency Demo</h1>
        <p className="text-muted mt-1">Visualize the zero-overselling architecture in real-time.</p>
      </div>

      <div className="bg-surface  rounded-xl border border-border  p-6 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="text-primary" size={20} />
              Simulation Controls
            </h2>
            <p className="text-sm text-muted mt-1">This will delete all DEMO_LAPTOPs, create 50 new ones, and fire 100 concurrent allocation requests.</p>
          </div>
          <button
            onClick={handleSimulate}
            disabled={isRunning}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
          >
            {isRunning ? <RotateCcw size={18} className="animate-spin" /> : <Play size={18} />}
            {isRunning ? 'Running...' : 'Simulate 100 Requests'}
          </button>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2 mb-8">
          <div className="flex justify-between text-sm font-medium">
            <span className="text-success">Success: {successCount}</span>
            <span className="text-warning">Out of Stock: {failCount}</span>
            <span className="text-muted">Pending: {pendingCount}</span>
          </div>
          <div className="h-4 w-full bg-background  rounded-full overflow-hidden flex">
            <div 
              className="bg-success transition-all duration-300 ease-out h-full" 
              style={{ width: `${(successCount / total) * 100}%` }}
            />
            <div 
              className="bg-warning transition-all duration-300 ease-out h-full" 
              style={{ width: `${(failCount / total) * 100}%` }}
            />
          </div>
        </div>

        {/* Request Grid */}
        <div className="grid grid-cols-10 gap-2">
          {Array.from({ length: total }).map((_, i) => {
            const result = results.find(r => r.index === i);
            let bgColor = 'bg-background ';
            if (result) {
              if (result.status === 200) bgColor = 'bg-success';
              else bgColor = 'bg-warning';
            }
            return (
              <div 
                key={i} 
                className={`h-8 rounded ${bgColor} transition-colors duration-300 flex items-center justify-center text-xs text-white/90`}
                title={result ? `Status: ${result.status}` : 'Pending'}
              >
                {result ? result.status : ''}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ConcurrencyDemo;
