/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4002';
    return [
      {
        source: '/api/:path*',
        destination: `${api}/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${api}/socket.io/:path*`,
      },
    ];
  },
};
export default nextConfig;
