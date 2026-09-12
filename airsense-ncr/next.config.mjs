import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  // This app lives inside a larger repo that has its own package-lock.json at the
  // root, so Next infers the wrong workspace root and warns during build. Pin the
  // tracing root to this directory.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
