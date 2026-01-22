import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Vite configuration for building the sandbox preload bundle
// This bundles all frontend packages into a single IIFE for use in the iframe sandbox
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/renderer/sandbox-preload.ts'),
      name: 'SandboxPreload',
      formats: ['iife'],
      fileName: () => 'sandbox-preload.js',
    },
    rollupOptions: {
      output: {
        // Ensure everything is bundled into one file
        inlineDynamicImports: true,
        // Global variable name for the bundle
        name: 'SandboxPreload',
      },
    },
    // Minify with esbuild (bundled with Vite)
    minify: 'esbuild',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
