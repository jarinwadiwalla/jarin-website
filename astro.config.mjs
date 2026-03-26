// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// Deployed on Cloudflare Pages (static site + Pages Functions for API)
// Cloudflare Access protects /guru/* and /api/* paths
export default defineConfig({
  output: 'static',
  site: 'https://jarinwadiwalla.com',
  vite: {
    plugins: [tailwindcss()],
  },
});
