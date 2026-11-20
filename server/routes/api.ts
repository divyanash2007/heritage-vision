import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  computeProjectStatistics,
  findMonumentById,
  getKnowledgeBaseValidationReport,
  queryMonuments,
} from '../services/knowledgeBaseService.ts';
import crypto from 'node:crypto';
import {
  getRecognitionServiceStatus,
  resolveSupportedImageFormat,
  runMonumentIdentification,
} from '../services/recognitionService.ts';
import { runGroundedDiscovery } from '../services/discoveryService.ts';
import type {
  CandidateApprovalStatus,
  ConservationAvailabilityFilter,
  DatasetSplit,
} from '../../src/types/heritage.ts';
import {
  getPreservationProfileById,
  queryPreservationProfiles,
} from '../services/preservationService.ts';
import fs from 'node:fs';
import {
  DATASET_ROOT,
  ROOT_DATASET_MANIFEST_CSV_PATH,
  ROOT_DATASET_METADATA_JSON_PATH,
  ROOT_DATASET_SUMMARY_JSON_PATH,
  ROOT_DOWNLOAD_FAILURES_CSV_PATH,
  ROOT_IMAGE_ATTRIBUTIONS_CSV_PATH,
  ROOT_REJECTED_IMAGES_CSV_PATH,
  ROOT_SPLIT_MANIFEST_CSV_PATH,
  approveAndDownloadCandidate,
  computeAndSaveDatasetSummary,
  loadApprovedImages,
  loadDownloadFailures,
  loadRejectedRecords,
  queryApprovedImagesPaginated,
  queryCandidates,
  rejectCandidate,
  removeApprovedImage,
  runDatasetValidation,
  sourceWikimediaForAllMonuments,
  sourceWikimediaForMonument,
} from '../services/datasetService.ts';
import {
  getCollectionProgress,
  pauseCollection,
  resumeCollection,
  retryFailedDownloads,
  startCollection,
} from '../services/collectionManager.ts';
import { buildDirectoryZipBuffer } from '../services/zipExportService.ts';
import { VALID_DATASET_SPLITS } from '../services/datasetValidator.ts';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(
        new Error(
          'Unsupported image format. Please upload a JPEG, PNG, or WebP photograph.'
        )
      );
      return;
    }
    cb(null, true);
  },
});

export const apiRouter = express.Router();

apiRouter.get('/health', async (_req: Request, res: Response) => {
  const recognitionStatus = await getRecognitionServiceStatus();
  res.json({
    status: 'ok',
    service: 'heritage-vision-api',
    milestone: 'openclip-architecture-prepared',
    openClipConnected: recognitionStatus.openClipConnected,
    openClipEndpointConfigured: recognitionStatus.endpointConfigured,
  });
});

apiRouter.get('/recognition/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await getRecognitionServiceStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/stats', (_req: Request, res: Response) => {
  const stats = computeProjectStatistics();
  res.json(stats);
});

apiRouter.get('/knowledge-base/validation', (_req: Request, res: Response) => {
  const report = getKnowledgeBaseValidationReport();
  res.json(report);
});

apiRouter.get('/monuments', (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const unescoStatus =
    typeof req.query.unescoStatus === 'string' ? req.query.unescoStatus : undefined;

  if (search && search.length > 120) {
    res.status(400).json({ error: 'Search query exceeds maximum length of 120 characters.' });
    return;
  }

  const result = queryMonuments({ search, state, category, unescoStatus });
  res.json(result);
});

apiRouter.get('/monuments/:id', (req: Request, res: Response) => {
  const monumentId = String(req.params.id ?? '');
  if (!/^[a-z0-9-]+$/i.test(monumentId)) {
    res.status(400).json({ error: 'Invalid monument identifier format.' });
    return;
  }

  const monument = findMonumentById(monumentId);
  if (!monument) {
    res.status(404).json({ error: `Monument record "${monumentId}" was not found.` });
    return;
  }

  res.json({ monument });
});

const VALID_CONSERVATION_FILTERS = new Set<ConservationAvailabilityFilter>([
  'all',
  'has_current_condition',
  'has_historical_deterioration',
  'has_environmental_threats',
  'has_structural_challenges',
  'has_restoration_initiatives',
  'has_detailed_conservation_notes',
  'pending_current_condition',
]);

