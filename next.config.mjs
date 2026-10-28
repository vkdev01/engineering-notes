/**
 * Two build modes:
 *
 *   npm run build                     → normal server build (chat API works)
 *   GITHUB_PAGES=1 npm run build      → static export for GitHub Pages
 *
 * In Pages mode the app is served from /<repo>/, so basePath is set. The
 * chat route lives in app/api and must be moved aside before exporting —
 * see .github/workflows/pages.yml.
 */
const isPages = process.env.GITHUB_PAGES === "1";
const repoName = "engineering-notes";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // "" locally, "/engineering-notes" on Pages. Markdown links are raw anchors,
    // so they have to be prefixed by hand rather than by next/link.
    NEXT_PUBLIC_BASE_PATH: isPages ? `/${repoName}` : "",
  },
  ...(isPages
    ? {
        output: "export",
        trailingSlash: true,
        basePath: `/${repoName}`,
        assetPrefix: `/${repoName}/`,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
