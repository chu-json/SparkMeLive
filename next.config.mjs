/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // AWS SDK packages must run in Node.js runtime, not be bundled by webpack.
    // Next.js 14 uses experimental.serverComponentsExternalPackages for this.
    serverComponentsExternalPackages: [
      "@aws-sdk/client-s3",
      "@aws-sdk/client-transcribe",
    ],
  },
};

export default nextConfig;
