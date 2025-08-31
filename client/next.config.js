/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don’t fail Docker builds on lint or TS issues
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // Optional but recommended for smaller images
  output: 'standalone',
};

module.exports = nextConfig;
