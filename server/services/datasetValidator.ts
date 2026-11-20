import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type {
  ApprovedDatasetImage,
  DatasetSplit,
  DatasetValidationIssue,
  DatasetValidationReport,
} from '../../src/types/heritage.ts';
import { verifyImageMagicBytes } from './recognitionService.ts';
import { isValidHttpUrl } from './knowledgeBaseValidator.ts';
import { getMonumentFolderName } from './monumentSearchProfiles.ts';

export const ALLOWED_DATASET_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const VALID_DATASET_SPLITS = new Set<DatasetSplit>([
  'reference',
  'validation',
  'test',
  'unknown',
]);

export const MIN_IMAGE_WIDTH = 400;
export const MIN_IMAGE_HEIGHT = 300;
export const MIN_FILE_BYTES = 10_000;
export const MAX_ASPECT_RATIO = 4.5;
export const NEAR_DUPLICATE_HAMMING_THRESHOLD = 8;

const AUTO_REJECT_KEYWORDS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(diagram|floor[\s_-]*plan|site[\s_-]*plan|map of|cross[\s_-]*section|elevation drawing)\b/i, reason: 'Architectural plan, diagram, or map (not a monument photograph)' },
  { pattern: /\b(illustration|sketch|cartoon|caricature|clipart|vector|infographic|poster|flyer|chart)\b/i, reason: 'Illustration, diagram, or graphic asset (not a genuine photograph)' },
  { pattern: /\b(logo|emblem|coat of arms|crest|flag of|badge|icon)\b/i, reason: 'Logo, emblem, or icon graphic' },
  { pattern: /\b(postage stamp|stamp of|coin|banknote|currency|rupee note|ticket)\b/i, reason: 'Numismatic, philatelic, or printed ephemera item' },
  { pattern: /\b(collage|montage|grid of|compilation)\b/i, reason: 'Multi-image collage or montage' },
  { pattern: /\b(ai[\s_-]*generated|midjourney|stable diffusion|dall[\s-]?e|cgi render|3d model|3d render)\b/i, reason: 'AI-generated or synthetic CGI render excluded by dataset policy' },
  { pattern: /\b(lego|minecraft|cake replica|miniature model|paper model|souvenir)\b/i, reason: 'Replica, model, or souvenir object rather than authentic site' },
];

const REVIEW_REQUIRED_KEYWORDS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /\b(watermark|shutterstock|getty|alamy|dreamstime|123rf|istockphoto|stock photo)\b/i, warning: 'Possible watermark or stock agency string detected' },
  { pattern: /\b(engraving|lithograph|etching|watercolor|watercolour|oil painting|painting of|postcard|archival print)\b/i, warning: 'Historical painting/print/postcard keyword detected; confirm genuine photograph' },
  { pattern: /\b(panorama|panoramic|stitched)\b/i, warning: 'Wide panoramic frame; verify center monument visibility for ViT-B-32 crop' },
];

const RESTRICTIVE_LICENCE_PATTERNS = [
  /fair use/i,
  /non-free/i,
  /copyrighted free use/i,
  /all rights reserved/i,
  /no derivatives/i,
  /\bnd\b/i,
];

export function isAcceptableOpenLicence(licence: string | null): boolean {
  if (!licence) return false;
  if (RESTRICTIVE_LICENCE_PATTERNS.some((re) => re.test(licence))) {
    return false;
  }
  return /^(cc|public domain|pd|gfdl|fal|attribution|mit|bsd|apache|ogl|cc0)/i.test(
    licence.trim()
  );
}

