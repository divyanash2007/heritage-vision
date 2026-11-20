import type { ConfidenceCategory, RecognitionStatus } from '../../src/types/heritage.ts';
import { getOpenClipConfig } from './openClipConfig.ts';
import type { RawSimilarityMatch, ValidatedImageArtifact } from './openClipInterfaces.ts';

export interface PythonOpenClipHealthResult {
  reachable: boolean;
  modelLoaded: boolean;
  modelName: string | null;
  error?: string;
}

export interface PythonOpenClipServicePayload {
  requestId: string;
  recognitionStatus: RecognitionStatus;
  modelName: string;
  predictedSiteId: string | null;
  predictedMonumentName: string | null;
  topCandidates: Array<{
    rank: number;
    siteId: string;
    monumentName: string;
    state?: string;
    similarityScore: number;
    scoreType: 'cosine_similarity';
  }>;
  topTwoScoreMargin: number | null;
  confidenceCategory?: ConfidenceCategory;
  isUnknownOrUncertain?: boolean;
  unknownReason?: string | null;
  processingTimeMs?: number;
  explanation?: string;
}

export class OpenClipTransportError extends Error {
  public readonly kind: 'timeout' | 'upstream_error' | 'invalid_response';
  public readonly statusCode: number;

  constructor(
    kind: 'timeout' | 'upstream_error' | 'invalid_response',
    message: string,
    statusCode: number
  ) {
    super(message);
    this.name = 'OpenClipTransportError';
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

export async function checkPythonServiceHealth(): Promise<PythonOpenClipHealthResult> {
  const config = getOpenClipConfig();
  if (!config.serviceUrl) {
    return {
      reachable: false,
      modelLoaded: false,
      modelName: null,
      error: 'OPENCLIP_SERVICE_URL is not configured.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 3000));

  try {
    const headers: Record<string, string> = {};
    if (config.authToken) {
      headers.Authorization = `Bearer ${config.authToken}`;
    }

    const res = await fetch(`${config.serviceUrl}${config.healthPath}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        reachable: false,
        modelLoaded: false,
        modelName: null,
        error: `Health endpoint returned HTTP ${res.status}.`,
      };
    }

    const body = (await res.json().catch(() => null)) as {
      ready?: boolean;
      modelLoaded?: boolean;
      modelName?: string;
    } | null;

    const modelLoaded = Boolean(body?.ready ?? body?.modelLoaded);
    return {
      reachable: true,
      modelLoaded,
      modelName: typeof body?.modelName === 'string' ? body.modelName : null,
    };
  } catch (error) {
    return {
      reachable: false,
      modelLoaded: false,
      modelName: null,
      error:
        error instanceof Error
          ? error.message
          : 'Unable to connect to Python OpenCLIP health endpoint.',
    };
  } finally {
    clearTimeout(timer);
  }
}

function validatePythonPayload(raw: unknown): PythonOpenClipServicePayload {
  if (!raw || typeof raw !== 'object') {
    throw new OpenClipTransportError(
      'invalid_response',
      'Python OpenCLIP service returned a non-object JSON payload.',
      502
    );
  }

  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.topCandidates)) {
    throw new OpenClipTransportError(
      'invalid_response',
      'Python OpenCLIP response missing topCandidates array.',
      502
    );
  }

  for (const item of data.topCandidates) {
    if (!item || typeof item !== 'object') {
      throw new OpenClipTransportError(
        'invalid_response',
        'Python OpenCLIP response contained a malformed candidate record.',
        502
      );
    }
    const c = item as Record<string, unknown>;
    if (
      typeof c.siteId !== 'string' ||
      typeof c.monumentName !== 'string' ||
      typeof c.similarityScore !== 'number' ||
      !Number.isFinite(c.similarityScore)
    ) {
      throw new OpenClipTransportError(
        'invalid_response',
        'Python OpenCLIP candidate entry must contain siteId, monumentName, and numeric cosine similarityScore.',
        502
      );
    }
  }

  return data as unknown as PythonOpenClipServicePayload;
}

export async function invokePythonOpenClipService(
  validated: ValidatedImageArtifact
): Promise<{
  payload: PythonOpenClipServicePayload;
  rawMatches: RawSimilarityMatch[];
}> {
  const config = getOpenClipConfig();
  if (!config.serviceUrl) {
    throw new OpenClipTransportError(
      'upstream_error',
      'OPENCLIP_SERVICE_URL is not configured.',
      503
    );
  }

  const endpoint = `${config.serviceUrl}${config.identifyPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': validated.requestId,
    };
    if (config.authToken) {
      headers.Authorization = `Bearer ${config.authToken}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: validated.requestId,
        fileName: validated.fileName,
        imageFormat: validated.imageFormat,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        width: validated.width,
        height: validated.height,
        imageBase64: validated.buffer.toString('base64'),
        thresholds: {
          minSimilarity: config.minSimilarityThreshold,
          minTop2Margin: config.top2MarginThreshold,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
      const errMsg =
        errBody?.error ||
        errBody?.detail ||
        `Python OpenCLIP service responded with HTTP ${res.status}.`;
      throw new OpenClipTransportError('upstream_error', errMsg, res.status >= 500 ? 502 : res.status);
    }

    const json = await res.json().catch(() => {
      throw new OpenClipTransportError(
        'invalid_response',
        'Python OpenCLIP service returned invalid JSON.',
        502
      );
    });

    const payload = validatePythonPayload(json);
    const rawMatches: RawSimilarityMatch[] = payload.topCandidates.map((c) => ({
      siteId: c.siteId,
      monumentName: c.monumentName,
      state: c.state ?? 'Verified KB Record',
      similarityScore: c.similarityScore,
    }));

    return { payload, rawMatches };
  } catch (error) {
    if (error instanceof OpenClipTransportError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OpenClipTransportError(
        'timeout',
        `Python OpenCLIP recognition service timed out after ${config.timeoutMs} ms.`,
        504
      );
    }
    throw new OpenClipTransportError(
      'upstream_error',
      error instanceof Error
        ? `Unable to reach Python OpenCLIP service at ${endpoint}: ${error.message}`
        : `Unable to reach Python OpenCLIP service at ${endpoint}.`,
      502
    );
  } finally {
    clearTimeout(timer);
  }
}
