/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  agentRules: false,
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: [
    '@google-cloud/bigquery',
    'node-cron',
    'oracledb',
  ],
};

export default nextConfig;
