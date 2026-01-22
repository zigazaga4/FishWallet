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
      '@components': resolve(__dirname, 'src/renderer/components')
    }
  },
  server: {
    strictPort: false
  }
});
