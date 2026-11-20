import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ApprovedDatasetImage,
  CandidateApprovalStatus,
  DatasetSplit,
  DatasetSummary,
  DatasetValidationReport,
  DownloadFailureRecord,
  EmbeddingIndexStatus,
  MonumentDatasetCoverage,
  RejectedDatasetRecord,
  WikimediaCandidate,
} from '../../src/types/heritage.ts';
import { findMonumentById, loadMonuments } from './knowledgeBaseService.ts';
import { isValidHttpUrl } from './knowledgeBaseValidator.ts';
import {
  NEAR_DUPLICATE_HAMMING_THRESHOLD,
  VALID_DATASET_SPLITS,
  extractBaseStem,
  hammingDistanceHex,
  inspectImageBuffer,
  isAcceptableOpenLicence,
  resolveApprovedImageDiskPath,
  validateDataset,
} from './datasetValidator.ts';
import {
  MONUMENT_SEARCH_PROFILES,
  getMonumentFolderName,
} from './monumentSearchProfiles.ts';
import {
  fetchCandidatesAcrossAllMonuments,
  fetchCommonsWithBackoff,
  fetchWikimediaCandidates,
} from './wikimediaService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const DATASET_ROOT = path.join(PROJECT_ROOT, 'dataset');
export const EMBEDDINGS_ROOT = path.join(PROJECT_ROOT, 'embeddings');
const LEGACY_IMAGES_ROOT = path.join(DATASET_ROOT, 'images');
const METADATA_ROOT = path.join(DATASET_ROOT, 'metadata');

const IMAGE_METADATA_JSON_PATH = path.join(METADATA_ROOT, 'image_metadata.json');
const IMAGE_METADATA_CSV_PATH = path.join(METADATA_ROOT, 'image_metadata.csv');
const DATASET_SUMMARY_INTERNAL_PATH = path.join(METADATA_ROOT, 'dataset_summary.json');
const REVIEW_QUEUE_JSON_PATH = path.join(METADATA_ROOT, 'review_queue.json');
const REJECTED_RECORDS_JSON_PATH = path.join(METADATA_ROOT, 'rejected_images.json');
const DOWNLOAD_FAILURES_JSON_PATH = path.join(METADATA_ROOT, 'download_failures.json');

// Canonical Section 8 dataset root outputs
export const ROOT_DATASET_METADATA_JSON_PATH = path.join(DATASET_ROOT, 'dataset_metadata.json');
export const ROOT_DATASET_MANIFEST_CSV_PATH = path.join(DATASET_ROOT, 'dataset_manifest.csv');
export const ROOT_IMAGE_ATTRIBUTIONS_CSV_PATH = path.join(DATASET_ROOT, 'image_attributions.csv');
export const ROOT_DOWNLOAD_FAILURES_CSV_PATH = path.join(DATASET_ROOT, 'download_failures.csv');
export const ROOT_REJECTED_IMAGES_CSV_PATH = path.join(DATASET_ROOT, 'rejected_images.csv');
export const ROOT_SPLIT_MANIFEST_CSV_PATH = path.join(DATASET_ROOT, 'split_manifest.csv');
export const ROOT_DATASET_SUMMARY_JSON_PATH = path.join(DATASET_ROOT, 'dataset_summary.json');
export const ROOT_DATASET_README_PATH = path.join(DATASET_ROOT, 'README.md');

export const DEFAULT_TARGET_PER_MONUMENT = 50;
export const DEFAULT_SPLIT_TARGETS = {
  reference: 30,
  validation: 10,
  test: 10,
};

let migrationChecked = false;
let duplicateBlockedSessionCount = 0;

function getDirectorySizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySizeBytes(full);
    } else if (entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name)) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

export function ensureDatasetDirectories(): void {
  fs.mkdirSync(DATASET_ROOT, { recursive: true });
  fs.mkdirSync(METADATA_ROOT, { recursive: true });

  for (const profile of MONUMENT_SEARCH_PROFILES) {
    for (const split of ['reference', 'validation', 'test'] as const) {
      fs.mkdirSync(path.join(DATASET_ROOT, profile.folderName, split), { recursive: true });
    }
  }
  for (const subSplit of ['validation', 'test'] as const) {
    fs.mkdirSync(path.join(DATASET_ROOT, 'unknown', subSplit), { recursive: true });
  }
}

function readJsonArray<T>(filePath: string): T[] {
  ensureDatasetDirectories();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]\n', 'utf-8');
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCsvFile(filePath: string, headers: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
}

