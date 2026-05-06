import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ['@prisma/client', 'prisma', 'keytar'],
};

export default nextConfig;
