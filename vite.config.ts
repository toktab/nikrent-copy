import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // SheetJS ships CommonJS; pre-bundling it keeps dev-server imports fast and stable.
  optimizeDeps: { include: ['xlsx'] },
});
