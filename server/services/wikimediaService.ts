import crypto from 'node:crypto';
import type {
  DatasetSplit,
  RejectedDatasetRecord,
  WikimediaCandidate,
} from '../../src/types/heritage.ts';
import {
  classifyCandidateQuality,
  isAcceptableOpenLicence,
} from './datasetValidator.ts';
import { findMonumentById, loadMonuments } from './knowledgeBaseService.ts';
import {
  PROFILE_BY_SITE_ID,
  UNKNOWN_DISTRACTOR_PROFILE,
  getMonumentFolderName,
  type MonumentSearchProfile,
} from './monumentSearchProfiles.ts';

const WIKIMEDIA_API_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
export const WIKIMEDIA_USER_AGENT =
  'HeritageVisionResearch/1.0 (https://heritage-vision.local; academic-heritage-dataset)';

interface CommonsImageInfo {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  width?: number;
  height?: number;
  size?: number;
  mime?: string;
  sha1?: string;
  extmetadata?: Record<string, { value?: string }>;
}

interface CommonsPage {
  pageid?: number;
  title?: string;
  categories?: Array<{ title?: string }>;
  imageinfo?: CommonsImageInfo[];
}

interface CommonsApiPayload {
  continue?: {
    gsroffset?: number;
    gcmcontinue?: string;
  };
  query?: {
    pages?: Record<string, CommonsPage>;
  };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanMetadataText(raw?: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const stripped = decodeHtmlEntities(raw.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 0 ? stripped : null;
}

function stripTrackingParams(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_campaign');
    parsed.searchParams.delete('utm_content');
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function mimeToFormat(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'JPEG';
    case 'image/png':
      return 'PNG';
    case 'image/webp':
      return 'WEBP';
    default:
      return mime.replace(/^image\//, '').toUpperCase() || 'UNKNOWN';
  }
}

export async function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchCommonsWithBackoff(
  url: string,
  options: { timeoutMs?: number; maxRetries?: number; binary?: boolean } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxRetries = options.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': WIKIMEDIA_USER_AGENT,
        Accept: options.binary ? 'image/*,*/*' : 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 429 || res.status === 503) {
      if (attempt === maxRetries) {
        return res;
      }
      const retryAfterSec = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 12000)
          : 1200 * Math.pow(2, attempt);
      await sleepMs(waitMs);
      continue;
    }

    return res;
  }

  throw new Error(`Wikimedia request exhausted retries for ${url}`);
}

export { isAcceptableOpenLicence };

function resolveProfile(siteId: string): {
  profile: MonumentSearchProfile;
  monumentCategory: string;
} {
  if (siteId === 'unknown') {
    return {
      profile: UNKNOWN_DISTRACTOR_PROFILE,
      monumentCategory: 'Non-Monument Distractor',
    };
  }
  const kbRecord = findMonumentById(siteId);
  if (!kbRecord) {
    throw new Error(`Monument "${siteId}" does not exist in the knowledge base.`);
  }
  const profile = PROFILE_BY_SITE_ID.get(siteId) ?? {
    siteId: kbRecord.id,
    folderName: getMonumentFolderName(kbRecord.id),
    monumentName: kbRecord.name,
    state: kbRecord.state,
    categories: [`Category:${kbRecord.name}`],
    queries: [`${kbRecord.name} ${kbRecord.cityOrDistrict}`],
    negativeKeywords: [],
  };
  return {
    profile,
    monumentCategory: kbRecord.category,
  };
}