apiRouter.get('/preservation', (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const location = typeof req.query.location === 'string' ? req.query.location : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const unescoStatus =
    typeof req.query.unescoStatus === 'string' ? req.query.unescoStatus : undefined;
  const rawFilter =
    typeof req.query.conservationFilter === 'string' ? req.query.conservationFilter : 'all';

  if (search && search.length > 120) {
    res.status(400).json({ error: 'Search query exceeds maximum length of 120 characters.' });
    return;
  }

  const conservationFilter: ConservationAvailabilityFilter = VALID_CONSERVATION_FILTERS.has(
    rawFilter as ConservationAvailabilityFilter
  )
    ? (rawFilter as ConservationAvailabilityFilter)
    : 'all';

  const result = queryPreservationProfiles({
    search,
    location,
    category,
    unescoStatus,
    conservationFilter,
  });
  res.json(result);
});

apiRouter.get('/preservation/:id', (req: Request, res: Response) => {
  const monumentId = String(req.params.id ?? '');
  if (!/^[a-z0-9-]+$/i.test(monumentId)) {
    res.status(400).json({ error: 'Invalid monument identifier format.' });
    return;
  }

  const profile = getPreservationProfileById(monumentId);
  if (!profile) {
    res.status(404).json({ error: `Preservation profile "${monumentId}" was not found.` });
    return;
  }

  res.json({ profile });
});

