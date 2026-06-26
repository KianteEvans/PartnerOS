import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // node-saml / xml-crypto / @xmldom use dynamic requires that Next's bundler
  // mangles; keep them external so the SAML routes load them at runtime (Node).
  serverExternalPackages: ["@node-saml/node-saml", "xml-crypto", "@xmldom/xmldom"],
  typescript: {
    // Type errors fail the build; never ignore.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  experimental: {
    // Server Actions are used by the mutation gate; keep body limits explicit.
    // Evidence file uploads pass through a Server Action, so the limit is sized
    // for documents (PDFs, case studies). Larger files would use direct-to-S3
    // presigned uploads (not in this slice).
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
