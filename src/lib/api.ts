import type {
  ApprovedDatasetImage,
  CandidateApprovalStatus,
  CollectionJobProgress,
  ConservationAvailabilityFilter,
  DatasetSplit,
  DatasetSummary,
  DatasetValidationReport,
  DiscoveryResponse,
  DownloadFailureRecord,
  KnowledgeBaseValidationReport,
  MonumentRecord,
  PreservationListResponse,
  PreservationProfile,
  ProjectStatistics,
  RecognitionResponse,
  RecognitionServiceStatus,
  RejectedDatasetRecord,
  SupportedImageFormat,
  WikimediaCandidate,
} from '../types/heritage';

export class RecognitionApiError extends Error {
  public readonly kind: 'invalid_image' | 'timeout' | 'upstream_error' | 'network_error' | 'aborted';
  public readonly statusCode: number | null;
  public readonly requestId: string;
  public readonly recognitionResponse?: RecognitionResponse;

  constructor(params: {
    kind: 'invalid_image' | 'timeout' | 'upstream_error' | 'network_error' | 'aborted';
    message: string;
    statusCode: number | null;
    requestId: string;
    recognitionResponse?: RecognitionResponse;
  }) {
    super(params.message);
    this.name = 'RecognitionApiError';
    this.kind = params.kind;
    this.statusCode = params.statusCode;
    this.requestId = params.requestId;
    this.recognitionResponse = params.recognitionResponse;
  }
}

export function createRecognitionRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function deriveImageFormat(mimeType: string): SupportedImageFormat | null {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && payload.error
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!payload) {
    throw new Error('Server returned an empty response.');
  }

  return payload;
}

export async function fetchProjectStats(): Promise<ProjectStatistics> {
  const res = await fetch('/api/stats');
  return parseJsonOrThrow<ProjectStatistics>(res);
}

export async function fetchKnowledgeBaseValidation(): Promise<KnowledgeBaseValidationReport> {
  const res = await fetch('/api/knowledge-base/validation');
  return parseJsonOrThrow<KnowledgeBaseValidationReport>(res);
}

export interface MonumentListResponse {
  monuments: MonumentRecord[];
  availableStates: string[];
  availableCategories: string[];
  availableUnescoStatuses: string[];
}

export async function fetchMonuments(params?: {
  search?: string;
  state?: string;
  category?: string;
  unescoStatus?: string;
}): Promise<MonumentListResponse> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.state && params.state !== 'All') query.set('state', params.state);
  if (params?.category && params?.category !== 'All') query.set('category', params.category);
  if (params?.unescoStatus && params.unescoStatus !== 'All') {
    query.set('unescoStatus', params.unescoStatus);
  }

  const qs = query.toString();
  const res = await fetch(`/api/monuments${qs ? `?${qs}` : ''}`);
  return parseJsonOrThrow<MonumentListResponse>(res);
}

export async function fetchMonumentById(id: string): Promise<MonumentRecord> {
  const res = await fetch(`/api/monuments/${encodeURIComponent(id)}`);
  const data = await parseJsonOrThrow<{ monument: MonumentRecord }>(res);
  return data.monument;
}

export async function fetchPreservationProfiles(params?: {
  search?: string;
  location?: string;
  category?: string;
  unescoStatus?: string;
  conservationFilter?: ConservationAvailabilityFilter;
}): Promise<PreservationListResponse> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.location && params.location !== 'All') query.set('location', params.location);
  if (params?.category && params.category !== 'All') query.set('category', params.category);
  if (params?.unescoStatus && params.unescoStatus !== 'All') {
    query.set('unescoStatus', params.unescoStatus);
  }
  if (params?.conservationFilter && params.conservationFilter !== 'all') {
    query.set('conservationFilter', params.conservationFilter);
  }

  const qs = query.toString();
  const res = await fetch(`/api/preservation${qs ? `?${qs}` : ''}`);
  return parseJsonOrThrow<PreservationListResponse>(res);
}

export async function fetchPreservationProfileById(id: string): Promise<PreservationProfile> {
  const res = await fetch(`/api/preservation/${encodeURIComponent(id)}`);
  const data = await parseJsonOrThrow<{ profile: PreservationProfile }>(res);
  return data.profile;
}