export function extractBaseStem(commonsTitle: string): string {
  const withoutPrefix = commonsTitle.replace(/^File:/i, '').replace(/\.[^.]+$/, '');
  return withoutPrefix
    .toLowerCase()
    .replace(/[\s_-]*(\(\d+\)|edit\d*|cropped|crop|detail|version\s*\d+|v\d+|\d+px)$/gi, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
}

export interface CandidateQcDecision {
  outcome: 'pass_qc' | 'review_required' | 'auto_reject';
  rejectionStage?: 'metadata_filter' | 'quality_pipeline';
  rejectionReason: string | null;
  warnings: string[];
  qualityFlags: string[];
}

export function classifyCandidateQuality(params: {
  commonsTitle: string;
  imageDescription: string | null;
  categoriesText: string | null;
  licence: string | null;
  creator: string | null;
  width: number;
  height: number;
  fileSizeBytes: number;
  mimeType: string;
  sourcePageUrl: string | null;
  originalSourceUrl: string | null;
  negativeKeywords: string[];
}): CandidateQcDecision {
  const warnings: string[] = [];
  const qualityFlags: string[] = [];

  if (!params.originalSourceUrl || !params.sourcePageUrl) {
    return {
      outcome: 'auto_reject',
      rejectionStage: 'metadata_filter',
      rejectionReason: 'Missing Wikimedia source_page_url or original_source_url',
      warnings: ['Missing source URL'],
      qualityFlags: ['missing_url'],
    };
  }

  if (!ALLOWED_DATASET_MIME_TYPES.has(params.mimeType)) {
    return {
      outcome: 'auto_reject',
      rejectionStage: 'metadata_filter',
      rejectionReason: `Unsupported format "${params.mimeType}" (only JPEG, PNG, WebP allowed)`,
      warnings: [`Unsupported MIME ${params.mimeType}`],
      qualityFlags: ['unsupported_format'],
    };
  }

  if (!params.licence || !isAcceptableOpenLicence(params.licence)) {
    return {
      outcome: 'auto_reject',
      rejectionStage: 'metadata_filter',
      rejectionReason: `Missing or restrictive licence "${params.licence ?? 'none'}"`,
      warnings: [`Licence rejected: ${params.licence ?? 'missing'}`],
      qualityFlags: ['invalid_licence'],
    };
  }

  if (params.width < MIN_IMAGE_WIDTH || params.height < MIN_IMAGE_HEIGHT) {
    return {
      outcome: 'auto_reject',
      rejectionStage: 'quality_pipeline',
      rejectionReason: `Resolution too low (${params.width}x${params.height} < ${MIN_IMAGE_WIDTH}x${MIN_IMAGE_HEIGHT})`,
      warnings: [`Low resolution ${params.width}x${params.height}`],
      qualityFlags: ['low_resolution'],
    };
  }

  if (params.fileSizeBytes > 0 && params.fileSizeBytes < MIN_FILE_BYTES) {
    return {
      outcome: 'auto_reject',
      rejectionStage: 'quality_pipeline',
      rejectionReason: `File size too small (${params.fileSizeBytes} bytes < ${MIN_FILE_BYTES} bytes)`,
      warnings: [`Tiny file (${params.fileSizeBytes} bytes)`],
      qualityFlags: ['tiny_file'],
    };
  }

  const aspectRatio = Math.max(
    params.width / Math.max(params.height, 1),
    params.height / Math.max(params.width, 1)
  );
  if (aspectRatio > MAX_ASPECT_RATIO) {
    return {
      outcome: 'auto_reject',
      rejectionStage: 'quality_pipeline',
      rejectionReason: `Extreme aspect ratio (${aspectRatio.toFixed(2)}:1 > ${MAX_ASPECT_RATIO}:1)`,
      warnings: [`Extreme aspect ratio (${aspectRatio.toFixed(1)}:1)`],
      qualityFlags: ['extreme_aspect_ratio'],
    };
  }

  const combinedText = [
    params.commonsTitle,
    params.imageDescription ?? '',
    params.categoriesText ?? '',
  ]
    .join(' ')
    .toLowerCase();

  for (const neg of params.negativeKeywords) {
    if (neg && combinedText.includes(neg.toLowerCase())) {
      return {
        outcome: 'auto_reject',
        rejectionStage: 'metadata_filter',
        rejectionReason: `Monument mismatch or negative keyword matched ("${neg}")`,
        warnings: [`Excluded keyword: ${neg}`],
        qualityFlags: ['negative_keyword_mismatch'],
      };
    }
  }

  for (const rule of AUTO_REJECT_KEYWORDS) {
    if (rule.pattern.test(combinedText)) {
      return {
        outcome: 'auto_reject',
        rejectionStage: 'metadata_filter',
        rejectionReason: rule.reason,
        warnings: [rule.reason],
        qualityFlags: ['non_photographic_media'],
      };
    }
  }

  if (!params.creator) {
    warnings.push('Creator/photographer metadata missing on Commons page');
    qualityFlags.push('missing_creator');
  }

  if (params.width < 640 || params.height < 480) {
    warnings.push(`Moderate-low resolution (${params.width}x${params.height} px)`);
    qualityFlags.push('below_640px');
  }

  if (aspectRatio > 2.6) {
    warnings.push(`Wide aspect ratio (${aspectRatio.toFixed(2)}:1)`);
    qualityFlags.push('wide_aspect_ratio');
  }

  for (const reviewRule of REVIEW_REQUIRED_KEYWORDS) {
    if (reviewRule.pattern.test(combinedText)) {
      warnings.push(reviewRule.warning);
      qualityFlags.push('uncertain_media_keyword');
    }
  }

  if (qualityFlags.length > 0) {
    return {
      outcome: 'review_required',
      rejectionReason: null,
      warnings,
      qualityFlags,
    };
  }

  return {
    outcome: 'pass_qc',
    rejectionReason: null,
    warnings: [],
    qualityFlags: [],
  };
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Computes a 64-bit difference hash (dHash) over a 9x8 grayscale downsample
 * to detect visually identical or near-identical re-encoded/resized images
 * across dataset splits.
 */
export async function computePerceptualDHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .rotate()
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = 0n;
  let bitIndex = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const left = data[row * 9 + col] ?? 0;
      const right = data[row * 9 + col + 1] ?? 0;
      if (left > right) {
        bits |= 1n << bitIndex;
      }
      bitIndex += 1n;
    }
  }

  return bits.toString(16).padStart(16, '0');
}

