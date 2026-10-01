// Build da versão de teste (roda 100% no navegador, sem servidor)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const dbLocal = path.resolve(__dirname, 'src/demo/db-local.js');
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'banco-no-navegador',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (importer && importer.includes('/server/') && /(^|\/)db\.js$/.test(source)) return dbLocal;
        if (source === 'csv-parse/sync') return path.resolve(__dirname, '../node_modules/csv-parse/dist/esm/sync.js');
        return null;
      },
    },
  ],
  define: { 'process.env': '{}' },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { outDir: 'dist-teste', emptyOutDir: true, chunkSizeWarningLimit: 5000, rollupOptions: { input: path.resolve(__dirname, 'demo.html'),
    // o visualizador de artefatos não serve .data: publica o pacote de arquivos do Postgres como .wasm (é só binário)
    output: { assetFileNames: (a) => ((a.names?.[0] || a.name || '').endsWith('.data') ? 'assets/[name]-[hash].data.wasm' : 'assets/[name]-[hash][extname]') } }, target: 'es2022' },
  worker: { format: 'es' },
});