function mapPagesToCandidates(params: {
  pages: CommonsPage[];
  siteId: string;
  monumentCategory: string;
  profile: MonumentSearchProfile;
  searchQuery: string;
  sourceCategory: string | null;
  suggestedSplit: DatasetSplit;
}): {
  acceptedCandidates: WikimediaCandidate[];
  autoRejected: RejectedDatasetRecord[];
} {
  const fetchedAt = new Date().toISOString();
  const acceptedCandidates: WikimediaCandidate[] = [];
  const autoRejected: RejectedDatasetRecord[] = [];

  for (const page of params.pages) {
    const info = page.imageinfo?.[0];
    if (!page.pageid || !page.title || !info) continue;

    const ext = info.extmetadata ?? {};
    const creator = cleanMetadataText(ext.Artist?.value);
    const licence =
      cleanMetadataText(ext.LicenseShortName?.value) ??
      cleanMetadataText(ext.UsageTerms?.value);
    const licenceUrl = cleanMetadataText(ext.LicenseUrl?.value);
    const imageDescription = cleanMetadataText(ext.ImageDescription?.value);
    const categoriesText =
      cleanMetadataText(ext.Categories?.value) ??
      page.categories?.map((c) => c.title ?? '').join(' | ') ??
      params.sourceCategory;
    const explicitAttribution = cleanMetadataText(ext.Attribution?.value);
    const attributionText =
      explicitAttribution ??
      (creator && licence ? `${creator} (${licence}) via Wikimedia Commons` : null);

    const originalSourceUrl = stripTrackingParams(info.url);
    const previewUrl = info.thumburl ?? originalSourceUrl ?? '';
    const sourcePageUrl = info.descriptionurl ?? null;
    const width = Number(info.width ?? 0);
    const height = Number(info.height ?? 0);
    const fileSizeBytes = Number(info.size ?? 0);
    const mimeType = info.mime ?? 'unknown';

    // Use high-resolution 1200px thumbnail when raw Commons upload > 2.5 MB to avoid timeouts & excessive bloat
    const downloadUrl =
      fileSizeBytes > 2_500_000 && info.thumburl
        ? info.thumburl
        : originalSourceUrl ?? info.thumburl ?? null;

    const originalFilename = page.title.replace(/^File:/i, '');
    const candidateHash = crypto
      .createHash('sha1')
      .update(`${params.siteId}:${page.pageid}`)
      .digest('hex')
      .slice(0, 12);
    const candidateId = `cand-${params.siteId}-${page.pageid}-${candidateHash}`;

    const qc = classifyCandidateQuality({
      commonsTitle: page.title,
      imageDescription,
      categoriesText,
      licence,
      creator,
      width,
      height,
      fileSizeBytes,
      mimeType,
      sourcePageUrl,
      originalSourceUrl,
      negativeKeywords: params.profile.negativeKeywords,
    });

    if (qc.outcome === 'auto_reject') {
      autoRejected.push({
        candidate_id: candidateId,
        site_id: params.siteId,
        monument_folder: params.profile.folderName,
        monument_name: params.profile.monumentName,
        commons_title: page.title,
        source_page_url: sourcePageUrl,
        direct_image_url: downloadUrl ?? originalSourceUrl,
        licence,
        image_width: width,
        image_height: height,
        rejection_stage: qc.rejectionStage ?? 'metadata_filter',
        rejection_reason: qc.rejectionReason ?? 'Excluded by automated dataset quality filter',
        rejected_at: fetchedAt,
      });
      continue;
    }

    acceptedCandidates.push({
      candidate_id: candidateId,
      site_id: params.siteId,
      monument_folder: params.profile.folderName,
      monument_name: params.profile.monumentName,
      monument_category: params.monumentCategory,
      search_query: params.searchQuery,
      source_category: params.sourceCategory,
      commons_page_id: page.pageid,
      commons_title: page.title,
      original_filename: originalFilename,
      preview_url: previewUrl,
      download_url: downloadUrl,
      original_source_url: originalSourceUrl,
      source_page_url: sourcePageUrl,
      creator,
      licence,
      licence_url: licenceUrl,
      attribution_text: attributionText,
      image_description: imageDescription ? imageDescription.slice(0, 320) : null,
      image_width: width,
      image_height: height,
      file_size_bytes: fileSizeBytes,
      mime_type: mimeType,
      file_format: mimeToFormat(mimeType),
      wikimedia_sha1: info.sha1 ?? null,
      suggested_split: params.suggestedSplit,
      approval_status: qc.outcome === 'review_required' ? 'review_required' : 'pending_review',
      eligibility_warnings: qc.warnings,
      quality_flags: qc.qualityFlags,
      rejection_reason: null,
      reviewed_at: null,
      fetched_at: fetchedAt,
    });
  }

  return { acceptedCandidates, autoRejected };
}