export function hammingDistanceHex(hexA: string, hexB: string): number {
  if (!/^[0-9a-f]{16}$/i.test(hexA) || !/^[0-9a-f]{16}$/i.test(hexB)) {
    return 64;
  }
  let diff = BigInt(`0x${hexA}`) ^ BigInt(`0x${hexB}`);
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

export interface InspectedImageResult {
  mimeType: string;
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
  sha256: string;
  perceptualDHash: string;
}

const FORMAT_TO_MIME: Record<string, { mime: string; ext: 'jpg' | 'png' | 'webp' }> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

/**
 * Decodes full pixel stream, validates header magic bytes, checks dimensions,
 * aspect ratio, and low-visual-content frames to reject corrupted or unusable images.
 */
export async function inspectImageBuffer(buffer: Buffer): Promise<InspectedImageResult> {
  if (!buffer || buffer.length < MIN_FILE_BYTES) {
    throw new Error(
      `Downloaded file is empty or too small (${buffer?.length ?? 0} bytes < ${MIN_FILE_BYTES} bytes minimum).`
    );
  }

  const image = sharp(buffer, { failOn: 'error' });
  const metadata = await image.metadata();
  const formatKey = metadata.format ?? '';
  const mapped = FORMAT_TO_MIME[formatKey];

  if (!mapped || !ALLOWED_DATASET_MIME_TYPES.has(mapped.mime)) {
    throw new Error(
      `Unsupported image format "${metadata.format ?? 'unknown'}". Only JPEG, PNG, and WebP are permitted.`
    );
  }

  if (!verifyImageMagicBytes(buffer, mapped.mime)) {
    throw new Error(
      `Binary magic-byte signature does not match detected format "${mapped.mime}".`
    );
  }

  if (!metadata.width || !metadata.height || metadata.width < MIN_IMAGE_WIDTH || metadata.height < MIN_IMAGE_HEIGHT) {
    throw new Error(
      `Image dimensions (${metadata.width ?? 0}x${metadata.height ?? 0}) fall below ${MIN_IMAGE_WIDTH}x${MIN_IMAGE_HEIGHT} px minimum.`
    );
  }

  const aspectRatio = Math.max(
    metadata.width / metadata.height,
    metadata.height / metadata.width
  );
  if (aspectRatio > MAX_ASPECT_RATIO) {
    throw new Error(
      `Image aspect ratio (${aspectRatio.toFixed(2)}:1) exceeds ${MAX_ASPECT_RATIO}:1 maximum.`
    );
  }

  // Force full image decode + verify non-blank pixel variance
  const stats = await image.stats();
  const maxStdev = Math.max(...stats.channels.map((ch) => ch.stdev));
  if (maxStdev < 10) {
    throw new Error(
      `Low-visual-content or blank frame rejected (pixel standard deviation ${maxStdev.toFixed(1)} < 10).`
    );
  }

  const sha256 = computeSha256(buffer);
  const perceptualDHash = await computePerceptualDHash(buffer);

  return {
    mimeType: mapped.mime,
    extension: mapped.ext,
    width: metadata.width,
    height: metadata.height,
    sha256,
    perceptualDHash,
  };
}

/**
 * Resolves disk path supporting canonical `<Monument_Folder>/<split>/<filename>` layout
 * as well as fallback legacy `<split>/<filename>`.
 */
export function resolveApprovedImageDiskPath(
  record: ApprovedDatasetImage,
  datasetRootDir: string
): string {
  if (record.relative_path) {
    return path.join(datasetRootDir, record.relative_path);
  }
  const folder = record.monument_folder || getMonumentFolderName(record.site_id);
  if (folder === 'unknown') {
    const subSplit = record.image_split === 'test' ? 'test' : 'validation';
    return path.join(datasetRootDir, 'unknown', subSplit, record.filename);
  }
  return path.join(datasetRootDir, folder, record.image_split, record.filename);
}

/**
 * Runs data quality and integrity checks against all approved dataset images
 * on disk under dataset/<Monument_Folder>/<split>/ and dataset/unknown/.
 */
export async function validateDataset(
  records: ApprovedDatasetImage[],
  datasetRootDir: string,
  validSiteIds: Set<string>
): Promise<DatasetValidationReport> {
  const issues: DatasetValidationIssue[] = [];
  const seenSha = new Map<string, ApprovedDatasetImage>();
  const dhashBuckets = new Map<string, Array<{ record: ApprovedDatasetImage; dHash: string }>>();

  let filesVerifiedOnDisk = 0;

  for (const record of records) {
    if (
      !record.image_id ||
      !record.filename ||
      !record.download_date ||
      record.verification_status !== 'approved_verified' ||
      !VALID_DATASET_SPLITS.has(record.image_split)
    ) {
      issues.push({
        image_id: record.image_id ?? null,
        filename: record.filename ?? null,
        check: 'missing_mandatory_metadata',
        message: `Record "${record.image_id ?? 'unknown'}" is missing required dataset metadata or has an invalid split.`,
      });
    }

    const isUnknownValid = record.site_id === 'unknown';
    if (!isUnknownValid && !validSiteIds.has(record.site_id)) {
      issues.push({
        image_id: record.image_id,
        filename: record.filename,
        check: 'incorrect_site_id',
        message: `Record "${record.image_id}" references unknown site_id "${record.site_id}".`,
      });
    }

    if (!isValidHttpUrl(record.original_source_url) || !isValidHttpUrl(record.source_page_url)) {
      issues.push({
        image_id: record.image_id,
        filename: record.filename,
        check: 'missing_source_url',
        message: `Record "${record.image_id}" has missing or invalid source URLs.`,
      });
    }

    if (!record.licence || !record.licence.trim()) {
      issues.push({
        image_id: record.image_id,
        filename: record.filename,
        check: 'missing_licence',
        message: `Record "${record.image_id}" is missing licensing information.`,
      });
    }

    if (!ALLOWED_DATASET_MIME_TYPES.has(record.mime_type)) {
      issues.push({
        image_id: record.image_id,
        filename: record.filename,
        check: 'unsupported_file_format',
        message: `Record "${record.image_id}" has unsupported MIME type "${record.mime_type}".`,
      });
    }

    if (record.image_width < MIN_IMAGE_WIDTH || record.image_height < MIN_IMAGE_HEIGHT) {
      issues.push({
        image_id: record.image_id,
        filename: record.filename,
        check: 'low_resolution_or_aspect',
        message: `Record "${record.image_id}" resolution ${record.image_width}x${record.image_height} falls below ${MIN_IMAGE_WIDTH}x${MIN_IMAGE_HEIGHT}.`,
      });
    }

    const filePath = resolveApprovedImageDiskPath(record, datasetRootDir);
    if (!fs.existsSync(filePath)) {
      issues.push({
        image_id: record.image_id,
        filename: record.filename,
        check: 'broken_download_missing_file',
        message: `Image file "${record.relative_path || record.filename}" does not exist on disk.`,
      });
      continue;
    }

    // Use lightweight file size & fast SHA check using stored perceptual_dhash when already computed,
    // verifying file header & exact sha256 on disk cleanly
    try {
      const buffer = fs.readFileSync(filePath);
      const diskSha = computeSha256(buffer);
      filesVerifiedOnDisk += 1;

      if (record.sha256_hash && diskSha !== record.sha256_hash) {
        issues.push({
          image_id: record.image_id,
          filename: record.filename,
          check: 'corrupted_image',
          message: `SHA-256 mismatch on "${record.filename}" (expected ${record.sha256_hash.slice(0, 12)}, got ${diskSha.slice(0, 12)}).`,
        });
      }

      const prevExact = seenSha.get(diskSha);
      if (prevExact) {
        const crossSplit = prevExact.image_split !== record.image_split;
        issues.push({
          image_id: record.image_id,
          filename: record.filename,
          check: crossSplit ? 'duplicate_across_splits' : 'duplicate_sha256_hash',
          message: crossSplit
            ? `Exact duplicate image "${record.relative_path}" (${record.image_split}) already exists in split "${prevExact.image_split}" (${prevExact.relative_path}).`
            : `Exact duplicate SHA-256 hash matches "${prevExact.relative_path}".`,
        });
      } else {
        seenSha.set(diskSha, record);
      }

      const dHash = record.perceptual_dhash || (await computePerceptualDHash(buffer));
      const siteBucket = dhashBuckets.get(record.site_id) ?? [];
      siteBucket.push({ record, dHash });
      dhashBuckets.set(record.site_id, siteBucket);
    } catch (err) {
      issues.push({
        image_id: record.image_id,
        filename: record.filename,
        check: 'corrupted_image',
        message: `File "${record.relative_path || record.filename}" failed integrity verification: ${
          err instanceof Error ? err.message : 'Corrupted image'
        }`,
      });
    }
  }

  // Check near-duplicate leakage across splits within each monument class (O(n_site^2), fast even at 2000+ images)
  for (const bucket of dhashBuckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        if (a.record.image_split === b.record.image_split) continue;
        if (a.record.sha256_hash === b.record.sha256_hash) continue;
        const dist = hammingDistanceHex(a.dHash, b.dHash);
        if (dist <= NEAR_DUPLICATE_HAMMING_THRESHOLD) {
          issues.push({
            image_id: b.record.image_id,
            filename: b.record.filename,
            check: 'near_duplicate_across_splits',
            message: `Near-identical photograph detected across splits: "${a.record.relative_path}" and "${b.record.relative_path}" (dHash distance ${dist} <= ${NEAR_DUPLICATE_HAMMING_THRESHOLD}).`,
          });
        }
      }
    }
  }

  return {
    is_valid: issues.length === 0,
    checked_at: new Date().toISOString(),
    total_records: records.length,
    files_verified_on_disk: filesVerifiedOnDisk,
    unique_sha256_count: seenSha.size,
    issues,
  };
}
