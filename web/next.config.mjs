/** @type {import('next').NextConfig} */

// Choose API origin from env, with sane dev/prod fallbacks
const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN ??
  (process.env.NODE_ENV === 'development'
    ? 'http://localhost:4002'
    : 'https://gophera11y-api.onrender.com');

const nextConfig = {
  reactStrictMode: true,

  // Proxy REST calls and (when self-hosting) Socket.IO to the API server.
  async rewrites() {
    return [
      // e.g. fetch('/api/scan') -> ${API_ORIGIN}/scan
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/:path*`,
      },
      // NOTE: WebSocket proxying here works when self-hosting Next.
      // On Vercel, connect directly to API_ORIGIN from the client for Socket.IO.
      {
        source: '/socket.io/:path*',
        destination: `${API_ORIGIN}/socket.io/:path*`,
      },
    ];
  },

  // Optional: a few security headers to quiet browser warnings
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '0' },
        ],
      },
    ];
  },
};

export default nextConfig;
