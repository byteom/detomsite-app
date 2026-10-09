import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Single React instance: shopkeeper/ sits inside frontend/ which has its
    // own node_modules/react. Without dedupe, Vite can resolve some files to
    // the parent copy and others to the nested copy -> two React instances ->
    // "Cannot read properties of null (reading 'useState')" (dispatcher null).
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    host: true, // listen on all network interfaces so a phone on the same Wi-Fi can open the vendor app
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-utils': ['axios'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'axios'],
  },
})