export async function fetchRecognitionStatus(): Promise<RecognitionServiceStatus> {
  const res = await fetch('/api/recognition/status');
  return parseJsonOrThrow<RecognitionServiceStatus>(res);
}

export async function identifyMonumentImage(
  file: File,
  options?: {
    requestId?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<RecognitionResponse> {
  const requestId = options?.requestId?.trim() || createRecognitionRequestId();
  const timeoutMs = options?.timeoutMs ?? 20000;
  const imageFormat = deriveImageFormat(file.type);

  const formData = new FormData();
  formData.append('requestId', requestId);
  if (imageFormat) {
    formData.append('imageFormat', imageFormat);
  }
  formData.append('image', file);

  const controller = new AbortController();
  let timedOut = false;

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const handleExternalAbort = () => {
    controller.abort();
  };
  options?.signal?.addEventListener('abort', handleExternalAbort);

  try {
    const res = await fetch('/api/identify', {
      method: 'POST',
      headers: {
        'X-Request-Id': requestId,
      },
      body: formData,
      signal: controller.signal,
    });

    const payload = (await res.json().catch(() => null)) as
      | (RecognitionResponse & { error?: string })
      | { error?: string }
      | null;

    if (!res.ok) {
      const errorMessage =
        payload && typeof payload === 'object' && 'error' in payload && payload.error
          ? payload.error
          : `Identification request failed with HTTP ${res.status}.`;

      const recognitionResponse =
        payload && typeof payload === 'object' && 'recognitionStatus' in payload
          ? (payload as RecognitionResponse)
          : undefined;

      const kind =
        res.status === 504 || recognitionResponse?.recognitionStatus === 'timeout'
          ? 'timeout'
          : res.status === 400 ||
              res.status === 413 ||
              recognitionResponse?.recognitionStatus === 'invalid_image'
            ? 'invalid_image'
            : 'upstream_error';

      throw new RecognitionApiError({
        kind,
        message: errorMessage,
        statusCode: res.status,
        requestId,
        recognitionResponse,
      });
    }

    if (!payload || !('recognitionStatus' in payload)) {
      throw new RecognitionApiError({
        kind: 'upstream_error',
        message: 'Server returned an incomplete recognition response payload.',
        statusCode: res.status,
        requestId,
      });
    }

    return payload as RecognitionResponse;
  } catch (error) {
    if (error instanceof RecognitionApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (timedOut) {
        throw new RecognitionApiError({
          kind: 'timeout',
          message: `Recognition request timed out after ${(timeoutMs / 1000).toFixed(0)}s (Request ID: ${requestId}).`,
          statusCode: 504,
          requestId,
        });
      }
      throw new RecognitionApiError({
        kind: 'aborted',
        message: 'Recognition request was cancelled before completion.',
        statusCode: null,
        requestId,
      });
    }

    throw new RecognitionApiError({
      kind: 'network_error',
      message:
        error instanceof Error
          ? `Network error contacting recognition endpoint: ${error.message}`
          : 'Unable to communicate with the recognition API endpoint.',
      statusCode: null,
      requestId,
    });
  } finally {
    window.clearTimeout(timer);
    options?.signal?.removeEventListener('abort', handleExternalAbort);
  }
}

export async function submitDiscoveryQuestion(
  monumentId: string,
  question: string,
  options?: {
    sessionMonumentIds?: string[];
    signal?: AbortSignal;
  }
): Promise<DiscoveryResponse> {
  const res = await fetch('/api/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      monumentId: monumentId || 'auto',
      question,
      sessionMonumentIds: options?.sessionMonumentIds ?? [],
    }),
    signal: options?.signal,
  });

  return parseJsonOrThrow<DiscoveryResponse>(res);
}

export async function fetchDatasetSummary(): Promise<{
  summary: DatasetSummary;
  validation: DatasetValidationReport;
}> {
  const res = await fetch('/api/dataset/summary');
  return parseJsonOrThrow<{ summary: DatasetSummary; validation: DatasetValidationReport }>(res);
}

export async function fetchDatasetValidation(): Promise<DatasetValidationReport> {
  const res = await fetch('/api/dataset/validate');
  return parseJsonOrThrow<DatasetValidationReport>(res);
}

