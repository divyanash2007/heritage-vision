import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '1mb' }));

  // Serve verified local dataset photographs from canonical dataset/<Monument_Folder>/<split>/ directory
  app.use('/dataset-images', express.static(path.resolve(__dirname, 'dataset')));

  // Bridge proxy to Python recognition backend on internal port 8000
  const handleRecognitionStatus = async (_req: express.Request, res: express.Response) => {
    try {
      const pyRes = await fetch('http://127.0.0.1:8000/', { signal: AbortSignal.timeout(5000) });
      const data = await pyRes.json();
      res.status(pyRes.status).json(data);
    } catch (err: any) {
      res.status(503).json({
        project: 'HERITAGE VISION',
        status: 'Recognition service starting or offline',
        recognition_engine: null,
        monuments: [],
        error: err.message,
      });
    }
  };

  app.get('/recognize/status', handleRecognitionStatus);
  app.get('/api/recognize-status', handleRecognitionStatus);

  const handleRecognizeProxy = async (req: express.Request, res: express.Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
      }

      const formData = new FormData();
      formData.append(
        'file',
        new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
        file.originalname || 'uploaded.jpg'
      );

      const pyRes = await fetch('http://127.0.0.1:8000/recognize', {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30000),
      });

      const data = await pyRes.json();
      res.status(pyRes.status).json(data);
    } catch (err: any) {
      res.status(502).json({
        error: `Recognition service error: ${err.message}`,
      });
    }
  };

  app.post('/recognize', upload.single('file'), handleRecognizeProxy);
  app.post('/api/recognize', upload.single('file'), handleRecognizeProxy);

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
