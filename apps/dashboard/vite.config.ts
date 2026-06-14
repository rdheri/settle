import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs on :3000 by default; the dashboard proxies /api to it so the
// browser never has to deal with CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
