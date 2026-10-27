/**
 * dirk_lib's DUI pages: self-contained React pages (their own React, Mantine and dirk-cfx-react - a DUI is its own browser),
 * drawn into the world by Lua. Kept OUT of build/ (the panel's build empties it).
 *
 *   world prompt plate: dui/prompt -> dui/prompt/build/index.html   (lib.prompt, modules/prompt/client.lua)
 *
 *   pnpm build:dui
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'dui/prompt'),
  base: './',
  plugins: [react()],
  publicDir: false,
  resolve: {
    // UNTIL dirk-cfx-react with WorldPrompt is published: the local build (OTHER_PROJECTS/dirk-cfx-react-src), its peers
    // (React, Mantine, motion, icons) from here - one copy each. Then: drop this alias + bump the dependency.
    dedupe: ['react', 'react-dom', '@mantine/core', '@mantine/hooks', 'framer-motion', 'lucide-react'],
    alias: {
      'dirk-cfx-react': path.resolve(__dirname, '../../../OTHER_PROJECTS/dirk-cfx-react-src/dist/index.js'),
      // the house fonts ship inside dirk-cfx-react; its package exports only expose js, so the css reaches them by path
      '@cfxfonts': path.resolve(__dirname, 'node_modules/dirk-cfx-react/dist/fonts'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dui/prompt/build'),
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
  },
});
