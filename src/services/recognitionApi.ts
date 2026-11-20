export const DEFAULT_FASTAPI_BASE_URL = '';

const rawEnvUrl =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  typeof import.meta.env.VITE_RECOGNITION_API_URL === 'string'
    ? import.meta.env.VITE_RECOGNITION_API_URL.trim()
    : '';

const configuredBaseUrl =
  rawEnvUrl && !rawEnvUrl.includes('trycloudflare.com')
    ? rawEnvUrl.replace(/\/+$/, '')
    : DEFAULT_FASTAPI_BASE_URL;

export const FASTAPI_RECOGNITION_BASE_URL = configuredBaseUrl;
export const FASTAPI_RECOGNITION_ENDPOINT = FASTAPI_RECOGNITION_BASE_URL
  ? `${FASTAPI_RECOGNITION_BASE_URL}/recognize`
  : '/recognize';

export interface SupportedMonumentMeta {
  rawLabel: 'Taj_Mahal' | 'Red_Fort' | 'Qutub_Minar';
  siteId: 'taj-mahal' | 'red-fort' | 'qutub-minar';
  monumentName: 'Taj Mahal' | 'Red Fort' | 'Qutub Minar';
  state: 'Uttar Pradesh' | 'Delhi';
}

export const SUPPORTED_BACKEND_MONUMENTS: Record<string, SupportedMonumentMeta> = {
  Taj_Mahal: {
    rawLabel: 'Taj_Mahal',
    siteId: 'taj-mahal',
    monumentName: 'Taj Mahal',
    state: 'Uttar Pradesh',
  },
  'Taj Mahal': {
    rawLabel: 'Taj_Mahal',
    siteId: 'taj-mahal',
    monumentName: 'Taj Mahal',
    state: 'Uttar Pradesh',
  },
  Red_Fort: {
    rawLabel: 'Red_Fort',
    siteId: 'red-fort',
    monumentName: 'Red Fort',
    state: 'Delhi',
  },
  'Red Fort': {
    rawLabel: 'Red_Fort',
    siteId: 'red-fort',
    monumentName: 'Red Fort',
    state: 'Delhi',
  },
  Qutub_Minar: {
    rawLabel: 'Qutub_Minar',
    siteId: 'qutub-minar',
    monumentName: 'Qutub Minar',
    state: 'Delhi',
  },
  'Qutub Minar': {
    rawLabel: 'Qutub_Minar',
    siteId: 'qutub-minar',
    monumentName: 'Qutub Minar',
    state: 'Delhi',
  },
};

export const SUPPORTED_MONUMENT_DISPLAY_NAMES = [
  'Taj Mahal',
  'Red Fort',
  'Qutub Minar',
] as const;

export interface FastApiRawCandidate {
  monument: string;
  similarity: number;
}

export interface FastApiRecognizeResponse {
  status: string;
  filename: string;
  candidates: FastApiRawCandidate[];
}

export interface FastApiBackendStatus {
  reachable: boolean;
  project: string | null;
  status: string | null;
  recognitionEngine: string | null;
  supportedLabels: string[];
  error: string | null;
}

export interface NormalizedRecognitionCandidate {
  rank: number;
  rawLabel: string;
  siteId: string;
  monumentName: string;
  state: string;
  similarity: number;
  similarityPercentage: number;
}

export interface MonumentRecognitionResult {
  status: string;
  filename: string;
  endpointUrl: string;
  modelEngine: string | null;
  bestMatch: NormalizedRecognitionCandidate;
  alternatives: NormalizedRecognitionCandidate[];
  candidates: NormalizedRecognitionCandidate[];
  topTwoMarginPercent: number | null;
  responseTimeMs: number;
}

export class FastApiRecognitionError extends Error {
  public readonly kind:
    | 'network'
    | 'timeout'
    | 'http_error'
    | 'invalid_response'
    | 'aborted';
  public readonly statusCode: number | null;

  constructor(params: {
    kind: 'network' | 'timeout' | 'http_error' | 'invalid_response' | 'aborted';
    message: string;
    statusCode: number | null;
  }) {
    super(params.message);
    this.name = 'FastApiRecognitionError';
    this.kind = params.kind;
    this.statusCode = params.statusCode;
  }
}

function toSimilarityPercentage(rawScore: number): number {
  const clamped = Math.max(0, Math.min(1, rawScore));
  return Number((clamped * 100).toFixed(2));
}