function writeManifestCsvFiles(records: ApprovedDatasetImage[]): void {
  const manifestHeaders = [
    'image_id',
    'site_id',
    'monument_folder',
    'monument_name',
    'monument_category',
    'filename',
    'original_filename',
    'relative_path',
    'image_split',
    'image_width',
    'image_height',
    'file_size_bytes',
    'file_format',
    'mime_type',
    'sha256_hash',
    'perceptual_dhash',
    'verification_status',
    'download_date',
    'original_source_url',
    'source_page_url',
    'source_category',
    'creator',
    'licence',
    'licence_url',
    'attribution_text',
  ];

  const manifestRows = records.map((r) => [
    r.image_id,
    r.site_id,
    r.monument_folder,
    r.monument_name,
    r.monument_category,
    r.filename,
    r.original_filename,
    r.relative_path,
    r.image_split,
    r.image_width,
    r.image_height,
    r.file_size_bytes,
    r.file_format,
    r.mime_type,
    r.sha256_hash,
    r.perceptual_dhash,
    r.verification_status,
    r.download_date,
    r.original_source_url,
    r.source_page_url,
    r.source_category,
    r.creator,
    r.licence,
    r.licence_url,
    r.attribution_text,
  ]);

  writeCsvFile(IMAGE_METADATA_CSV_PATH, manifestHeaders, manifestRows);
  writeCsvFile(ROOT_DATASET_MANIFEST_CSV_PATH, manifestHeaders, manifestRows);

  // image_attributions.csv
  writeCsvFile(
    ROOT_IMAGE_ATTRIBUTIONS_CSV_PATH,
    [
      'image_id',
      'monument_name',
      'relative_path',
      'original_filename',
      'source_page_url',
      'original_source_url',
      'creator',
      'licence',
      'licence_url',
      'attribution_text',
    ],
    records.map((r) => [
      r.image_id,
      r.monument_name,
      r.relative_path,
      r.original_filename,
      r.source_page_url,
      r.original_source_url,
      r.creator ?? 'Not specified on Wikimedia Commons',
      r.licence,
      r.licence_url,
      r.attribution_text,
    ])
  );

  // split_manifest.csv
  writeCsvFile(
    ROOT_SPLIT_MANIFEST_CSV_PATH,
    ['image_id', 'site_id', 'monument_folder', 'monument_name', 'image_split', 'relative_path', 'sha256_hash', 'perceptual_dhash'],
    records.map((r) => [
      r.image_id,
      r.site_id,
      r.monument_folder,
      r.monument_name,
      r.image_split,
      r.relative_path,
      r.sha256_hash,
      r.perceptual_dhash,
    ])
  );
}

function writeRejectedCsvFile(rejected: RejectedDatasetRecord[]): void {
  writeCsvFile(
    ROOT_REJECTED_IMAGES_CSV_PATH,
    [
      'candidate_id',
      'site_id',
      'monument_folder',
      'monument_name',
      'commons_title',
      'source_page_url',
      'direct_image_url',
      'licence',
      'image_width',
      'image_height',
      'rejection_stage',
      'rejection_reason',
      'rejected_at',
    ],
    rejected.map((r) => [
      r.candidate_id,
      r.site_id,
      r.monument_folder,
      r.monument_name,
      r.commons_title,
      r.source_page_url,
      r.direct_image_url,
      r.licence,
      r.image_width,
      r.image_height,
      r.rejection_stage,
      r.rejection_reason,
      r.rejected_at,
    ])
  );
}

function writeDownloadFailuresCsvFile(failures: DownloadFailureRecord[]): void {
  writeCsvFile(
    ROOT_DOWNLOAD_FAILURES_CSV_PATH,
    [
      'candidate_id',
      'site_id',
      'monument_folder',
      'monument_name',
      'commons_title',
      'attempted_url',
      'target_split',
      'error_message',
      'http_status',
      'retry_count',
      'failed_at',
    ],
    failures.map((f) => [
      f.candidate_id,
      f.site_id,
      f.monument_folder,
      f.monument_name,
      f.commons_title,
      f.attempted_url,
      f.target_split,
      f.error_message,
      f.http_status,
      f.retry_count,
      f.failed_at,
    ])
  );
}

/**
 * One-time lossless migration from legacy `dataset/images/<split>/<file>` layout
 * into canonical `dataset/<Monument_Folder>/<split>/<file>` + `dataset/unknown/<validation|test>/<file>`.
 */
function migrateLegacyDatasetLayoutIfNeeded(): void {
  ensureDatasetDirectories();

  if (!fs.existsSync(IMAGE_METADATA_JSON_PATH)) return;
  const raw = fs.readFileSync(IMAGE_METADATA_JSON_PATH, 'utf-8').trim();
  if (!raw) return;

  let records: ApprovedDatasetImage[];
  try {
    records = JSON.parse(raw) as ApprovedDatasetImage[];
  } catch {
    return;
  }
  if (!Array.isArray(records) || records.length === 0) return;

  const needsMigration = !migrationChecked || records.some((r) => !r.relative_path || !r.monument_folder);
  migrationChecked = true;
  if (!needsMigration) return;

  let changed = false;
  let unknownToggle = 0;

  const updated = records.map((rec) => {
    if (rec.relative_path && fs.existsSync(path.join(DATASET_ROOT, rec.relative_path))) {
      return rec;
    }

    const folder = rec.site_id === 'unknown' ? 'unknown' : getMonumentFolderName(rec.site_id);
    const monument = rec.site_id === 'unknown' ? null : findMonumentById(rec.site_id);
    let effectiveSplit: DatasetSplit = rec.image_split;
    if (rec.site_id === 'unknown' && rec.image_split === 'unknown') {
      effectiveSplit = unknownToggle % 2 === 0 ? 'validation' : 'test';
      unknownToggle += 1;
    }

    const relPath = path.posix.join(folder, effectiveSplit, rec.filename);
    const destAbs = path.join(DATASET_ROOT, relPath);
    const legacyCandidates = [
      path.join(LEGACY_IMAGES_ROOT, rec.image_split, rec.filename),
      path.join(LEGACY_IMAGES_ROOT, 'unknown', rec.filename),
      path.join(DATASET_ROOT, folder, rec.image_split, rec.filename),
    ];

    if (!fs.existsSync(destAbs)) {
      for (const legacyPath of legacyCandidates) {
        if (fs.existsSync(legacyPath)) {
          fs.mkdirSync(path.dirname(destAbs), { recursive: true });
          fs.renameSync(legacyPath, destAbs);
          break;
        }
      }
    }

    changed = true;
    const ext = path.extname(rec.filename).replace('.', '').toUpperCase() || 'JPEG';
    return {
      ...rec,
      monument_folder: folder,
      monument_name:
        rec.monument_name ?? monument?.name ?? (rec.site_id === 'unknown' ? 'Unknown / Distractor' : rec.site_id),
      monument_category:
        rec.monument_category ??
        monument?.category ??
        (rec.site_id === 'unknown' ? 'Non-Monument Distractor' : 'Heritage Monument'),
      original_filename: rec.original_filename ?? rec.filename,
      relative_path: relPath,
      source_category: rec.source_category ?? null,
      licence_url: rec.licence_url ?? null,
      image_description: rec.image_description ?? null,
      image_split: effectiveSplit,
      file_format: rec.file_format ?? (ext === 'JPG' ? 'JPEG' : ext),
    };
  });

  if (changed) {
    // Clean empty legacy directories
    if (fs.existsSync(LEGACY_IMAGES_ROOT)) {
      fs.rmSync(LEGACY_IMAGES_ROOT, { recursive: true, force: true });
    }
    writeApprovedRecords(updated);
  }
}

