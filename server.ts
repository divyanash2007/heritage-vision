import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '1mb' }));

  // Serve verified local dataset photographs from canonical dataset/<Monument_Folder>/<split>/ directory
  app.use('/dataset-images', express.static(path.resolve(__dirname, 'dataset')));

  // Backend API routes kept strictly separate from frontend assets
  app.use('/api', apiRouter);

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`HERITAGE VISION server running at http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start HERITAGE VISION server:', err);
  process.exit(1);
});
