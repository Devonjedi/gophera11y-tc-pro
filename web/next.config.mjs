// /next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiOrigin =
      process.env.NEXT_PUBLIC_API_ORIGIN || 'https://gophera11y-api.onrender.com';
    return [
      {
        // Proxy API requests (e.g. /api/scan) to backend
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
      {
        // Proxy Socket.IO endpoint
        source: '/socket.io/:path*',
        destination: `${apiOrigin}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
