import type {
  ApprovedDatasetImage,
  DatasetSplit,
  DatasetValidationReport,
} from '../types/heritage';
import {
  computeContentHash,
  findDuplicateHashesInDataset,
  validateDatasetCandidate,
  type DatasetCandidateValidationReport,
  type ExistingContentRecord,
} from './datasetValidation';
import { searchImagesForMonument, type WikiMonumentImage } from './wikiService';

export interface WikiBatchTarget {
  siteId: string;
  monumentName: string;
  queries?: string[];
  targetSplit?: DatasetSplit;
  maxResultsPerQuery?: number;
  includePublicDomain?: boolean;
}

export interface BatchedWikiQueryResult {
  siteId: string;
  monumentName: string;
  candidates: WikiMonumentImage[];
  queriesExecuted: string[];
  errors: Array<{ query: string; message: string; attempts: number }>;
}

export interface OrchestratorDownloadTask {
  taskId: string;
  siteId: string;
  monumentName: string;
  targetSplit: DatasetSplit;
  candidate: WikiMonumentImage;
}

export interface DownloadedValidatedItem {
  task: OrchestratorDownloadTask;
  sha256Hash: string;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  attempts: number;
  validation: DatasetCandidateValidationReport;
  buffer: Uint8Array;
}

export interface DownloadTaskFailure {
  taskId: string;
  siteId: string;
  commonsTitle: string;
  url: string;
  attempts: number;
  httpStatus: number | null;
  retryable: boolean;
  errorMessage: string;
}

export interface OrchestratorProgressSnapshot {
  phase: 'idle' | 'batched_api' | 'concurrent_download' | 'sha256_audit' | 'completed' | 'aborted';
  apiBatchesCompleted: number;
  apiBatchesTotal: number;
  candidatesDiscovered: number;
  downloadsTotal: number;
  downloadsSucceeded: number;
  downloadsFailed: number;
  downloadsRejectedValidation: number;
  duplicatesBlocked: number;
  currentMessage: string;
}

export interface DatasetOrchestratorOptions {
  apiBatchSize?: number;
  interBatchDelayMs?: number;
  maxApiRetries?: number;
  downloadConcurrency?: number;
  maxDownloadRetries?: number;
  downloadTimeoutMs?: number;
  preferThumbnailForLargeFiles?: boolean;
  minWidth?: number;
  minHeight?: number;
  maxBytes?: number;
  validSiteIds?: Set<string>;
  existingRecords?: ExistingContentRecord[];
  signal?: AbortSignal;
  onProgress?: (snapshot: OrchestratorProgressSnapshot) => void;
}

export interface DatasetIntegrityAuditResult {
  auditedAt: string;
  totalRecords: number;
  uniqueSha256Hashes: number;
  duplicateGroups: Array<{
    primaryImageId: string;
    duplicateImageId: string;
    sha256Hash: string;
    crossSplitLeak: boolean;
  }>;
  missingHashCount: number;
  serverValidation: DatasetValidationReport | null;
  isIntegrityValid: boolean;
  summaryMessage: string;
}

