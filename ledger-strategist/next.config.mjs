/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prisma needs to stay external to the server bundle
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
