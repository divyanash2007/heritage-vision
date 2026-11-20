const MEDIAWIKI_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

const SUPPORTED_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const NON_OPEN_LICENCE_PATTERN = /(fair use|non-free|all rights reserved|copyrighted)/i;
const CC_LICENCE_PATTERN = /^(cc(?:\s|-|0)|creative commons)/i;

export interface WikiMonumentImage {
  pageId: number;
  title: string;
  filename: string;
  originalUrl: string;
  thumbnailUrl: string;
  sourcePageUrl: string;
  creator: string | null;
  licence: string;
  licenceUrl: string | null;
  attribution: string | null;
  description: string | null;
  width: number;
  height: number;
  mimeType: string;
  sha1: string | null;
}

export interface WikiSearchOptions {
  limit?: number;
  thumbnailWidth?: number;
  includePublicDomain?: boolean;
}

interface MediaWikiExtMetadataField {
  value?: string;
}

interface MediaWikiImageInfo {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  width?: number;
  height?: number;
  mime?: string;
  sha1?: string;
  extmetadata?: Record<string, MediaWikiExtMetadataField>;
}

interface MediaWikiPage {
  pageid?: number;
  title?: string;
  imageinfo?: MediaWikiImageInfo[];
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

function cleanExtMetadataText(raw?: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = decodeHtmlEntities(raw.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeImageUrl(rawUrl?: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_campaign');
    parsed.searchParams.delete('utm_content');
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isCreativeCommonsLicence(
  licence: string | null,
  includePublicDomain = false
): boolean {
  if (!licence) return false;
  const normalized = licence.trim();
  if (!normalized || NON_OPEN_LICENCE_PATTERN.test(normalized)) {
    return false;
  }
  if (CC_LICENCE_PATTERN.test(normalized)) {
    return true;
  }
  if (includePublicDomain && /^(public domain|pd)/i.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * Searches Wikimedia Commons via the public MediaWiki API for genuine,
 * Creative Commons-licensed photographs matching a heritage monument name.
 */
export async function searchImagesForMonument(
  monumentName: string,
  options: WikiSearchOptions = {}
): Promise<WikiMonumentImage[]> {
  const normalizedName = monumentName.trim();
  if (!normalizedName) {
    throw new Error('Monument name is required to query Wikimedia Commons.');
  }

  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 25);
  const fetchLimit = Math.min(limit * 2, 30);
  const thumbnailWidth = Math.min(Math.max(Number(options.thumbnailWidth) || 640, 200), 1600);
  const includePublicDomain = Boolean(options.includePublicDomain);

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${normalizedName} filetype:bitmap`,
    gsrlimit: String(fetchLimit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|sha1|extmetadata',
    iiurlwidth: String(thumbnailWidth),
  });

  const response = await fetch(`${MEDIAWIKI_COMMONS_API}?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`MediaWiki API request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    error?: { info?: string };
    query?: { pages?: Record<string, MediaWikiPage> };
  };

  if (payload.error?.info) {
    throw new Error(`MediaWiki API error: ${payload.error.info}`);
  }

  const pages = Object.values(payload.query?.pages ?? {});
  const results: WikiMonumentImage[] = [];

  for (const page of pages) {
    if (results.length >= limit) break;

    const info = page.imageinfo?.[0];
    if (!page.pageid || !page.title || !info) continue;

    const mimeType = info.mime ?? '';
    if (!SUPPORTED_PHOTO_MIME_TYPES.has(mimeType)) continue;

    const width = Number(info.width ?? 0);
    const height = Number(info.height ?? 0);
    if (width <= 0 || height <= 0) continue;

    const originalUrl = sanitizeImageUrl(info.url);
    const sourcePageUrl = sanitizeImageUrl(info.descriptionurl);
    if (!originalUrl || !sourcePageUrl) continue;

    const ext = info.extmetadata ?? {};
    const licence =
      cleanExtMetadataText(ext.LicenseShortName?.value) ??
      cleanExtMetadataText(ext.UsageTerms?.value);

    if (!isCreativeCommonsLicence(licence, includePublicDomain) || !licence) {
      continue;
    }

    const creator = cleanExtMetadataText(ext.Artist?.value);
    const licenceUrl = sanitizeImageUrl(cleanExtMetadataText(ext.LicenseUrl?.value) ?? undefined);
    const explicitAttribution = cleanExtMetadataText(ext.Attribution?.value);
    const attribution =
      explicitAttribution ??
      (creator ? `${creator} (${licence}) via Wikimedia Commons` : null);
    const description = cleanExtMetadataText(ext.ImageDescription?.value);
    const thumbnailUrl = sanitizeImageUrl(info.thumburl) ?? originalUrl;

    results.push({
      pageId: page.pageid,
      title: page.title,
      filename: page.title.replace(/^File:/i, ''),
      originalUrl,
      thumbnailUrl,
      sourcePageUrl,
      creator,
      licence,
      licenceUrl,
      attribution,
      description,
      width,
      height,
      mimeType,
      sha1: info.sha1 ?? null,
    });
  }

  return results;
}
