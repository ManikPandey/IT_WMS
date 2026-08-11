import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('role', data.user.role);
        localStorage.setItem('name', data.user.name);
        navigate('/');
      } else {
        alert('Login failed');
      }
    } catch (err) {
      console.error(err);
      alert('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="bg-background border border-border p-8 rounded-lg w-full max-w-sm shadow-sm">
        <h1 className="text-2xl font-bold text-center mb-6">IT_WMS Login</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Email</label>
            <input 
              type="email" 
              required
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@test.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Password</label>
            <input 
              type="password"
              required
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="admin123"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Logging in...' : 'Sign In'}
          </Button>
        </form>
      </div>
    </div>
  );
}
