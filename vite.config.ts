import { defineConfig } from 'vite';

// The page is built two ways:
//   npm run build        dist/ for local dev, where `wrangler dev` serves the page and the API together
//   npm run build:pages  dist/ for GitHub Pages (oskarikaile.github.io/ask-the-game/). The API stays
//                        on the Cloudflare Worker, so the page calls it by its full address.
const PAGES = {
  base: '/ask-the-game/',
  apiOrigin: 'https://ask-the-game.portawebia.workers.dev',
};

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? PAGES.base : '/',
  define: { __API_ORIGIN__: JSON.stringify(mode === 'pages' ? PAGES.apiOrigin : '') },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
}));
