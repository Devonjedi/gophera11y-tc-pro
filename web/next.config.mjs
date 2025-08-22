// /next.config.mjs
/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  async rewrites() {
    const apiOrigin =
      process.env.NEXT_PUBLIC_API_ORIGIN ||
      process.env.NEXT_PUBLIC_API_URL ||
      'https://gophera11y-api.onrender.com';
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
  reactStrictMode: true,
};

export default nextConfig;
