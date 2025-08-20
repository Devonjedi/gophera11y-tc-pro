/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Use environment var or fallback to your Render API
    const apiOrigin =
      process.env.NEXT_PUBLIC_API_ORIGIN || 'https://gophera11y-api.onrender.com';
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
      {
        // Proxy socket.io path to the backend; required for same-origin WebSocket handshake.
        source: '/socket.io/:path*',
        destination: `${apiOrigin}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