export function writeApprovedRecords(records: ApprovedDatasetImage[]): void {
  ensureDatasetDirectories();
  const jsonPayload = `${JSON.stringify(records, null, 2)}\n`;
  fs.writeFileSync(IMAGE_METADATA_JSON_PATH, jsonPayload, 'utf-8');
  fs.writeFileSync(ROOT_DATASET_METADATA_JSON_PATH, jsonPayload, 'utf-8');
  writeManifestCsvFiles(records);
}

export function writeReviewQueue(queue: WikimediaCandidate[]): void {
  ensureDatasetDirectories();
  fs.writeFileSync(REVIEW_QUEUE_JSON_PATH, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');
}

export function loadReviewQueue(): WikimediaCandidate[] {
  migrateLegacyDatasetLayoutIfNeeded();
  return readJsonArray<WikimediaCandidate>(REVIEW_QUEUE_JSON_PATH);
}

export function loadApprovedImages(): ApprovedDatasetImage[] {
  migrateLegacyDatasetLayoutIfNeeded();
  return readJsonArray<ApprovedDatasetImage>(IMAGE_METADATA_JSON_PATH);
}

export function loadRejectedRecords(): RejectedDatasetRecord[] {
  migrateLegacyDatasetLayoutIfNeeded();
  const list = readJsonArray<RejectedDatasetRecord>(REJECTED_RECORDS_JSON_PATH);
  if (!fs.existsSync(ROOT_REJECTED_IMAGES_CSV_PATH)) {
    writeRejectedCsvFile(list);
  }
  return list;
}

export function appendRejectedRecords(incoming: RejectedDatasetRecord[]): void {
  if (incoming.length === 0) return;
  const existing = loadRejectedRecords();
  const byId = new Map(existing.map((r) => [r.candidate_id, r]));
  for (const item of incoming) {
    byId.set(item.candidate_id, item);
  }
  const merged = Array.from(byId.values());
  fs.writeFileSync(REJECTED_RECORDS_JSON_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  writeRejectedCsvFile(merged);
}

export function loadDownloadFailures(): DownloadFailureRecord[] {
  migrateLegacyDatasetLayoutIfNeeded();
  const list = readJsonArray<DownloadFailureRecord>(DOWNLOAD_FAILURES_JSON_PATH);
  if (!fs.existsSync(ROOT_DOWNLOAD_FAILURES_CSV_PATH)) {
    writeDownloadFailuresCsvFile(list);
  }
  return list;
}

export function recordDownloadFailure(failure: DownloadFailureRecord): void {
  const existing = loadDownloadFailures();
  const byId = new Map(existing.map((f) => [f.candidate_id, f]));
  byId.set(failure.candidate_id, failure);
  const updated = Array.from(byId.values());
  fs.writeFileSync(DOWNLOAD_FAILURES_JSON_PATH, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
  writeDownloadFailuresCsvFile(updated);
}

export function removeDownloadFailure(candidateId: string): void {
  const existing = loadDownloadFailures();
  const filtered = existing.filter((f) => f.candidate_id !== candidateId);
  if (filtered.length !== existing.length) {
    fs.writeFileSync(DOWNLOAD_FAILURES_JSON_PATH, `${JSON.stringify(filtered, null, 2)}\n`, 'utf-8');
    writeDownloadFailuresCsvFile(filtered);
  }
}

export function incrementDuplicateBlockedCount(): void {
  duplicateBlockedSessionCount += 1;
}

export function mergeCandidatesIntoQueue(incoming: WikimediaCandidate[]): WikimediaCandidate[] {
  const queue = loadReviewQueue();
  const byId = new Map(queue.map((item) => [item.candidate_id, item]));

  for (const item of incoming) {
    const existing = byId.get(item.candidate_id);
    if (
      existing &&
      (existing.approval_status === 'approved' || existing.approval_status === 'rejected')
    ) {
      continue;
    }
    byId.set(item.candidate_id, item);
  }

  const updated = Array.from(byId.values());
  writeReviewQueue(updated);
  return updated;
}

function readEmbeddingIndexStatus(): EmbeddingIndexStatus {
  const indexJsonPath = path.join(EMBEDDINGS_ROOT, 'reference_index.json');
  const calibrationPath = path.join(EMBEDDINGS_ROOT, 'threshold_calibration_report.json');
  const embeddingsNpyPath = path.join(EMBEDDINGS_ROOT, 'reference_embeddings.npz');

  const base: EmbeddingIndexStatus = {
    generated: false,
    model_name: 'OpenCLIP ViT-B-32',
    checkpoint: 'laion2b_s34b_b79k',
    generated_at: null,
    reference_images_indexed: 0,
    monuments_indexed: 0,
    embeddings_file_exists: fs.existsSync(embeddingsNpyPath),
    threshold_calibrated: false,
    selected_min_similarity: null,
    selected_top2_margin: null,
    note: 'Run python/build_reference_embeddings.py and python/evaluate_unknown_rejection.py locally or in Colab to generate reference index & calibrated thresholds.',
  };

  if (fs.existsSync(indexJsonPath)) {
    try {
      const idx = JSON.parse(fs.readFileSync(indexJsonPath, 'utf-8')) as {
        generated_at?: string;
        reference_image_count?: number;
        monument_count?: number;
        model_name?: string;
        pretrained?: string;
      };
      base.generated = true;
      base.generated_at = idx.generated_at ?? null;
      base.reference_images_indexed = idx.reference_image_count ?? 0;
      base.monuments_indexed = idx.monument_count ?? 0;
      if (idx.model_name) base.model_name = idx.model_name;
      if (idx.pretrained) base.checkpoint = idx.pretrained;
    } catch {
      // Ignore malformed index
    }
  }

  if (fs.existsSync(calibrationPath)) {
    try {
      const cal = JSON.parse(fs.readFileSync(calibrationPath, 'utf-8')) as {
        selected_thresholds?: { min_similarity?: number; min_margin?: number };
      };
      if (cal.selected_thresholds) {
        base.threshold_calibrated = true;
        base.selected_min_similarity = cal.selected_thresholds.min_similarity ?? null;
        base.selected_top2_margin = cal.selected_thresholds.min_margin ?? null;
      }
    } catch {
      // Ignore malformed calibration report
    }
  }

  if (base.generated) {
    base.note = `Reference embeddings built for ${base.reference_images_indexed} images across ${base.monuments_indexed} monuments.`;
  }
  return base;
}

function writeDatasetReadme(summary: DatasetSummary): void {
  const coverageLines = (summary.monument_coverage ?? [])
    .map(
      (c) =>
        `| ${c.monument_folder} | ${c.name} | ${c.reference} | ${c.validation} | ${c.test} | ${c.total} | ${c.review_required} | ${c.rejected} |`
    )
    .join('\n');

  const md = `# HERITAGE VISION — Curated Heritage Image Dataset

**Last Generated:** ${summary.generated_at}  
**Total Verified Photographs On Disk:** ${summary.total_approved_images} (${(summary.total_dataset_bytes / (1024 * 1024)).toFixed(2)} MB)  
**Quality Audit Status:** ${summary.quality_status.is_valid ? 'PASSED (0 issues)' : `${summary.quality_status.issues_count} issue(s)`}

> **Verification Policy:** All photographs are authentic Wikimedia Commons MediaWiki API retrievals preserved with creator/photographer credit, Creative Commons or Public Domain licence metadata, cryptographic SHA-256 checksums, and 64-bit perceptual dHash anti-leakage verification. No synthetic or AI-generated monument photographs are included.

## Folder Structure

\`\`\`
dataset/
├── <Monument_Folder>/
│   ├── reference/          # Gallery reference photographs embedded for OpenCLIP ViT-B-32 matching
│   ├── validation/         # Held-out split for similarity & margin threshold calibration
│   └── test/               # Held-out final evaluation split (single evaluation pass)
├── unknown/
│   ├── validation/         # Non-monument distractors for open-set rejection calibration
│   └── test/               # Held-out non-monument distractors for final open-set evaluation
├── dataset_metadata.json   # Complete JSON manifest
├── dataset_manifest.csv    # Spreadsheet manifest of all verified images
├── image_attributions.csv  # Full attribution & open-licence ledger
├── split_manifest.csv      # Reference / validation / test split assignment index
├── rejected_images.csv     # Automated QC & human rejection log with reasons
├── download_failures.csv   # Retryable network / HTTP failure log
└── dataset_summary.json    # Real-time verified dataset statistics
\`\`\`

## Split Distribution Summary

| Split | Verified Images |
| --- | ---: |
| \`reference\` | ${summary.split_counts.reference} |
| \`validation\` | ${summary.split_counts.validation} |
| \`test\` | ${summary.split_counts.test} |
| \`unknown\` (legacy) | ${summary.split_counts.unknown} |
| **Total** | **${summary.total_approved_images}** |

## Per-Monument Coverage (Target: ${summary.target_per_monument}+ photos per monument)

| Folder | Monument | Reference | Validation | Test | Total | Review Required | Rejected |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${coverageLines}

## OpenCLIP Embedding & Open-Set Rejection Pipeline

- Model: \`ViT-B-32\` (\`laion2b_s34b_b79k\`)
- Scripts:
  - \`python/build_reference_embeddings.py\` — builds L2-normalized reference index strictly from \`reference\` split
  - \`python/evaluate_unknown_rejection.py\` — calibrates similarity & margin thresholds on \`validation\` + \`unknown/validation\`, then evaluates once on \`test\` + \`unknown/test\`
- Scores are reported strictly as cosine similarities (never calibrated probabilities or accuracy).
`;
  fs.writeFileSync(ROOT_DATASET_README_PATH, md, 'utf-8');
}

export async function runDatasetValidation(): Promise<DatasetValidationReport> {
  ensureDatasetDirectories();
  const approved = loadApprovedImages();
  const validSiteIds = new Set(loadMonuments().map((m) => m.id));
  return validateDataset(approved, DATASET_ROOT, validSiteIds);
}

export async function computeAndSaveDatasetSummary(
  targetPerMonument = DEFAULT_TARGET_PER_MONUMENT
): Promise<{
  summary: DatasetSummary;
  validation: DatasetValidationReport;
}> {
  migrateLegacyDatasetLayoutIfNeeded();
  const monuments = loadMonuments();
  const approved = loadApprovedImages();
  const queue = loadReviewQueue();
  const rejected = loadRejectedRecords();
  const failures = loadDownloadFailures();
  const validation = await runDatasetValidation();

  if (!fs.existsSync(ROOT_DATASET_MANIFEST_CSV_PATH) || !fs.existsSync(ROOT_DATASET_METADATA_JSON_PATH)) {
    writeApprovedRecords(approved);
  }
  if (!fs.existsSync(ROOT_REJECTED_IMAGES_CSV_PATH)) {
    writeRejectedCsvFile(rejected);
  }
  if (!fs.existsSync(ROOT_DOWNLOAD_FAILURES_CSV_PATH)) {
    writeDownloadFailuresCsvFile(failures);
  }

  const splitCounts: Record<DatasetSplit, number> = {
    reference: 0,
    validation: 0,
    test: 0,
    unknown: 0,
  };
  const licenceBreakdown: Record<string, number> = {};

  const perSiteMap = new Map<string, MonumentDatasetCoverage>(
    monuments.map((m) => [
      m.id,
      {
        site_id: m.id,
        monument_folder: getMonumentFolderName(m.id),
        name: m.name,
        target_total: targetPerMonument,
        reference: 0,
        validation: 0,
        test: 0,
        total: 0,
        pending_review: 0,
        review_required: 0,
        rejected: 0,
        failed: 0,
        shortfall: targetPerMonument,
      },
    ])
  );

  for (const img of approved) {
    if (VALID_DATASET_SPLITS.has(img.image_split)) {
      splitCounts[img.image_split] += 1;
    }
    licenceBreakdown[img.licence] = (licenceBreakdown[img.licence] ?? 0) + 1;

    const entry = perSiteMap.get(img.site_id);
    if (entry) {
      if (img.image_split === 'reference') entry.reference += 1;
      else if (img.image_split === 'validation') entry.validation += 1;
      else if (img.image_split === 'test') entry.test += 1;
      entry.total += 1;
      entry.shortfall = Math.max(0, entry.target_total - entry.total);
    }
  }

  for (const cand of queue) {
    const entry = perSiteMap.get(cand.site_id);
    if (!entry) continue;
    if (cand.approval_status === 'pending_review') entry.pending_review += 1;
    else if (cand.approval_status === 'review_required') entry.review_required += 1;
  }

  for (const rej of rejected) {
    const entry = perSiteMap.get(rej.site_id);
    if (entry) entry.rejected += 1;
  }

  for (const fail of failures) {
    const entry = perSiteMap.get(fail.site_id);
    if (entry) entry.failed += 1;
  }

  const monumentCoverage = Array.from(perSiteMap.values());
  const monumentsWithReference = monumentCoverage.filter((c) => c.reference > 0).length;
  const monumentsMissingReference = monuments.length - monumentsWithReference;
  const monumentsMeetingTarget = monumentCoverage.filter(
    (c) => c.total >= c.target_total
  ).length;

  const totalDatasetBytes = getDirectorySizeBytes(DATASET_ROOT);
  const embeddingStatus = readEmbeddingIndexStatus();

  const summary: DatasetSummary = {
    generated_at: new Date().toISOString(),
    dataset_complete:
      monumentsWithReference === monuments.length &&
      splitCounts.validation > 0 &&
      splitCounts.test > 0 &&
      validation.is_valid,
    target_per_monument: targetPerMonument,
    target_split_per_monument: DEFAULT_SPLIT_TARGETS,
    total_approved_images: approved.length,
    total_dataset_bytes: totalDatasetBytes,
    monuments_in_schema: monuments.length,
    monuments_with_reference_images: monumentsWithReference,
    monuments_missing_reference_images: monumentsMissingReference,
    monuments_meeting_target: monumentsMeetingTarget,
    split_counts: splitCounts,
    review_queue_counts: {
      pending_review: queue.filter((c) => c.approval_status === 'pending_review').length,
      review_required: queue.filter((c) => c.approval_status === 'review_required').length,
      approved: queue.filter((c) => c.approval_status === 'approved').length,
      rejected: rejected.length,
    },
    failed_downloads_count: failures.length,
    duplicate_blocked_count: duplicateBlockedSessionCount,
    licence_breakdown: licenceBreakdown,
    quality_status: {
      is_valid: validation.is_valid,
      issues_count: validation.issues.length,
    },
    embedding_status: embeddingStatus,
    monument_coverage: monumentCoverage,
    note:
      approved.length === 0
        ? 'No candidates have been approved and downloaded yet.'
        : 'All metrics, hashes, licences, and file counts are computed strictly from verified photographs stored on disk.',
  };

  const jsonStr = `${JSON.stringify(summary, null, 2)}\n`;
  fs.writeFileSync(DATASET_SUMMARY_INTERNAL_PATH, jsonStr, 'utf-8');
  fs.writeFileSync(ROOT_DATASET_SUMMARY_JSON_PATH, jsonStr, 'utf-8');
  writeDatasetReadme(summary);

  return { summary, validation };
}

/**
 * Determines the balanced dataset split (`reference` 60% / `validation` 20% / `test` 20%)
 * while ensuring any variant sharing the same base filename stem stays inside the same split
 * to guarantee zero cross-split leakage.
 */
export function selectBalancedSplitForCandidate(params: {
  siteId: string;
  commonsTitle: string;
  existingForSite: ApprovedDatasetImage[];
  targetTotal: number;
}): DatasetSplit {
  if (params.siteId === 'unknown') {
    const valCount = params.existingForSite.filter((i) => i.image_split === 'validation').length;
    const testCount = params.existingForSite.filter((i) => i.image_split === 'test').length;
    return valCount <= testCount ? 'validation' : 'test';
  }

  const newStem = extractBaseStem(params.commonsTitle);
  if (newStem.length >= 6) {
    const stemMatch = params.existingForSite.find(
      (img) => extractBaseStem(img.original_filename || img.filename) === newStem
    );
    if (stemMatch && (stemMatch.image_split === 'reference' || stemMatch.image_split === 'validation' || stemMatch.image_split === 'test')) {
      return stemMatch.image_split;
    }
  }

  const refTarget = Math.max(1, Math.round(params.targetTotal * 0.6));
  const valTarget = Math.max(1, Math.round(params.targetTotal * 0.2));
  const testTarget = Math.max(1, params.targetTotal - refTarget - valTarget);

  const refCount = params.existingForSite.filter((i) => i.image_split === 'reference').length;
  const valCount = params.existingForSite.filter((i) => i.image_split === 'validation').length;
  const testCount = params.existingForSite.filter((i) => i.image_split === 'test').length;

  const ratios = [
    { split: 'reference' as const, ratio: refCount / refTarget, deficit: refTarget - refCount },
    { split: 'validation' as const, ratio: valCount / valTarget, deficit: valTarget - valCount },
    { split: 'test' as const, ratio: testCount / testTarget, deficit: testTarget - testCount },
  ];

  // Prioritize reference first until baseline coverage exists, then fill lowest completion ratio
  ratios.sort((a, b) => a.ratio - b.ratio || b.deficit - a.deficit);
  return ratios[0].split;
}

let metadataWriteQueue: Promise<unknown> = Promise.resolve();

function withMetadataLock<T>(task: () => T | Promise<T>): Promise<T> {
  const next = metadataWriteQueue.then(task, task);
  metadataWriteQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * Core verified download + binary decode + SHA-256 / dHash deduplication + disk commit helper
 * usable both by manual UI approval and by the resumable automated collector.
 */
export async function commitCandidateToDataset(params: {
  candidate: WikimediaCandidate;
  targetSplit: DatasetSplit;
  deferSummary?: boolean;
}): Promise<ApprovedDatasetImage> {
  const { candidate, targetSplit } = params;

  if (!VALID_DATASET_SPLITS.has(targetSplit)) {
    throw new Error(`Invalid dataset split "${String(targetSplit)}".`);
  }

  const effectiveSiteId = candidate.site_id;
  const effectiveSplit: DatasetSplit =
    effectiveSiteId === 'unknown'
      ? targetSplit === 'test'
        ? 'test'
        : 'validation'
      : targetSplit === 'unknown'
        ? 'reference'
        : targetSplit;

  const downloadTarget = candidate.download_url ?? candidate.original_source_url;
  if (!downloadTarget || !isValidHttpUrl(downloadTarget)) {
    throw new Error('Cannot commit image: missing or invalid download URL.');
  }
  if (!candidate.original_source_url || !isValidHttpUrl(candidate.original_source_url)) {
    throw new Error('Cannot commit image: missing or invalid original_source_url.');
  }
  if (!candidate.source_page_url || !isValidHttpUrl(candidate.source_page_url)) {
    throw new Error('Cannot commit image: missing or invalid source_page_url.');
  }
  if (!candidate.licence || !isAcceptableOpenLicence(candidate.licence)) {
    throw new Error(
      `Cannot commit image: licence "${candidate.licence ?? 'missing'}" is absent or not an open dataset licence.`
    );
  }

  const preApproved = loadApprovedImages();
  const preDuplicateSource = preApproved.find(
    (rec) => rec.source_page_url === candidate.source_page_url
  );
  if (preDuplicateSource) {
    incrementDuplicateBlockedCount();
    throw new Error(
      `Duplicate prevention: "${candidate.source_page_url}" already exists in "${preDuplicateSource.relative_path}".`
    );
  }

  let downloadRes: Response;
  try {
    downloadRes = await fetchCommonsWithBackoff(downloadTarget, {
      timeoutMs: 25000,
      maxRetries: 2,
      binary: true,
    });
  } catch (err) {
    await withMetadataLock(() => {
      recordDownloadFailure({
        candidate_id: candidate.candidate_id,
        site_id: effectiveSiteId,
        monument_folder: candidate.monument_folder || getMonumentFolderName(effectiveSiteId),
        monument_name: candidate.monument_name,
        commons_title: candidate.commons_title,
        attempted_url: downloadTarget,
        target_split: effectiveSplit,
        error_message: err instanceof Error ? err.message : 'Network error during download',
        http_status: null,
        retry_count: 1,
        failed_at: new Date().toISOString(),
      });
    });
    throw err;
  }

  if (!downloadRes.ok) {
    await withMetadataLock(() => {
      recordDownloadFailure({
        candidate_id: candidate.candidate_id,
        site_id: effectiveSiteId,
        monument_folder: candidate.monument_folder || getMonumentFolderName(effectiveSiteId),
        monument_name: candidate.monument_name,
        commons_title: candidate.commons_title,
        attempted_url: downloadTarget,
        target_split: effectiveSplit,
        error_message: `HTTP ${downloadRes.status} from ${downloadTarget}`,
        http_status: downloadRes.status,
        retry_count: 1,
        failed_at: new Date().toISOString(),
      });
    });
    throw new Error(`Image download failed with HTTP ${downloadRes.status}.`);
  }

  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  const inspected = await inspectImageBuffer(buffer);

  const newRecord = await withMetadataLock(() => {
    const approvedRecords = loadApprovedImages();

    const duplicateSource = approvedRecords.find(
      (rec) => rec.source_page_url === candidate.source_page_url
    );
    if (duplicateSource) {
      incrementDuplicateBlockedCount();
      throw new Error(
        `Duplicate prevention: "${candidate.source_page_url}" already exists in "${duplicateSource.relative_path}".`
      );
    }

    const exactDup = approvedRecords.find((r) => r.sha256_hash === inspected.sha256);
    if (exactDup) {
      incrementDuplicateBlockedCount();
      throw new Error(
        `Duplicate SHA-256 hash blocked: identical bytes already exist in "${exactDup.relative_path}".`
      );
    }

    const sameSiteRecords = approvedRecords.filter((r) => r.site_id === effectiveSiteId);
    for (const existing of sameSiteRecords) {
      const dist = hammingDistanceHex(existing.perceptual_dhash, inspected.perceptualDHash);
      if (dist <= NEAR_DUPLICATE_HAMMING_THRESHOLD) {
        incrementDuplicateBlockedCount();
        if (existing.image_split !== effectiveSplit) {
          throw new Error(
            `Cross-split duplicate guard: visually near-identical (dHash dist ${dist}) to "${existing.relative_path}".`
          );
        }
        throw new Error(
          `Near-duplicate guard: visually near-identical (dHash dist ${dist}) to "${existing.relative_path}".`
        );
      }
    }

    const folderName = candidate.monument_folder || getMonumentFolderName(effectiveSiteId);
    const shortHash = crypto.createHash('sha1').update(inspected.sha256).digest('hex').slice(0, 8);
    const imageId = `ds-${effectiveSiteId}-${candidate.commons_page_id}-${shortHash}`;
    const filename = `${effectiveSiteId}_${effectiveSplit}_${candidate.commons_page_id}_${shortHash}.${inspected.extension}`;
    const relativePath = path.posix.join(folderName, effectiveSplit, filename);

    ensureDatasetDirectories();
    const destinationPath = path.join(DATASET_ROOT, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, buffer);

    const now = new Date().toISOString();
    const committed: ApprovedDatasetImage = {
      image_id: imageId,
      site_id: effectiveSiteId,
      monument_folder: folderName,
      monument_name: candidate.monument_name,
      monument_category: candidate.monument_category ?? 'Heritage Monument',
      filename,
      original_filename: candidate.original_filename || candidate.commons_title.replace(/^File:/i, ''),
      relative_path: relativePath,
      original_source_url: candidate.original_source_url!,
      source_page_url: candidate.source_page_url!,
      source_category: candidate.source_category ?? null,
      creator: candidate.creator,
      licence: candidate.licence!,
      licence_url: candidate.licence_url ?? null,
      attribution_text: candidate.attribution_text,
      image_description: candidate.image_description ?? null,
      image_width: inspected.width,
      image_height: inspected.height,
      image_split: effectiveSplit,
      verification_status: 'approved_verified',
      download_date: now.slice(0, 10),
      sha256_hash: inspected.sha256,
      perceptual_dhash: inspected.perceptualDHash,
      file_size_bytes: buffer.length,
      mime_type: inspected.mimeType,
      file_format: inspected.extension.toUpperCase() === 'JPG' ? 'JPEG' : inspected.extension.toUpperCase(),
    };

    approvedRecords.push(committed);
    writeApprovedRecords(approvedRecords);
    removeDownloadFailure(candidate.candidate_id);

    const queue = loadReviewQueue();
    const idx = queue.findIndex((c) => c.candidate_id === candidate.candidate_id);
    if (idx !== -1) {
      queue[idx] = {
        ...queue[idx],
        suggested_split: effectiveSplit,
        approval_status: 'approved',
        rejection_reason: null,
        reviewed_at: now,
      };
    } else {
      queue.push({
        ...candidate,
        suggested_split: effectiveSplit,
        approval_status: 'approved',
        rejection_reason: null,
        reviewed_at: now,
      });
    }
    writeReviewQueue(queue);
    return committed;
  });

  if (!params.deferSummary) {
    await computeAndSaveDatasetSummary();
  }

  return newRecord;
}

export async function approveAndDownloadCandidate(
  candidateId: string,
  targetSplit?: DatasetSplit
): Promise<{
  approvedImage: ApprovedDatasetImage;
  candidate: WikimediaCandidate;
  summary: DatasetSummary;
  validation: DatasetValidationReport;
}> {
  const queue = loadReviewQueue();
  const candidate = queue.find((c) => c.candidate_id === candidateId);
  if (!candidate) {
    throw new Error(`Candidate "${candidateId}" was not found in the review queue.`);
  }

  const split: DatasetSplit = targetSplit ?? candidate.suggested_split ?? 'reference';
  const approvedImage = await commitCandidateToDataset({
    candidate,
    targetSplit: split,
    deferSummary: true,
  });

  const updatedQueue = loadReviewQueue();
  const updatedCandidate = updatedQueue.find((c) => c.candidate_id === candidateId) ?? {
    ...candidate,
    approval_status: 'approved' as const,
  };

  const { summary, validation } = await computeAndSaveDatasetSummary();
  return {
    approvedImage,
    candidate: updatedCandidate,
    summary,
    validation,
  };
}

export async function rejectCandidate(
  candidateId: string,
  reason?: string
): Promise<{
  candidate: WikimediaCandidate;
  summary: DatasetSummary;
}> {
  const queue = loadReviewQueue();
  const idx = queue.findIndex((c) => c.candidate_id === candidateId);
  if (idx === -1) {
    throw new Error(`Candidate "${candidateId}" was not found in the review queue.`);
  }

  const now = new Date().toISOString();
  const rejectionReason = reason?.trim() || 'Rejected during human dataset review';

  queue[idx] = {
    ...queue[idx],
    approval_status: 'rejected',
    rejection_reason: rejectionReason,
    reviewed_at: now,
  };
  writeReviewQueue(queue);

  appendRejectedRecords([
    {
      candidate_id: queue[idx].candidate_id,
      site_id: queue[idx].site_id,
      monument_folder: queue[idx].monument_folder || getMonumentFolderName(queue[idx].site_id),
      monument_name: queue[idx].monument_name,
      commons_title: queue[idx].commons_title,
      source_page_url: queue[idx].source_page_url,
      direct_image_url: queue[idx].download_url ?? queue[idx].original_source_url,
      licence: queue[idx].licence,
      image_width: queue[idx].image_width,
      image_height: queue[idx].image_height,
      rejection_stage: 'human_review',
      rejection_reason: rejectionReason,
      rejected_at: now,
    },
  ]);

  const { summary } = await computeAndSaveDatasetSummary();
  return { candidate: queue[idx], summary };
}

export async function removeApprovedImage(imageId: string): Promise<{
  removedId: string;
  summary: DatasetSummary;
  validation: DatasetValidationReport;
}> {
  const approved = loadApprovedImages();
  const target = approved.find((r) => r.image_id === imageId);
  if (!target) {
    throw new Error(`Approved dataset image "${imageId}" was not found.`);
  }

  const filePath = resolveApprovedImageDiskPath(target, DATASET_ROOT);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  const remaining = approved.filter((r) => r.image_id !== imageId);
  writeApprovedRecords(remaining);

  const queue = loadReviewQueue();
  const updatedQueue = queue.map((c) =>
    c.source_page_url === target.source_page_url && c.approval_status === 'approved'
      ? { ...c, approval_status: 'pending_review' as const, reviewed_at: null }
      : c
  );
  writeReviewQueue(updatedQueue);

  const { summary, validation } = await computeAndSaveDatasetSummary();
  return { removedId: imageId, summary, validation };
}

export async function sourceWikimediaForMonument(params: {
  siteId: string;
  query?: string;
  limit?: number;
  targetSplit?: DatasetSplit;
}) {
  const result = await fetchWikimediaCandidates({
    siteId: params.siteId,
    queryOverride: params.query,
    limit: params.limit ?? 12,
    targetSplit: params.targetSplit,
  });
  mergeCandidatesIntoQueue(result.candidates);
  appendRejectedRecords(result.autoRejected);
  const { summary } = await computeAndSaveDatasetSummary();
  return {
    ...result,
    summary,
  };
}

export async function sourceWikimediaForAllMonuments(limitPerMonument = 4) {
  const result = await fetchCandidatesAcrossAllMonuments(limitPerMonument);
  mergeCandidatesIntoQueue(result.candidates);
  appendRejectedRecords(result.autoRejected);
  const { summary } = await computeAndSaveDatasetSummary();
  return {
    monumentsQueried: result.monumentsQueried,
    totalFetched: result.totalFetched,
    errors: result.errors,
    summary,
  };
}

export function queryCandidates(filters?: {
  siteId?: string;
  status?: CandidateApprovalStatus | 'all';
  search?: string;
  page?: number;
  limit?: number;
}): {
  candidates: WikimediaCandidate[];
  total: number;
  page: number;
  totalPages: number;
} {
  const queue = loadReviewQueue();
  const siteFilter = filters?.siteId?.trim() ?? '';
  const statusFilter = filters?.status ?? 'all';
  const search = filters?.search?.trim().toLowerCase() ?? '';

  const filtered = queue.filter((c) => {
    const matchesSite = !siteFilter || siteFilter === 'all' || c.site_id === siteFilter;
    const matchesStatus = statusFilter === 'all' || c.approval_status === statusFilter;
    const matchesSearch =
      !search ||
      c.monument_name.toLowerCase().includes(search) ||
      c.commons_title.toLowerCase().includes(search) ||
      (c.creator ?? '').toLowerCase().includes(search) ||
      (c.licence ?? '').toLowerCase().includes(search);
    return matchesSite && matchesStatus && matchesSearch;
  });

  const limit = Math.min(Math.max(filters?.limit ?? 24, 1), 100);
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const page = Math.min(Math.max(filters?.page ?? 1, 1), totalPages);
  const offset = (page - 1) * limit;

  return {
    candidates: filtered.slice(offset, offset + limit),
    total: filtered.length,
    page,
    totalPages,
  };
}

export function queryApprovedImagesPaginated(filters?: {
  siteId?: string;
  split?: DatasetSplit | 'all';
  licence?: string;
  search?: string;
  page?: number;
  limit?: number;
}): {
  images: ApprovedDatasetImage[];
  total: number;
  page: number;
  totalPages: number;
  availableLicences: string[];
} {
  const all = loadApprovedImages();
  const licenceSet = new Set(all.map((i) => i.licence).filter(Boolean));
  const siteFilter = filters?.siteId?.trim() ?? '';
  const splitFilter = filters?.split ?? 'all';
  const licenceFilter = filters?.licence?.trim() ?? '';
  const search = filters?.search?.trim().toLowerCase() ?? '';

  const filtered = all.filter((img) => {
    const matchesSite = !siteFilter || siteFilter === 'all' || img.site_id === siteFilter;
    const matchesSplit = !splitFilter || splitFilter === 'all' || img.image_split === splitFilter;
    const matchesLicence =
      !licenceFilter || licenceFilter === 'all' || img.licence === licenceFilter;
    const matchesSearch =
      !search ||
      img.filename.toLowerCase().includes(search) ||
      (img.monument_name ?? '').toLowerCase().includes(search) ||
      img.site_id.toLowerCase().includes(search) ||
      (img.creator ?? '').toLowerCase().includes(search) ||
      img.licence.toLowerCase().includes(search) ||
      img.sha256_hash.toLowerCase().startsWith(search);
    return matchesSite && matchesSplit && matchesLicence && matchesSearch;
  });

  const limit = Math.min(Math.max(filters?.limit ?? 24, 1), 200);
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const page = Math.min(Math.max(filters?.page ?? 1, 1), totalPages);
  const offset = (page - 1) * limit;

  return {
    images: filtered.slice(offset, offset + limit),
    total: filtered.length,
    page,
    totalPages,
    availableLicences: Array.from(licenceSet).sort(),
  };
}
