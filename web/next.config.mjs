/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Use NEXT_PUBLIC_API_URL or NEXT_PUBLIC_API_ORIGIN to determine API base.
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.NEXT_PUBLIC_API_ORIGIN ||
      'https://gophera11y-api.onrender.com';
    return [
      // Proxy API requests (e.g. /api/scan) to backend
      { source: '/api/:path*', destination: `${apiBase}/:path*` },
      // Proxy socket.io websocket/polling requests
      { source: '/socket.io/:path*', destination: `${apiBase}/socket.io/:path*` },
    ];
  },
};
export default nextConfig;
