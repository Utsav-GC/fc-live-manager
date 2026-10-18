import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = path.dirname(fileURLToPath(import.meta.url));

// The renderer is a React + Tailwind app, but Electron loads it straight from
// disk (file://) - so we build a single classic-script IIFE bundle instead of
// an ES-module page. src/renderer/index.html links ./dist/bundle.{js,css}.
export default defineConfig({
  root: path.join(root, 'src/renderer'),
  base: './',
  // Library mode leaves process.env.NODE_ENV alone; the Electron renderer has
  // no `process`, so pin it to production at build time.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(root, 'src/renderer/src') } },
  build: {
    outDir: path.join(root, 'src/renderer/dist'),
    emptyOutDir: true,
    target: 'chrome130',
    assetsInlineLimit: 0,
    lib: {
      entry: path.join(root, 'src/renderer/src/main.jsx'),
      formats: ['iife'],
      name: 'SetlistUI',
      fileName: () => 'bundle.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: (info) =>
          info.names && info.names.some((n) => n.endsWith('.css'))
            ? 'bundle.css'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
