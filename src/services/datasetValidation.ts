import type { DatasetSplit } from '../types/heritage';

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const DEFAULT_MIN_IMAGE_WIDTH = 400;
export const DEFAULT_MIN_IMAGE_HEIGHT = 300;
export const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB

const NON_FREE_LICENCE_PATTERN =
  /(fair use|non-free|all rights reserved|copyrighted|no derivatives|cc by-nc-nd)/i;
const OPEN_CC_OR_PD_PATTERN = /^(cc(?:\s|-|0)|creative commons|public domain|pd)/i;
const ATTRIBUTION_REQUIRED_PATTERN = /^cc(?:\s|-)(?:by)/i;

export type DatasetCandidateValidationIssueCode =
  | 'empty_or_truncated_file'
  | 'file_too_large'
  | 'unsupported_format'
  | 'corrupted_image_header'
  | 'corrupted_image_body'
  | 'low_resolution'
  | 'missing_licence'
  | 'unacceptable_licence'
  | 'missing_attribution_creator'
  | 'missing_or_invalid_source_url'
  | 'missing_or_invalid_site_id'
  | 'duplicate_content_hash'
  | 'duplicate_across_splits'
  | 'duplicate_source_url';

export interface DatasetValidationIssueItem {
  code: DatasetCandidateValidationIssueCode;
  field: string;
  message: string;
}

export interface ImageIntegrityResult {
  isValid: boolean;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  byteLength: number;
  sha256Hash: string | null;
  issues: DatasetValidationIssueItem[];
}

export interface LicenceMetadataInput {
  siteId: string;
  originalUrl: string | null | undefined;
  sourcePageUrl: string | null | undefined;
  licence: string | null | undefined;
  creator?: string | null;
  attribution?: string | null;
  split?: DatasetSplit;
  validSiteIds?: Set<string>;
}

export interface LicenceValidationResult {
  isValid: boolean;
  normalizedLicence: string | null;
  requiresAttribution: boolean;
  issues: DatasetValidationIssueItem[];
  warnings: string[];
}

export interface ExistingContentRecord {
  imageId: string;
  siteId?: string;
  split?: DatasetSplit;
  sha256Hash: string;
  sourcePageUrl?: string | null;
  filename?: string | null;
}

export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  crossSplitLeak: boolean;
  matchedRecord: ExistingContentRecord | null;
  issues: DatasetValidationIssueItem[];
}

export interface DatasetCandidateValidationInput {
  bytes: ArrayBuffer | Uint8Array;
  declaredMimeType?: string | null;
  metadata: LicenceMetadataInput;
  existingRecords?: ExistingContentRecord[];
  minWidth?: number;
  minHeight?: number;
  maxBytes?: number;
}

export interface DatasetCandidateValidationReport {
  accepted: boolean;
  sha256Hash: string | null;
  integrity: ImageIntegrityResult;
  licenceCheck: LicenceValidationResult;
  duplicateCheck: DuplicateCheckResult;
  issues: DatasetValidationIssueItem[];
  warnings: string[];
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function isValidHttpUrlString(raw?: string | null): boolean {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return false;
  if (/\s/.test(raw.trim())) return false;
  try {
    const parsed = new URL(raw.trim());
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      Boolean(parsed.hostname) &&
      parsed.hostname.includes('.')
    );
  } catch {
    return false;
  }
}

function detectMimeByMagicBytes(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number; hasIend: boolean } | null {
  if (bytes.length < 33) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // First chunk at offset 8 must be IHDR (length=13 at offset 8, type 'IHDR' at offset 12)
  const ihdrType =
    String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (ihdrType !== 'IHDR') return null;
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);

  // Verify trailing IEND marker exists anywhere near end (allows trailing null padding checks cleanly)
  let hasIend = false;
  const tailStart = Math.max(0, bytes.length - 64);
  for (let i = tailStart; i <= bytes.length - 8; i += 1) {
    if (
      bytes[i] === 0x49 &&
      bytes[i + 1] === 0x45 &&
      bytes[i + 2] === 0x4e &&
      bytes[i + 3] === 0x44
    ) {
      hasIend = true;
      break;
    }
  }

  return { width, height, hasIend };
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number; hasEoi: boolean } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  let width = 0;
  let height = 0;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;

    // Standalone markers (TEM, RST0..7, SOI, EOI)
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      if (marker === 0xd9) break;
      continue;
    }

    if (offset + 1 >= bytes.length) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof && segmentLength >= 7) {
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      break;
    }

    offset += segmentLength;
  }

  // Check EOI marker FF D9 near end of stream
  let hasEoi = false;
  const tailStart = Math.max(2, bytes.length - 16);
  for (let i = tailStart; i < bytes.length - 1; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      hasEoi = true;
      break;
    }
  }

  if (width <= 0 || height <= 0) return null;
  return { width, height, hasEoi };
}