export async function fetchDatasetCandidates(params?: {
  siteId?: string;
  status?: CandidateApprovalStatus | 'all';
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{
  candidates: WikimediaCandidate[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const query = new URLSearchParams();
  if (params?.siteId && params.siteId !== 'all') query.set('siteId', params.siteId);
  if (params?.status && params.status !== 'all') query.set('status', params.status);
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const res = await fetch(`/api/dataset/candidates${qs ? `?${qs}` : ''}`);
  return parseJsonOrThrow(res);
}

export async function fetchDatasetRejected(): Promise<{
  rejected: RejectedDatasetRecord[];
  failures: DownloadFailureRecord[];
}> {
  const res = await fetch('/api/dataset/rejected');
  return parseJsonOrThrow(res);
}

export async function fetchCollectionStatus(): Promise<{ progress: CollectionJobProgress }> {
  const res = await fetch('/api/dataset/collection/status');
  return parseJsonOrThrow(res);
}

export async function startDatasetCollection(params?: {
  mode?: 'all_monuments' | 'single_monument' | 'unknown_only';
  targetPerMonument?: number;
  unknownTarget?: number;
  siteId?: string;
}): Promise<{ progress: CollectionJobProgress }> {
  const res = await fetch('/api/dataset/collection/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  return parseJsonOrThrow(res);
}

export async function pauseDatasetCollection(): Promise<{ progress: CollectionJobProgress }> {
  const res = await fetch('/api/dataset/collection/pause', { method: 'POST' });
  return parseJsonOrThrow(res);
}

export async function resumeDatasetCollection(): Promise<{ progress: CollectionJobProgress }> {
  const res = await fetch('/api/dataset/collection/resume', { method: 'POST' });
  return parseJsonOrThrow(res);
}

export async function retryDatasetFailures(): Promise<{
  retried: number;
  succeeded: number;
  remainingFailures: number;
}> {
  const res = await fetch('/api/dataset/collection/retry-failures', { method: 'POST' });
  return parseJsonOrThrow(res);
}

export async function sourceWikimediaCandidates(params: {
  siteId: string;
  query?: string;
  limit?: number;
  targetSplit?: DatasetSplit;
}): Promise<{
  queryUsed: string;
  siteId: string;
  monumentName: string;
  candidates: WikimediaCandidate[];
  summary: DatasetSummary;
}> {
  const res = await fetch('/api/dataset/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res);
}

export async function sourceAllMonumentsFromWikimedia(limitPerMonument = 4): Promise<{
  monumentsQueried: number;
  totalFetched: number;
  errors: Array<{ siteId: string; error: string }>;
  summary: DatasetSummary;
}> {
  const res = await fetch('/api/dataset/source-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limitPerMonument }),
  });
  return parseJsonOrThrow(res);
}

export async function approveDatasetCandidate(
  candidateId: string,
  split: DatasetSplit
): Promise<{
  approvedImage: ApprovedDatasetImage;
  candidate: WikimediaCandidate;
  summary: DatasetSummary;
  validation: DatasetValidationReport;
}> {
  const res = await fetch(`/api/dataset/candidates/${encodeURIComponent(candidateId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ split }),
  });
  return parseJsonOrThrow(res);
}

export async function rejectDatasetCandidate(
  candidateId: string,
  reason?: string
): Promise<{
  candidate: WikimediaCandidate;
  summary: DatasetSummary;
}> {
  const res = await fetch(`/api/dataset/candidates/${encodeURIComponent(candidateId)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return parseJsonOrThrow(res);
}

export async function fetchApprovedDatasetImages(params?: {
  siteId?: string;
  split?: DatasetSplit | 'all';
  licence?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{
  images: ApprovedDatasetImage[];
  total: number;
  page: number;
  totalPages: number;
  availableLicences: string[];
  validation: DatasetValidationReport;
}> {
  const query = new URLSearchParams();
  if (params?.siteId && params.siteId !== 'all') query.set('siteId', params.siteId);
  if (params?.split && params.split !== 'all') query.set('split', params.split);
  if (params?.licence && params.licence !== 'all') query.set('licence', params.licence);
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const res = await fetch(`/api/dataset/approved${qs ? `?${qs}` : ''}`);
  return parseJsonOrThrow(res);
}

export async function removeApprovedDatasetImage(imageId: string): Promise<{
  removedId: string;
  summary: DatasetSummary;
  validation: DatasetValidationReport;
}> {
  const res = await fetch(`/api/dataset/approved/${encodeURIComponent(imageId)}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow(res);
}
