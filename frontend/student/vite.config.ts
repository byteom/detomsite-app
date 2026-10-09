import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // allow a phone on the same Wi-Fi to open the student portal
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
    minify: 'terser' as const,
    rollupOptions: {
      output: {
        // SSR externalizes React, so Rollup rejects package names in
        // manualChunks during the smoke build. Keep vendor splitting for the
        // browser bundle and let SSR retain its normal externals.
        ...(isSsrBuild ? {} : {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-utils': ['axios'],
          },
        }),
      },
    },
    chunkSizeWarningLimit: 600,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'axios'],
  },
}))