function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number; validSize: boolean } | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  const validSize = bytes.length >= riffSize + 8;
  const chunkHeader = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunkHeader === 'VP8X' && bytes.length >= 30) {
    const widthMinusOne = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
    const heightMinusOne = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
    return { width: widthMinusOne + 1, height: heightMinusOne + 1, validSize };
  }

  if (chunkHeader === 'VP8 ' && bytes.length >= 30) {
    // Keyframe start code 0x9d 0x01 0x2a at offset 23..25
    if (bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      return { width, height, validSize };
    }
  }

  if (chunkHeader === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    return { width, height, validSize };
  }

  return null;
}

/**
 * Computes a lowercase hex SHA-256 content hash using the Web Crypto API
 * (works identically in modern browsers and Node.js runtimes).
 */
export async function computeContentHash(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = toUint8Array(input);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  const digestBytes = new Uint8Array(digestBuffer);
  return Array.from(digestBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies binary magic bytes, format consistency, structural EOF/IEND integrity,
 * pixel decode capability (when createImageBitmap is available), and minimum resolution.
 */
export async function verifyImageFileIntegrity(
  input: ArrayBuffer | Uint8Array,
  options: {
    declaredMimeType?: string | null;
    minWidth?: number;
    minHeight?: number;
    maxBytes?: number;
  } = {}
): Promise<ImageIntegrityResult> {
  const bytes = toUint8Array(input);
  const issues: DatasetValidationIssueItem[] = [];
  const minWidth = options.minWidth ?? DEFAULT_MIN_IMAGE_WIDTH;
  const minHeight = options.minHeight ?? DEFAULT_MIN_IMAGE_HEIGHT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;

  if (bytes.length < 64) {
    issues.push({
      code: 'empty_or_truncated_file',
      field: 'file',
      message: `Image buffer is empty or too short (${bytes.length} bytes).`,
    });
    return {
      isValid: false,
      mimeType: null,
      width: null,
      height: null,
      byteLength: bytes.length,
      sha256Hash: null,
      issues,
    };
  }

  if (bytes.length > maxBytes) {
    issues.push({
      code: 'file_too_large',
      field: 'file',
      message: `Image size (${bytes.length} bytes) exceeds maximum limit of ${maxBytes} bytes.`,
    });
  }

  const detectedMime = detectMimeByMagicBytes(bytes);
  if (!detectedMime || !ALLOWED_IMAGE_MIME_TYPES.has(detectedMime)) {
    issues.push({
      code: 'unsupported_format',
      field: 'mimeType',
      message: 'File signature does not match a supported JPEG, PNG, or WebP image.',
    });
    return {
      isValid: false,
      mimeType: null,
      width: null,
      height: null,
      byteLength: bytes.length,
      sha256Hash: null,
      issues,
    };
  }

  if (options.declaredMimeType && options.declaredMimeType !== detectedMime) {
    issues.push({
      code: 'unsupported_format',
      field: 'mimeType',
      message: `Declared MIME type "${options.declaredMimeType}" disagrees with detected signature "${detectedMime}".`,
    });
  }

  let width: number | null = null;
  let height: number | null = null;

  if (detectedMime === 'image/jpeg') {
    const parsed = parseJpegDimensions(bytes);
    if (!parsed) {
      issues.push({
        code: 'corrupted_image_header',
        field: 'file',
        message: 'Unable to parse valid JPEG SOF frame dimensions from binary stream.',
      });
    } else {
      width = parsed.width;
      height = parsed.height;
      if (!parsed.hasEoi) {
        issues.push({
          code: 'corrupted_image_body',
          field: 'file',
          message: 'JPEG stream is missing trailing EOI (FF D9) end marker and may be truncated.',
        });
      }
    }
  } else if (detectedMime === 'image/png') {
    const parsed = parsePngDimensions(bytes);
    if (!parsed || parsed.width <= 0 || parsed.height <= 0) {
      issues.push({
        code: 'corrupted_image_header',
        field: 'file',
        message: 'Unable to parse valid PNG IHDR chunk dimensions.',
      });
    } else {
      width = parsed.width;
      height = parsed.height;
      if (!parsed.hasIend) {
        issues.push({
          code: 'corrupted_image_body',
          field: 'file',
          message: 'PNG stream is missing trailing IEND chunk and may be truncated.',
        });
      }
    }
  } else if (detectedMime === 'image/webp') {
    const parsed = parseWebpDimensions(bytes);
    if (!parsed || parsed.width <= 0 || parsed.height <= 0) {
      issues.push({
        code: 'corrupted_image_header',
        field: 'file',
        message: 'Unable to parse valid WebP VP8/VP8L/VP8X dimensions.',
      });
    } else {
      width = parsed.width;
      height = parsed.height;
      if (!parsed.validSize) {
        issues.push({
          code: 'corrupted_image_body',
          field: 'file',
          message: 'WebP RIFF chunk byte size indicates a truncated download.',
        });
      }
    }
  }

  // Optional browser pixel-decode verification when running inside DOM with createImageBitmap
  if (typeof globalThis.createImageBitmap === 'function' && issues.length === 0) {
    try {
      const blobCopy = new Uint8Array(bytes.byteLength);
      blobCopy.set(bytes);
      const blob = new Blob([blobCopy.buffer], { type: detectedMime });
      const bitmap = await globalThis.createImageBitmap(blob);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      issues.push({
        code: 'corrupted_image_body',
        field: 'file',
        message: 'Browser image decoder failed to decode pixel data from this file.',
      });
    }
  }

  if (width !== null && height !== null && (width < minWidth || height < minHeight)) {
    issues.push({
      code: 'low_resolution',
      field: 'dimensions',
      message: `Image resolution (${width}x${height} px) is below minimum quality threshold (${minWidth}x${minHeight} px).`,
    });
  }

  const sha256Hash = await computeContentHash(bytes);

  return {
    isValid: issues.length === 0,
    mimeType: detectedMime,
    width,
    height,
    byteLength: bytes.length,
    sha256Hash,
    issues,
  };
}

/**
 * Validates licensing terms, attribution provenance, source URLs, and site_id consistency.
 */
export function verifyLicenceMetadata(metadata: LicenceMetadataInput): LicenceValidationResult {
  const issues: DatasetValidationIssueItem[] = [];
  const warnings: string[] = [];

  const siteId = metadata.siteId?.trim() ?? '';
  if (!siteId || !/^[a-z0-9-]+$/i.test(siteId)) {
    issues.push({
      code: 'missing_or_invalid_site_id',
      field: 'siteId',
      message: 'A valid monument site_id (or "unknown") is required.',
    });
  } else if (metadata.validSiteIds) {
    const isUnknownValid = metadata.split === 'unknown' && siteId === 'unknown';
    if (!isUnknownValid && !metadata.validSiteIds.has(siteId)) {
      issues.push({
        code: 'missing_or_invalid_site_id',
        field: 'siteId',
        message: `Site ID "${siteId}" does not match any record in the monument knowledge base.`,
      });
    }
  }

  if (!isValidHttpUrlString(metadata.originalUrl)) {
    issues.push({
      code: 'missing_or_invalid_source_url',
      field: 'originalUrl',
      message: 'Missing or invalid original_source_url.',
    });
  }

  if (!isValidHttpUrlString(metadata.sourcePageUrl)) {
    issues.push({
      code: 'missing_or_invalid_source_url',
      field: 'sourcePageUrl',
      message: 'Missing or invalid source_page_url.',
    });
  }

  const normalizedLicence = metadata.licence?.trim() || null;
  let requiresAttribution = false;

  if (!normalizedLicence) {
    issues.push({
      code: 'missing_licence',
      field: 'licence',
      message: 'Licence metadata is missing; un-licensed images cannot enter the dataset.',
    });
  } else if (
    NON_FREE_LICENCE_PATTERN.test(normalizedLicence) ||
    !OPEN_CC_OR_PD_PATTERN.test(normalizedLicence)
  ) {
    issues.push({
      code: 'unacceptable_licence',
      field: 'licence',
      message: `Licence "${normalizedLicence}" is not an approved open Creative Commons or Public Domain dataset licence.`,
    });
  } else {
    requiresAttribution = ATTRIBUTION_REQUIRED_PATTERN.test(normalizedLicence);
    if (requiresAttribution && !metadata.creator?.trim() && !metadata.attribution?.trim()) {
      warnings.push(
        `Licence "${normalizedLicence}" requires attribution, but creator/attribution metadata is empty and should be verified manually.`
      );
    }
  }

  return {
    isValid: issues.length === 0,
    normalizedLicence,
    requiresAttribution,
    issues,
    warnings,
  };
}

/**
 * Checks whether a SHA-256 content hash or source page URL already exists in the dataset,
 * explicitly flagging cross-split leakage (e.g. identical image in both reference and test).
 */
export function detectDuplicateContentHash(
  sha256Hash: string,
  existingRecords: ExistingContentRecord[],
  options: {
    targetSplit?: DatasetSplit;
    sourcePageUrl?: string | null;
  } = {}
): DuplicateCheckResult {
  const issues: DatasetValidationIssueItem[] = [];
  const normalizedHash = sha256Hash.trim().toLowerCase();

  const exactMatch =
    existingRecords.find((rec) => rec.sha256Hash.toLowerCase() === normalizedHash) ?? null;

  let crossSplitLeak = false;

  if (exactMatch) {
    crossSplitLeak = Boolean(
      options.targetSplit && exactMatch.split && exactMatch.split !== options.targetSplit
    );

    issues.push({
      code: crossSplitLeak ? 'duplicate_across_splits' : 'duplicate_content_hash',
      field: 'sha256Hash',
      message: crossSplitLeak
        ? `Duplicate content hash (${normalizedHash.slice(0, 12)}…) blocked: identical image already exists in split "${exactMatch.split}" (${exactMatch.filename ?? exactMatch.imageId}).`
        : `Duplicate content hash (${normalizedHash.slice(0, 12)}…) matches existing dataset entry "${exactMatch.filename ?? exactMatch.imageId}".`,
    });
  } else if (options.sourcePageUrl) {
    const normalizedUrl = options.sourcePageUrl.trim();
    const urlMatch = existingRecords.find(
      (rec) => rec.sourcePageUrl && rec.sourcePageUrl.trim() === normalizedUrl
    );
    if (urlMatch) {
      issues.push({
        code: 'duplicate_source_url',
        field: 'sourcePageUrl',
        message: `Source page URL is already registered in split "${urlMatch.split ?? 'unknown'}" (${urlMatch.filename ?? urlMatch.imageId}).`,
      });
    }
  }

  return {
    hasDuplicate: issues.length > 0,
    crossSplitLeak,
    matchedRecord: exactMatch,
    issues,
  };
}

/**
 * Scans a full list of dataset metadata records to detect any internal duplicates or cross-split leaks.
 */
export function findDuplicateHashesInDataset(
  records: ExistingContentRecord[]
): Array<{
  primary: ExistingContentRecord;
  duplicate: ExistingContentRecord;
  crossSplit: boolean;
}> {
  const seenByHash = new Map<string, ExistingContentRecord>();
  const duplicates: Array<{
    primary: ExistingContentRecord;
    duplicate: ExistingContentRecord;
    crossSplit: boolean;
  }> = [];

  for (const record of records) {
    const key = record.sha256Hash.trim().toLowerCase();
    const existing = seenByHash.get(key);
    if (existing) {
      duplicates.push({
        primary: existing,
        duplicate: record,
        crossSplit: Boolean(existing.split && record.split && existing.split !== record.split),
      });
    } else {
      seenByHash.set(key, record);
    }
  }

  return duplicates;
}

/**
 * Full pre-ingestion verification pipeline combining image integrity, licence provenance,
 * and SHA-256 duplicate content hashing before an image enters the dataset.
 */
export async function validateDatasetCandidate(
  input: DatasetCandidateValidationInput
): Promise<DatasetCandidateValidationReport> {
  const integrity = await verifyImageFileIntegrity(input.bytes, {
    declaredMimeType: input.declaredMimeType,
    minWidth: input.minWidth,
    minHeight: input.minHeight,
    maxBytes: input.maxBytes,
  });

  const licenceCheck = verifyLicenceMetadata(input.metadata);

  const duplicateCheck = integrity.sha256Hash
    ? detectDuplicateContentHash(integrity.sha256Hash, input.existingRecords ?? [], {
        targetSplit: input.metadata.split,
        sourcePageUrl: input.metadata.sourcePageUrl,
      })
    : {
        hasDuplicate: false,
        crossSplitLeak: false,
        matchedRecord: null,
        issues: [],
      };

  const issues = [
    ...integrity.issues,
    ...licenceCheck.issues,
    ...duplicateCheck.issues,
  ];

  return {
    accepted: issues.length === 0,
    sha256Hash: integrity.sha256Hash,
    integrity,
    licenceCheck,
    duplicateCheck,
    issues,
    warnings: licenceCheck.warnings,
  };
}
