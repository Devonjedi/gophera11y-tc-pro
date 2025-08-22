/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy API and Socket.IO to the Render API backend
  async rewrites() {
    // Use NEXT_PUBLIC_API_ORIGIN if provided; otherwise default to Render API domain
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
