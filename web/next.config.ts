import type { NextConfig } from "next";

// Static export: the site is plain files in S3 behind CloudFront. The API base
// URL is read at runtime from /config.json (written by Terraform), so one build
// works in every environment.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