export async function searchWikimediaPaginated(params: {
  siteId: string;
  query: string;
  maxResults?: number;
  targetSplit?: DatasetSplit;
}): Promise<{
  candidates: WikimediaCandidate[];
  autoRejected: RejectedDatasetRecord[];
}> {
  const { profile, monumentCategory } = resolveProfile(params.siteId);
  const maxResults = Math.min(Math.max(params.maxResults ?? 30, 1), 150);
  const suggestedSplit: DatasetSplit =
    params.targetSplit ?? (params.siteId === 'unknown' ? 'unknown' : 'reference');

  const collected = new Map<number, WikimediaCandidate>();
  const rejectedMap = new Map<string, RejectedDatasetRecord>();
  let gsroffset: number | undefined = 0;

  while (collected.size < maxResults && gsroffset !== undefined) {
    const batchSize = Math.min(50, maxResults - collected.size + 10);
    const urlParams = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: `${params.query} filetype:bitmap`,
      gsrlimit: String(Math.min(batchSize, 50)),
      gsroffset: String(gsroffset),
      prop: 'imageinfo',
      iiprop: 'url|size|mime|sha1|extmetadata',
      iiurlwidth: '1200',
    });

    const response = await fetchCommonsWithBackoff(
      `${WIKIMEDIA_API_ENDPOINT}?${urlParams.toString()}`
    );
    if (!response.ok) {
      throw new Error(`Wikimedia Commons search failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as CommonsApiPayload;
    const pages = Object.values(payload.query?.pages ?? {});
    const { acceptedCandidates, autoRejected } = mapPagesToCandidates({
      pages,
      siteId: params.siteId,
      monumentCategory,
      profile,
      searchQuery: params.query,
      sourceCategory: null,
      suggestedSplit,
    });

    for (const c of acceptedCandidates) {
      if (!collected.has(c.commons_page_id)) {
        collected.set(c.commons_page_id, c);
      }
    }
    for (const r of autoRejected) {
      rejectedMap.set(r.candidate_id, r);
    }

    gsroffset = payload.continue?.gsroffset;
    if (pages.length === 0) break;
    if (gsroffset !== undefined && collected.size < maxResults) {
      await sleepMs(160);
    }
  }

  return {
    candidates: Array.from(collected.values()).slice(0, maxResults),
    autoRejected: Array.from(rejectedMap.values()),
  };
}

export async function fetchCategoryMembersPaginated(params: {
  siteId: string;
  categoryTitle: string;
  maxResults?: number;
  targetSplit?: DatasetSplit;
}): Promise<{
  candidates: WikimediaCandidate[];
  autoRejected: RejectedDatasetRecord[];
}> {
  const { profile, monumentCategory } = resolveProfile(params.siteId);
  const maxResults = Math.min(Math.max(params.maxResults ?? 60, 1), 150);
  const suggestedSplit: DatasetSplit =
    params.targetSplit ?? (params.siteId === 'unknown' ? 'unknown' : 'reference');

  const collected = new Map<number, WikimediaCandidate>();
  const rejectedMap = new Map<string, RejectedDatasetRecord>();
  let gcmcontinue: string | undefined;

  while (collected.size < maxResults) {
    const urlParams = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'categorymembers',
      gcmtitle: params.categoryTitle,
      gcmtype: 'file',
      gcmlimit: '50',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|sha1|extmetadata',
      iiurlwidth: '1200',
    });
    if (gcmcontinue) {
      urlParams.set('gcmcontinue', gcmcontinue);
    }

    const response = await fetchCommonsWithBackoff(
      `${WIKIMEDIA_API_ENDPOINT}?${urlParams.toString()}`
    );
    if (!response.ok) {
      throw new Error(
        `Wikimedia categorymembers request failed for ${params.categoryTitle} (HTTP ${response.status}).`
      );
    }

    const payload = (await response.json()) as CommonsApiPayload;
    const pages = Object.values(payload.query?.pages ?? {});
    const { acceptedCandidates, autoRejected } = mapPagesToCandidates({
      pages,
      siteId: params.siteId,
      monumentCategory,
      profile,
      searchQuery: params.categoryTitle,
      sourceCategory: params.categoryTitle,
      suggestedSplit,
    });

    for (const c of acceptedCandidates) {
      if (!collected.has(c.commons_page_id)) {
        collected.set(c.commons_page_id, c);
      }
    }
    for (const r of autoRejected) {
      rejectedMap.set(r.candidate_id, r);
    }

    gcmcontinue = payload.continue?.gcmcontinue;
    if (!gcmcontinue || pages.length === 0) break;
    await sleepMs(160);
  }

  return {
    candidates: Array.from(collected.values()).slice(0, maxResults),
    autoRejected: Array.from(rejectedMap.values()),
  };
}

export interface SearchCandidatesOptions {
  siteId: string;
  queryOverride?: string;
  limit?: number;
  targetSplit?: DatasetSplit;
}

export async function fetchWikimediaCandidates(
  options: SearchCandidatesOptions
): Promise<{
  queryUsed: string;
  siteId: string;
  monumentName: string;
  candidates: WikimediaCandidate[];
  autoRejected: RejectedDatasetRecord[];
}> {
  const { siteId, queryOverride, limit = 12, targetSplit } = options;
  const clampedLimit = Math.min(Math.max(Number(limit) || 12, 1), 60);
  const { profile } = resolveProfile(siteId);
  const rawQuery = queryOverride?.trim() ? queryOverride.trim() : profile.queries[0];

  const { candidates, autoRejected } = await searchWikimediaPaginated({
    siteId,
    query: rawQuery,
    maxResults: clampedLimit,
    targetSplit,
  });

  return {
    queryUsed: rawQuery,
    siteId,
    monumentName: profile.monumentName,
    candidates,
    autoRejected,
  };
}

export async function fetchCandidatesAcrossAllMonuments(limitPerMonument = 4): Promise<{
  monumentsQueried: number;
  totalFetched: number;
  candidates: WikimediaCandidate[];
  autoRejected: RejectedDatasetRecord[];
  errors: Array<{ siteId: string; error: string }>;
}> {
  const monuments = loadMonuments();
  const candidates: WikimediaCandidate[] = [];
  const autoRejected: RejectedDatasetRecord[] = [];
  const errors: Array<{ siteId: string; error: string }> = [];

  for (const monument of monuments) {
    try {
      const res = await fetchWikimediaCandidates({
        siteId: monument.id,
        limit: limitPerMonument,
        targetSplit: 'reference',
      });
      candidates.push(...res.candidates);
      autoRejected.push(...res.autoRejected);
      await sleepMs(140);
    } catch (err) {
      errors.push({
        siteId: monument.id,
        error: err instanceof Error ? err.message : 'Wikimedia query failed',
      });
    }
  }

  return {
    monumentsQueried: monuments.length,
    totalFetched: candidates.length,
    candidates,
    autoRejected,
    errors,
  };
}
