/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@google-cloud/bigquery',
    'node-cron',
    'oracledb',
  ],
};

export default nextConfig;
