/** @type {import('next').NextConfig} */
const nextConfig = {
  // Rewrites only API requests; websockets go directly to the API origin
  async rewrites() {
    const apiOrigin =
      process.env.NEXT_PUBLIC_API_ORIGIN || 'https://gophera11y-api.onrender.com';
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
s
