import type { RecognitionServiceStatus } from '../../src/types/heritage.ts';

export interface OpenClipServiceConfig {
  serviceUrl: string | null;
  endpointConfigured: boolean;
  identifyPath: string;
  healthPath: string;
  modelName: string;
  timeoutMs: number;
  minSimilarityThreshold: number;
  top2MarginThreshold: number;
  authToken: string | null;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseThreshold(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function normalizePath(raw: string | undefined, fallback: string): string {
  const value = raw?.trim() || fallback;
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizeServiceUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function getOpenClipConfig(): OpenClipServiceConfig {
  const serviceUrl = normalizeServiceUrl(process.env.OPENCLIP_SERVICE_URL);
  return {
    serviceUrl,
    endpointConfigured: serviceUrl !== null,
    identifyPath: normalizePath(process.env.OPENCLIP_IDENTIFY_PATH, '/v1/recognize'),
    healthPath: normalizePath(process.env.OPENCLIP_HEALTH_PATH, '/health'),
    modelName: process.env.OPENCLIP_MODEL_NAME?.trim() || 'ViT-B-32 (laion2b_s34b_b79k)',
    timeoutMs: Math.round(parsePositiveNumber(process.env.OPENCLIP_TIMEOUT_MS, 15000)),
    minSimilarityThreshold: parseThreshold(process.env.OPENCLIP_MIN_SIMILARITY_THRESHOLD, 0.28),
    top2MarginThreshold: parseThreshold(process.env.OPENCLIP_TOP2_MARGIN_THRESHOLD, 0.04),
    authToken: process.env.OPENCLIP_AUTH_TOKEN?.trim() || null,
  };
}

export function getPublicRecognitionConfigSummary(
  openClipConnected = false
): RecognitionServiceStatus {
  const config = getOpenClipConfig();

  return {
    openClipConnected,
    endpointConfigured: config.endpointConfigured,
    serviceEndpoint: config.serviceUrl,
    identifyPath: config.identifyPath,
    healthPath: config.healthPath,
    configuredModelName: config.modelName,
    timeoutMs: config.timeoutMs,
    thresholds: {
      minSimilarity: config.minSimilarityThreshold,
      top2Margin: config.top2MarginThreshold,
    },
    statusMessage: !config.endpointConfigured
      ? 'OPENCLIP_SERVICE_URL is not configured. Recognition runs in Milestone 1 architecture validation mode with no model predictions.'
      : openClipConnected
        ? `Connected to Python OpenCLIP service at ${config.serviceUrl}${config.identifyPath}.`
        : `Endpoint ${config.serviceUrl} is configured, but live readiness could not be verified.`,
  };
}