apiRouter.post(
  '/identify',
  upload.single('image'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      const bodyRequestId =
        req.body && typeof req.body === 'object' && 'requestId' in req.body
          ? String((req.body as { requestId?: unknown }).requestId ?? '').trim()
          : '';
      const headerRequestId = String(req.header('x-request-id') ?? '').trim();
      const requestId =
        (bodyRequestId && /^[a-z0-9-]{4,64}$/i.test(bodyRequestId) && bodyRequestId) ||
        (headerRequestId && /^[a-z0-9-]{4,64}$/i.test(headerRequestId) && headerRequestId) ||
        crypto.randomUUID();

      if (!file) {
        res.status(400).json({
          requestId,
          error: 'No image file received. Please attach a JPEG, PNG, or WebP photograph.',
        });
        return;
      }

      const imageFormat = resolveSupportedImageFormat(file.mimetype);
      const result = await runMonumentIdentification({
        requestId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        imageFormat: imageFormat ?? undefined,
        sizeBytes: file.size,
        buffer: file.buffer,
      });

      if (result.recognitionStatus === 'invalid_image') {
        res.status(400).json({
          ...result,
          error: result.imageValidation.validationError ?? result.explanation,
        });
        return;
      }

      if (result.recognitionStatus === 'timeout') {
        res.status(504).json({
          ...result,
          error: result.explanation,
        });
        return;
      }

      if (result.recognitionStatus === 'upstream_error') {
        res.status(502).json({
          ...result,
          error: result.explanation,
        });
        return;
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

apiRouter.post('/discover', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as
      | {
          monumentId?: unknown;
          question?: unknown;
          sessionMonumentIds?: unknown;
        }
      | undefined;

    const rawMonumentId =
      typeof body?.monumentId === 'string' ? body.monumentId.trim() : 'auto';
    const monumentId = rawMonumentId || 'auto';
    const question = typeof body?.question === 'string' ? body.question.trim() : '';

    if (monumentId !== 'auto' && !/^[a-z0-9-]+$/i.test(monumentId)) {
      res.status(400).json({ error: 'Invalid monument identifier format.' });
      return;
    }

    if (!question || question.length < 4) {
      res.status(400).json({
        error: 'Please enter a specific question (at least 4 characters).',
      });
      return;
    }

    if (question.length > 500) {
      res.status(400).json({
        error: 'Question exceeds the maximum length of 500 characters.',
      });
      return;
    }

    let pinnedMonument = null;
    if (monumentId !== 'auto') {
      pinnedMonument = findMonumentById(monumentId);
      if (!pinnedMonument) {
        res.status(404).json({ error: `Monument "${monumentId}" was not found in the schema.` });
        return;
      }
    }

    const sessionMonumentIds = Array.isArray(body?.sessionMonumentIds)
      ? body.sessionMonumentIds
          .filter((id): id is string => typeof id === 'string' && /^[a-z0-9-]+$/i.test(id))
          .slice(0, 5)
      : [];

    const discoveryResult = await runGroundedDiscovery({
      monument: pinnedMonument,
      monumentId,
      question,
      sessionMonumentIds,
    });
    res.status(200).json(discoveryResult);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// Dataset Preparation & Human Review API
// ==========================================

apiRouter.get('/dataset/summary', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await computeAndSaveDatasetSummary();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/dataset/validate', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await runDatasetValidation();
    res.json(report);
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/dataset/collection/status', (_req: Request, res: Response) => {
  res.json({ progress: getCollectionProgress() });
});

apiRouter.post('/dataset/collection/start', (req: Request, res: Response) => {
  const body = req.body as
    | {
        mode?: unknown;
        targetPerMonument?: unknown;
        unknownTarget?: unknown;
        siteId?: unknown;
      }
    | undefined;

  const mode =
    body?.mode === 'single_monument' ||
    body?.mode === 'unknown_only' ||
    body?.mode === 'retry_failures'
      ? body.mode
      : 'all_monuments';
  const targetPerMonument =
    typeof body?.targetPerMonument === 'number'
      ? Math.min(Math.max(body.targetPerMonument, 5), 150)
      : 50;
  const unknownTarget =
    typeof body?.unknownTarget === 'number'
      ? Math.min(Math.max(body.unknownTarget, 10), 120)
      : 40;
  const siteId = typeof body?.siteId === 'string' ? body.siteId.trim() : undefined;

  const progress = startCollection({ mode, targetPerMonument, unknownTarget, siteId });
  res.json({ progress });
});

apiRouter.post('/dataset/collection/pause', (_req: Request, res: Response) => {
  res.json({ progress: pauseCollection() });
});

apiRouter.post('/dataset/collection/resume', (_req: Request, res: Response) => {
  res.json({ progress: resumeCollection() });
});

apiRouter.post(
  '/dataset/collection/retry-failures',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await retryFailedDownloads();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

apiRouter.get('/dataset/candidates', (req: Request, res: Response) => {
  const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const page = typeof req.query.page === 'string' ? Number(req.query.page) : 1;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 24;

  const result = queryCandidates({
    siteId,
    status: (status as CandidateApprovalStatus | 'all') ?? 'all',
    search,
    page: Number.isFinite(page) ? page : 1,
    limit: Number.isFinite(limit) ? limit : 24,
  });

  res.json(result);
});

apiRouter.get('/dataset/rejected', (_req: Request, res: Response) => {
  const rejected = loadRejectedRecords();
  const failures = loadDownloadFailures();
  res.json({ rejected, failures });
});

apiRouter.post('/dataset/source', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as
      | {
          siteId?: unknown;
          query?: unknown;
          limit?: unknown;
          targetSplit?: unknown;
        }
      | undefined;

    const siteId = typeof body?.siteId === 'string' ? body.siteId.trim() : '';
    if (!siteId || !/^[a-z0-9-]+$/i.test(siteId)) {
      res.status(400).json({ error: 'A valid monument siteId (or "unknown") is required.' });
      return;
    }

    const query = typeof body?.query === 'string' ? body.query.trim() : undefined;
    const limit = typeof body?.limit === 'number' ? body.limit : 12;
    const rawSplit = typeof body?.targetSplit === 'string' ? (body.targetSplit as DatasetSplit) : undefined;
    if (rawSplit && !VALID_DATASET_SPLITS.has(rawSplit)) {
      res.status(400).json({ error: 'Invalid targetSplit specified.' });
      return;
    }

    const result = await sourceWikimediaForMonument({
      siteId,
      query,
      limit,
      targetSplit: rawSplit,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

apiRouter.post('/dataset/source-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { limitPerMonument?: unknown } | undefined;
    const limitPerMonument =
      typeof body?.limitPerMonument === 'number'
        ? Math.min(Math.max(body.limitPerMonument, 1), 10)
        : 4;
    const result = await sourceWikimediaForAllMonuments(limitPerMonument);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

apiRouter.post(
  '/dataset/candidates/:candidateId/approve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const candidateId = String(req.params.candidateId ?? '').trim();
      if (!candidateId) {
        res.status(400).json({ error: 'Missing candidateId.' });
        return;
      }

      const body = req.body as { split?: unknown } | undefined;
      const split =
        typeof body?.split === 'string' ? (body.split as DatasetSplit) : undefined;
      if (split && !VALID_DATASET_SPLITS.has(split)) {
        res.status(400).json({ error: `Invalid dataset split "${String(split)}".` });
        return;
      }

      const result = await approveAndDownloadCandidate(candidateId, split);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

apiRouter.post(
  '/dataset/candidates/:candidateId/reject',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const candidateId = String(req.params.candidateId ?? '').trim();
      if (!candidateId) {
        res.status(400).json({ error: 'Missing candidateId.' });
        return;
      }
      const body = req.body as { reason?: unknown } | undefined;
      const reason = typeof body?.reason === 'string' ? body.reason : undefined;
      const result = await rejectCandidate(candidateId, reason);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

apiRouter.get('/dataset/approved', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
    const split = typeof req.query.split === 'string' ? req.query.split : undefined;
    const licence = typeof req.query.licence === 'string' ? req.query.licence : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const page = typeof req.query.page === 'string' ? Number(req.query.page) : 1;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 24;

    const paginated = queryApprovedImagesPaginated({
      siteId,
      split: (split as DatasetSplit | 'all') ?? 'all',
      licence,
      search,
      page: Number.isFinite(page) ? page : 1,
      limit: Number.isFinite(limit) ? limit : 24,
    });
    const validation = await runDatasetValidation();
    res.json({ ...paginated, validation });
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/dataset/export/zip', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const zipBuffer = buildDirectoryZipBuffer(DATASET_ROOT, 'heritage_vision_dataset');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="heritage_vision_dataset.zip"');
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/dataset/export/:kind', (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = String(req.params.kind ?? 'json');
    const fileMap: Record<string, { filePath: string; contentType: string; downloadName: string }> = {
      json: {
        filePath: ROOT_DATASET_METADATA_JSON_PATH,
        contentType: 'application/json; charset=utf-8',
        downloadName: 'dataset_metadata.json',
      },
      summary: {
        filePath: ROOT_DATASET_SUMMARY_JSON_PATH,
        contentType: 'application/json; charset=utf-8',
        downloadName: 'dataset_summary.json',
      },
      csv: {
        filePath: ROOT_DATASET_MANIFEST_CSV_PATH,
        contentType: 'text/csv; charset=utf-8',
        downloadName: 'dataset_manifest.csv',
      },
      attributions: {
        filePath: ROOT_IMAGE_ATTRIBUTIONS_CSV_PATH,
        contentType: 'text/csv; charset=utf-8',
        downloadName: 'image_attributions.csv',
      },
      splits: {
        filePath: ROOT_SPLIT_MANIFEST_CSV_PATH,
        contentType: 'text/csv; charset=utf-8',
        downloadName: 'split_manifest.csv',
      },
      rejected: {
        filePath: ROOT_REJECTED_IMAGES_CSV_PATH,
        contentType: 'text/csv; charset=utf-8',
        downloadName: 'rejected_images.csv',
      },
      failures: {
        filePath: ROOT_DOWNLOAD_FAILURES_CSV_PATH,
        contentType: 'text/csv; charset=utf-8',
        downloadName: 'download_failures.csv',
      },
    };

    const target = fileMap[kind];
    if (!target) {
      res.status(400).json({ error: `Unknown export type "${kind}".` });
      return;
    }

    if (!fs.existsSync(target.filePath)) {
      const images = loadApprovedImages();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${target.downloadName}"`);
      res.send(`${JSON.stringify(images, null, 2)}\n`);
      return;
    }

    res.setHeader('Content-Type', target.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${target.downloadName}"`);
    res.sendFile(target.filePath);
  } catch (error) {
    next(error);
  }
});

apiRouter.delete(
  '/dataset/approved/:imageId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const imageId = String(req.params.imageId ?? '').trim();
      if (!imageId) {
        res.status(400).json({ error: 'Missing imageId.' });
        return;
      }
      const result = await removeApprovedImage(imageId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);


// Multer & API error handler
apiRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: 'Image file exceeds the 10 MB upload limit. Please select a smaller photograph.',
      });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }

  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(500).json({ error: 'An unexpected server error occurred.' });
});
