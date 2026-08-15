export const fetchWithAuth = async (url, options = {}) => {
  let token = localStorage.getItem('token');
  const headers = { ...options.headers };
  
  // Only append JSON content type if it's not FormData
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  } else {
    // If it's FormData, let the browser set Content-Type (with boundary)
    delete headers['Content-Type'];
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res = await fetch(url, { ...options, headers });

  if (res.status === 401 || res.status === 403) {
    // Try to refresh token
    const refreshToken = localStorage.getItem('refreshToken');
    const userId = localStorage.getItem('userId');
    
    if (refreshToken && userId) {
      const refreshRes = await fetch(`${import.meta.env.VITE_API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken, userId })
      });
      
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        localStorage.setItem('token', data.token);
        localStorage.setItem('refreshToken', data.refreshToken);
        
        // Retry original request
        headers['Authorization'] = `Bearer ${data.token}`;
        res = await fetch(url, { ...options, headers });
      } else {
        // Refresh failed, clear and force login
        localStorage.clear();
        window.location.href = '/login';
      }
    } else {
      localStorage.clear();
      window.location.href = '/login';
    }
  }

  return res;
};
