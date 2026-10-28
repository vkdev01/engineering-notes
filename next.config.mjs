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
const repoName = "spec-tutorial-template";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
