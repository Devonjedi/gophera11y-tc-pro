/** @type {import('next').NextConfig} */
const nextConfig = {
  // Rewrites to proxy API and Socket.IO calls to the Render API backend.
  async rewrites() {
    const apiOrigin =
      process.env.NEXT_PUBLIC_API_ORIGIN || 'https://gophera11y-api.onrender.com';
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${apiOrigin}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
