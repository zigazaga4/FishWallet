import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

// Vite configuration for the renderer process (React frontend)
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@components': resolve(__dirname, 'src/renderer/components'),
      // Force onnxruntime-web to the WASM-only bundle (no WebGPU/JSEP).
      // This build inlines the Emscripten glue code so no dynamic .mjs imports.
      'onnxruntime-web': resolve(
        __dirname,
        'node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs'
      ),
    }
  },
  optimizeDeps: {
    // Prevent Vite from pre-bundling onnxruntime-web (breaks import.meta.url patterns)
    exclude: ['onnxruntime-web']
  },
  server: {
    strictPort: false
  },
  // Since root is src/renderer, Vite defaults to src/renderer/public/.
  // Our public assets (ONNX models, WASM files) are in project-root public/.
  publicDir: resolve(__dirname, 'public')
});
