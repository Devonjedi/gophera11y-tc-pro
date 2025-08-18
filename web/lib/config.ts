// web/lib/config.ts
export const API_CONFIG = {
  // Use environment variable or fallback to your actual API URL
  BASE_URL: process.env.NEXT_PUBLIC_API_URL || 'https://gophera11y-api.onrender.com',

  // For Socket.io connections
  SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || 'https://gophera11y-api.onrender.com',
};

// Helper function for API calls
export const getApiUrl = (endpoint: string = '') => {
  return `${API_CONFIG.BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
};