export interface DatasetOrchestrationReport {
  startedAt: string;
  completedAt: string;
  aborted: boolean;
  batchedResults: BatchedWikiQueryResult[];
  verifiedDownloads: DownloadedValidatedItem[];
  failures: DownloadTaskFailure[];
  rejectedValidations: Array<{
    taskId: string;
    siteId: string;
    title: string;
    reasons: string[];
  }>;
  duplicatesBlocked: number;
  progress: OrchestratorProgressSnapshot;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Operation aborted', 'AbortError'));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException('Operation aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function isRetryableHttpStatus(status: number | null): boolean {
  if (status === null) return true; // Network / timeout failure
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function computeBackoffDelayMs(attempt: number, baseMs = 600): number {
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(baseMs * Math.pow(2, attempt) + jitter, 12_000);
}

/**
 * Executes a single Wikimedia Commons search query with bounded retries and exponential backoff.
 */
async function searchCommonsWithRetry(
  query: string,
  options: {
    limit: number;
    includePublicDomain: boolean;
    maxRetries: number;
    signal?: AbortSignal;
  }
): Promise<{ images: WikiMonumentImage[]; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted Wikimedia API request', 'AbortError');
    }
    try {
      const images = await searchImagesForMonument(query, {
        limit: options.limit,
        thumbnailWidth: 1200,
        includePublicDomain: options.includePublicDomain,
      });
      return { images, attempts: attempt + 1 };
    } catch (err) {
      lastError = err;
      if (isAbortError(err) || attempt === options.maxRetries) {
        break;
      }
      await sleep(computeBackoffDelayMs(attempt, 800), options.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Wikimedia Commons API query failed');
}

/**
 * Handles batched Wikimedia Commons MediaWiki API requests across target monuments,
 * deduplicating page IDs within each monument class and surfacing per-query errors cleanly.
 */
export async function executeBatchedWikiRequests(
  targets: WikiBatchTarget[],
  options: DatasetOrchestratorOptions = {}
): Promise<BatchedWikiQueryResult[]> {
  const batchSize = Math.min(Math.max(options.apiBatchSize ?? 3, 1), 6);
  const interBatchDelayMs = Math.max(options.interBatchDelayMs ?? 250, 0);
  const maxRetries = Math.min(Math.max(options.maxApiRetries ?? 2, 0), 5);

  const outputBySite = new Map<string, BatchedWikiQueryResult>();
  const seenPagesBySite = new Map<string, Set<number>>();

  for (const target of targets) {
    outputBySite.set(target.siteId, {
      siteId: target.siteId,
      monumentName: target.monumentName,
      candidates: [],
      queriesExecuted: [],
      errors: [],
    });
    seenPagesBySite.set(target.siteId, new Set<number>());
  }

  const workItems: Array<{
    target: WikiBatchTarget;
    query: string;
    limit: number;
    includePublicDomain: boolean;
  }> = [];

  for (const target of targets) {
    const queries =
      target.queries && target.queries.length > 0 ? target.queries : [target.monumentName];
    const limit = Math.min(Math.max(target.maxResultsPerQuery ?? 12, 1), 25);
    const includePublicDomain = target.includePublicDomain ?? true;
    for (const q of queries) {
      workItems.push({ target, query: q, limit, includePublicDomain });
    }
  }

  const totalBatches = Math.max(1, Math.ceil(workItems.length / batchSize));
  let totalCandidates = 0;

  for (let start = 0; start < workItems.length; start += batchSize) {
    if (options.signal?.aborted) break;

    const batch = workItems.slice(start, start + batchSize);
    const batchIdx = Math.floor(start / batchSize) + 1;

    options.onProgress?.({
      phase: 'batched_api',
      apiBatchesCompleted: batchIdx - 1,
      apiBatchesTotal: totalBatches,
      candidatesDiscovered: totalCandidates,
      downloadsTotal: 0,
      downloadsSucceeded: 0,
      downloadsFailed: 0,
      downloadsRejectedValidation: 0,
      duplicatesBlocked: 0,
      currentMessage: `Executing Wikimedia API batch ${batchIdx}/${totalBatches} (${batch.map((b) => b.target.monumentName).join(', ')})`,
    });

    await Promise.all(
      batch.map(async (item) => {
        const resultBucket = outputBySite.get(item.target.siteId)!;
        const seenPages = seenPagesBySite.get(item.target.siteId)!;
        resultBucket.queriesExecuted.push(item.query);

        try {
          const { images } = await searchCommonsWithRetry(item.query, {
            limit: item.limit,
            includePublicDomain: item.includePublicDomain,
            maxRetries,
            signal: options.signal,
          });

          for (const img of images) {
            if (!seenPages.has(img.pageId)) {
              seenPages.add(img.pageId);
              resultBucket.candidates.push(img);
              totalCandidates += 1;
            }
          }
        } catch (err) {
          if (isAbortError(err)) return;
          resultBucket.errors.push({
            query: item.query,
            message: err instanceof Error ? err.message : 'Unknown Wikimedia query error',
            attempts: maxRetries + 1,
          });
        }
      })
    );

    if (start + batchSize < workItems.length && interBatchDelayMs > 0) {
      await sleep(interBatchDelayMs, options.signal);
    }
  }

  return targets.map((t) => outputBySite.get(t.siteId)!);
}

/**
 * Downloads a single binary image URL with timeout protection and retryable error classification.
 */
async function downloadBinaryWithRetries(
  url: string,
  options: {
    timeoutMs: number;
    maxRetries: number;
    signal?: AbortSignal;
  }
): Promise<{
  buffer: Uint8Array;
  contentType: string | null;
  attempts: number;
}> {
  let lastErrorMessage = 'Download failed';
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Download aborted', 'AbortError');
    }

    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), options.timeoutMs);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        lastStatus = response.status;
        lastErrorMessage = `HTTP ${response.status} (${response.statusText || 'Request failed'})`;
        if (!isRetryableHttpStatus(response.status) || attempt === options.maxRetries) {
          throw Object.assign(new Error(lastErrorMessage), {
            httpStatus: lastStatus,
            attempts: attempt + 1,
            retryable: isRetryableHttpStatus(lastStatus),
          });
        }
        await sleep(computeBackoffDelayMs(attempt, 700), options.signal);
        continue;
      }

      const arrayBuf = await response.arrayBuffer();
      const buffer = new Uint8Array(arrayBuf);
      if (buffer.byteLength < 64) {
        throw Object.assign(new Error(`Empty or truncated image body (${buffer.byteLength} bytes)`), {
          httpStatus: response.status,
          attempts: attempt + 1,
          retryable: false,
        });
      }

      return {
        buffer,
        contentType: response.headers.get('content-type')?.split(';')[0]?.trim() || null,
        attempts: attempt + 1,
      };
    } catch (err) {
      if (isAbortError(err) && options.signal?.aborted) {
        throw err;
      }
      const typedErr = err as Error & { httpStatus?: number | null; retryable?: boolean };
      lastErrorMessage = typedErr?.message || 'Network or timeout error';
      lastStatus = typedErr?.httpStatus ?? null;
      const retryable = typedErr?.retryable ?? isRetryableHttpStatus(lastStatus);

      if (!retryable || attempt === options.maxRetries) {
        throw Object.assign(new Error(lastErrorMessage), {
          httpStatus: lastStatus,
          attempts: attempt + 1,
          retryable,
        });
      }
      await sleep(computeBackoffDelayMs(attempt, 700), options.signal);
    } finally {
      globalThis.clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw Object.assign(new Error(lastErrorMessage), {
    httpStatus: lastStatus,
    attempts: options.maxRetries + 1,
    retryable: isRetryableHttpStatus(lastStatus),
  });
}