export async function checkFastApiBackendStatus(
  timeoutMs = 6000
): Promise<FastApiBackendStatus> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const statusUrl = FASTAPI_RECOGNITION_BASE_URL
      ? `${FASTAPI_RECOGNITION_BASE_URL}/`
      : '/recognize/status';

    const res = await fetch(statusUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        reachable: false,
        project: null,
        status: null,
        recognitionEngine: null,
        supportedLabels: [],
        error: `Backend health check returned HTTP ${res.status}.`,
      };
    }

    const data = (await res.json().catch(() => null)) as {
      project?: unknown;
      status?: unknown;
      recognition_engine?: unknown;
      monuments?: unknown;
    } | null;

    return {
      reachable: true,
      project: typeof data?.project === 'string' ? data.project : null,
      status: typeof data?.status === 'string' ? data.status : null,
      recognitionEngine:
        typeof data?.recognition_engine === 'string' ? data.recognition_engine : null,
      supportedLabels: Array.isArray(data?.monuments)
        ? data.monuments.filter((m): m is string => typeof m === 'string')
        : [],
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      project: null,
      status: null,
      recognitionEngine: null,
      supportedLabels: [],
      error:
        error instanceof Error
          ? error.message
          : 'Recognition backend is currently unreachable.',
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function recognizeMonumentWithFastApi(
  file: File,
  options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<MonumentRecognitionResult> {
  const timeoutMs = options?.timeoutMs ?? 25000;
  const controller = new AbortController();
  let timedOut = false;

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onExternalAbort);

  const startedAt = performance.now();

  try {
    const formData = new FormData();
    formData.append('file', file);

    // Do NOT set Content-Type manually; the browser generates the multipart boundary.
    const response = await fetch(FASTAPI_RECOGNITION_ENDPOINT, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errJson = (await response.json().catch(() => null)) as {
        detail?: unknown;
        error?: unknown;
        message?: unknown;
      } | null;

      let detailMessage = `Recognition backend responded with HTTP ${response.status}.`;
      if (typeof errJson?.error === 'string' && errJson.error.trim()) {
        detailMessage = errJson.error.trim();
      } else if (typeof errJson?.detail === 'string' && errJson.detail.trim()) {
        detailMessage = errJson.detail.trim();
      } else if (typeof errJson?.message === 'string' && errJson.message.trim()) {
        detailMessage = errJson.message.trim();
      }

      throw new FastApiRecognitionError({
        kind: 'http_error',
        message: detailMessage,
        statusCode: response.status,
      });
    }

    const payload = (await response.json().catch(() => null)) as FastApiRecognizeResponse | null;

    if (
      !payload ||
      typeof payload.status !== 'string' ||
      typeof payload.filename !== 'string' ||
      !Array.isArray(payload.candidates)
    ) {
      throw new FastApiRecognitionError({
        kind: 'invalid_response',
        message:
          'Recognition backend returned an unexpected JSON structure (expected status, filename, and candidates).',
        statusCode: response.status,
      });
    }

    if (payload.status.toLowerCase() !== 'success' && payload.status.toLowerCase() !== 'ok') {
      throw new FastApiRecognitionError({
        kind: 'http_error',
        message: `Backend reported recognition status "${payload.status}".`,
        statusCode: response.status,
      });
    }

    // Only keep genuine scores for the 3 monuments actually supported by this OpenCLIP backend.
    const normalizedCandidates: NormalizedRecognitionCandidate[] = payload.candidates
      .filter(
        (item): item is FastApiRawCandidate =>
          Boolean(item) &&
          typeof item.monument === 'string' &&
          typeof item.similarity === 'number' &&
          Number.isFinite(item.similarity) &&
          Boolean(SUPPORTED_BACKEND_MONUMENTS[item.monument.trim()])
      )
      .sort((a, b) => b.similarity - a.similarity)
      .map((item, idx) => {
        const meta = SUPPORTED_BACKEND_MONUMENTS[item.monument.trim()];
        return {
          rank: idx + 1,
          rawLabel: item.monument,
          siteId: meta.siteId,
          monumentName: meta.monumentName,
          state: meta.state,
          similarity: item.similarity,
          similarityPercentage: toSimilarityPercentage(item.similarity),
        };
      });

    if (normalizedCandidates.length === 0) {
      throw new FastApiRecognitionError({
        kind: 'invalid_response',
        message:
          'No valid candidate similarity scores were returned for the supported monuments (Taj Mahal, Red Fort, Qutub Minar).',
        statusCode: response.status,
      });
    }

    const bestMatch = normalizedCandidates[0];
    const alternatives = normalizedCandidates.slice(1);
    const topTwoMarginPercent =
      normalizedCandidates.length >= 2
        ? Number(
            (
              normalizedCandidates[0].similarityPercentage -
              normalizedCandidates[1].similarityPercentage
            ).toFixed(2)
          )
        : null;

    return {
      status: payload.status,
      filename: payload.filename,
      endpointUrl: FASTAPI_RECOGNITION_ENDPOINT,
      modelEngine: 'OpenCLIP ViT-B-32',
      bestMatch,
      alternatives,
      candidates: normalizedCandidates,
      topTwoMarginPercent,
      responseTimeMs: Math.max(1, Math.round(performance.now() - startedAt)),
    };
  } catch (error) {
    if (error instanceof FastApiRecognitionError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (timedOut) {
        throw new FastApiRecognitionError({
          kind: 'timeout',
          message: `Recognition request timed out after ${(timeoutMs / 1000).toFixed(0)} seconds. Please verify the backend tunnel is active and retry.`,
          statusCode: 504,
        });
      }
      throw new FastApiRecognitionError({
        kind: 'aborted',
        message: 'Recognition request was cancelled.',
        statusCode: null,
      });
    }

    throw new FastApiRecognitionError({
      kind: 'network',
      message:
        'Unable to reach the OpenCLIP FastAPI recognition backend. The service or Cloudflare tunnel may be offline—please retry.',
      statusCode: null,
    });
  } finally {
    window.clearTimeout(timer);
    options?.signal?.removeEventListener('abort', onExternalAbort);
  }
}
