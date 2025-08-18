/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Proxy REST calls to your API (dev)
      { source: '/api/:path*', destination: 'http://localhost:4002/:path*' },

      // Proxy Socket.io upgrade requests (dev)
      { source: '/socket.io/:path*', destination: 'http://localhost:4002/socket.io/:path*' },
    ];
  },
};

export default nextConfig;