/**
 * Concurrent worker-pool download manager with exponential backoff retries,
 * automated binary/magic-byte verification, open-licence enforcement,
 * and SHA-256 cryptographic duplicate & cross-split anti-leakage validation.
 */
export async function manageConcurrentDownloads(
  tasks: OrchestratorDownloadTask[],
  options: DatasetOrchestratorOptions = {}
): Promise<{
  verifiedDownloads: DownloadedValidatedItem[];
  failures: DownloadTaskFailure[];
  rejectedValidations: Array<{
    taskId: string;
    siteId: string;
    title: string;
    reasons: string[];
  }>;
  duplicatesBlocked: number;
}> {
  const concurrency = Math.min(Math.max(options.downloadConcurrency ?? 4, 1), 8);
  const maxDownloadRetries = Math.min(Math.max(options.maxDownloadRetries ?? 2, 0), 5);
  const downloadTimeoutMs = Math.min(Math.max(options.downloadTimeoutMs ?? 20_000, 3_000), 60_000);
  const preferThumb = options.preferThumbnailForLargeFiles ?? true;

  // Thread-safe ledger within JS microtask turn for live SHA-256 deduplication across workers
  const knownRecords: ExistingContentRecord[] = [...(options.existingRecords ?? [])];
  const verifiedDownloads: DownloadedValidatedItem[] = [];
  const failures: DownloadTaskFailure[] = [];
  const rejectedValidations: Array<{
    taskId: string;
    siteId: string;
    title: string;
    reasons: string[];
  }> = [];
  let duplicatesBlocked = 0;
  let nextIndex = 0;

  const emitProgress = (message: string) => {
    options.onProgress?.({
      phase: 'concurrent_download',
      apiBatchesCompleted: 1,
      apiBatchesTotal: 1,
      candidatesDiscovered: tasks.length,
      downloadsTotal: tasks.length,
      downloadsSucceeded: verifiedDownloads.length,
      downloadsFailed: failures.length,
      downloadsRejectedValidation: rejectedValidations.length,
      duplicatesBlocked,
      currentMessage: message,
    });
  };

  async function worker(): Promise<void> {
    while (true) {
      if (options.signal?.aborted) return;
      const currentIdx = nextIndex;
      if (currentIdx >= tasks.length) return;
      nextIndex += 1;

      const task = tasks[currentIdx];
      const targetUrl =
        preferThumb && task.candidate.thumbnailUrl
          ? task.candidate.thumbnailUrl
          : task.candidate.originalUrl;

      try {
        const downloaded = await downloadBinaryWithRetries(targetUrl, {
          timeoutMs: downloadTimeoutMs,
          maxRetries: maxDownloadRetries,
          signal: options.signal,
        });

        const validation = await validateDatasetCandidate({
          bytes: downloaded.buffer,
          declaredMimeType: downloaded.contentType ?? task.candidate.mimeType,
          metadata: {
            siteId: task.siteId,
            originalUrl: task.candidate.originalUrl,
            sourcePageUrl: task.candidate.sourcePageUrl,
            licence: task.candidate.licence,
            creator: task.candidate.creator,
            attribution: task.candidate.attribution,
            split: task.targetSplit,
            validSiteIds: options.validSiteIds,
          },
          existingRecords: knownRecords,
          minWidth: options.minWidth,
          minHeight: options.minHeight,
          maxBytes: options.maxBytes,
        });

        if (!validation.accepted || !validation.sha256Hash) {
          if (validation.duplicateCheck.hasDuplicate) {
            duplicatesBlocked += 1;
          }
          rejectedValidations.push({
            taskId: task.taskId,
            siteId: task.siteId,
            title: task.candidate.title,
            reasons: validation.issues.map((iss) => `[${iss.code}] ${iss.message}`),
          });
          emitProgress(
            `Blocked invalid/duplicate image for ${task.monumentName} (${task.candidate.filename})`
          );
          continue;
        }

        // Synchronously claim SHA-256 & sourcePageUrl inside knownRecords before yielding
        knownRecords.push({
          imageId: task.taskId,
          siteId: task.siteId,
          split: task.targetSplit,
          sha256Hash: validation.sha256Hash,
          sourcePageUrl: task.candidate.sourcePageUrl,
          filename: task.candidate.filename,
        });

        verifiedDownloads.push({
          task,
          sha256Hash: validation.sha256Hash,
          mimeType: validation.integrity.mimeType ?? task.candidate.mimeType,
          width: validation.integrity.width ?? task.candidate.width,
          height: validation.integrity.height ?? task.candidate.height,
          byteLength: validation.integrity.byteLength,
          attempts: downloaded.attempts,
          validation,
          buffer: downloaded.buffer,
        });

        emitProgress(
          `Verified ${verifiedDownloads.length}/${tasks.length}: ${task.candidate.filename} (SHA-256 ${validation.sha256Hash.slice(0, 10)}…)`
        );
      } catch (err) {
        if (isAbortError(err)) return;
        const e = err as Error & {
          httpStatus?: number | null;
          attempts?: number;
          retryable?: boolean;
        };
        failures.push({
          taskId: task.taskId,
          siteId: task.siteId,
          commonsTitle: task.candidate.title,
          url: targetUrl,
          attempts: e.attempts ?? maxDownloadRetries + 1,
          httpStatus: e.httpStatus ?? null,
          retryable: Boolean(e.retryable),
          errorMessage: e.message || 'Download failed',
        });
        emitProgress(`Download error for ${task.candidate.filename}: ${e.message}`);
      }
    }
  }

  const workerCount = Math.min(concurrency, Math.max(tasks.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    verifiedDownloads,
    failures,
    rejectedValidations,
    duplicatesBlocked,
  };
}

/**
 * Performs automated SHA-256 cryptographic integrity verification across approved dataset
 * records, verifying unique digests, cross-split anti-leakage, and backend disk validation.
 */
export async function auditDatasetIntegrity(options?: {
  records?: ApprovedDatasetImage[];
  verifyRemoteBuffers?: boolean;
  signal?: AbortSignal;
}): Promise<DatasetIntegrityAuditResult> {
  let records = options?.records;
  let serverValidation: DatasetValidationReport | null = null;

  if (!records) {
    const res = await fetch('/api/dataset/approved?limit=200', { signal: options?.signal });
    if (!res.ok) {
      throw new Error(`Failed to fetch approved dataset records for audit (HTTP ${res.status}).`);
    }
    const payload = (await res.json()) as {
      images: ApprovedDatasetImage[];
      validation: DatasetValidationReport;
    };
    records = payload.images;
    serverValidation = payload.validation;
  } else {
    try {
      const valRes = await fetch('/api/dataset/validate', { signal: options?.signal });
      if (valRes.ok) {
        serverValidation = (await valRes.json()) as DatasetValidationReport;
      }
    } catch {
      // Optional server validation if running offline in unit tests
    }
  }

  const missingHashCount = records.filter(
    (r) => !r.sha256_hash || !/^[a-f0-9]{64}$/i.test(r.sha256_hash)
  ).length;

  const existingRecords: ExistingContentRecord[] = records
    .filter((r) => Boolean(r.sha256_hash))
    .map((r) => ({
      imageId: r.image_id,
      siteId: r.site_id,
      split: r.image_split,
      sha256Hash: r.sha256_hash,
      sourcePageUrl: r.source_page_url,
      filename: r.filename,
    }));

  const duplicates = findDuplicateHashesInDataset(existingRecords);

  if (options?.verifyRemoteBuffers) {
    for (const rec of records) {
      if (options.signal?.aborted) break;
      const assetPath = rec.relative_path
        ? `/dataset-images/${rec.relative_path}`
        : `/dataset-images/${rec.image_split}/${rec.filename}`;
      const res = await fetch(assetPath, { signal: options.signal });
      if (!res.ok) {
        throw new Error(`Dataset file unreadable during SHA-256 verification: ${assetPath}`);
      }
      const computed = await computeContentHash(await res.arrayBuffer());
      if (computed !== rec.sha256_hash.toLowerCase()) {
        throw new Error(
          `SHA-256 checksum mismatch on ${rec.filename}: expected ${rec.sha256_hash.slice(0, 12)}, got ${computed.slice(0, 12)}`
        );
      }
    }
  }

  const uniqueHashes = new Set(existingRecords.map((r) => r.sha256Hash.toLowerCase())).size;
  const serverOk = serverValidation ? serverValidation.is_valid : true;
  const isIntegrityValid = missingHashCount === 0 && duplicates.length === 0 && serverOk;

  return {
    auditedAt: new Date().toISOString(),
    totalRecords: records.length,
    uniqueSha256Hashes: uniqueHashes,
    duplicateGroups: duplicates.map((d) => ({
      primaryImageId: d.primary.imageId,
      duplicateImageId: d.duplicate.imageId,
      sha256Hash: d.primary.sha256Hash,
      crossSplitLeak: d.crossSplit,
    })),
    missingHashCount,
    serverValidation,
    isIntegrityValid,
    summaryMessage: isIntegrityValid
      ? `SHA-256 audit passed: ${records.length} record(s), ${uniqueHashes} unique digest(s), zero cross-split leaks.`
      : `SHA-256 audit detected ${duplicates.length} duplicate group(s), ${missingHashCount} invalid digest(s), and ${serverValidation?.issues.length ?? 0} disk issue(s).`,
  };
}

/**
 * Full end-to-end orchestration pipeline combining:
 * 1) Batched Wikimedia Commons API search across multiple monuments
 * 2) Concurrent image downloading with bounded retries
 * 3) Automated binary integrity, open-licence, and SHA-256 deduplication validation
 */
export async function orchestrateDatasetPipeline(
  targets: WikiBatchTarget[],
  options: DatasetOrchestratorOptions = {}
): Promise<DatasetOrchestrationReport> {
  const startedAt = new Date().toISOString();
  const batchedResults = await executeBatchedWikiRequests(targets, options);

  const downloadTasks: OrchestratorDownloadTask[] = [];
  for (const res of batchedResults) {
    const targetConfig = targets.find((t) => t.siteId === res.siteId);
    const split: DatasetSplit =
      targetConfig?.targetSplit ?? (res.siteId === 'unknown' ? 'unknown' : 'reference');
    for (const candidate of res.candidates) {
      downloadTasks.push({
        taskId: `orch-${res.siteId}-${candidate.pageId}`,
        siteId: res.siteId,
        monumentName: res.monumentName,
        targetSplit: split,
        candidate,
      });
    }
  }

  const downloadOutcome = await manageConcurrentDownloads(downloadTasks, options);

  const finalProgress: OrchestratorProgressSnapshot = {
    phase: options.signal?.aborted ? 'aborted' : 'completed',
    apiBatchesCompleted: Math.max(1, targets.length),
    apiBatchesTotal: Math.max(1, targets.length),
    candidatesDiscovered: downloadTasks.length,
    downloadsTotal: downloadTasks.length,
    downloadsSucceeded: downloadOutcome.verifiedDownloads.length,
    downloadsFailed: downloadOutcome.failures.length,
    downloadsRejectedValidation: downloadOutcome.rejectedValidations.length,
    duplicatesBlocked: downloadOutcome.duplicatesBlocked,
    currentMessage: options.signal?.aborted
      ? 'Orchestration aborted cleanly.'
      : `Completed orchestration: ${downloadOutcome.verifiedDownloads.length} verified, ${downloadOutcome.duplicatesBlocked} duplicates blocked, ${downloadOutcome.failures.length} failure(s).`,
  };
  options.onProgress?.(finalProgress);

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    aborted: Boolean(options.signal?.aborted),
    batchedResults,
    verifiedDownloads: downloadOutcome.verifiedDownloads,
    failures: downloadOutcome.failures,
    rejectedValidations: downloadOutcome.rejectedValidations,
    duplicatesBlocked: downloadOutcome.duplicatesBlocked,
    progress: finalProgress,
  };
}
