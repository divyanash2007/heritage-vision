import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FolderCheck,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  approveDatasetCandidate,
  fetchApprovedDatasetImages,
  fetchCollectionStatus,
  fetchDatasetCandidates,
  fetchDatasetRejected,
  fetchDatasetSummary,
  fetchDatasetValidation,
  fetchMonuments,
  pauseDatasetCollection,
  rejectDatasetCandidate,
  removeApprovedDatasetImage,
  resumeDatasetCollection,
  retryDatasetFailures,
  sourceAllMonumentsFromWikimedia,
  sourceWikimediaCandidates,
  startDatasetCollection,
} from '../lib/api';
import { auditDatasetIntegrity } from '../services/datasetOrchestrator';
import type {
  ApprovedDatasetImage,
  CandidateApprovalStatus,
  CollectionJobProgress,
  DatasetSplit,
  DatasetSummary,
  DatasetValidationReport,
  DownloadFailureRecord,
  MonumentRecord,
  RejectedDatasetRecord,
  WikimediaCandidate,
} from '../types/heritage';
import type { AppRoute } from '../components/Navbar';

interface DatasetManagerPageProps {
  onNavigate: (route: AppRoute) => void;
}

const SPLIT_OPTIONS: Array<{ value: DatasetSplit; label: string }> = [
  { value: 'reference', label: 'reference' },
  { value: 'validation', label: 'validation' },
  { value: 'test', label: 'test' },
  { value: 'unknown', label: 'unknown' },
];

const AUDIT_CHECKS: Array<{
  key: string;
  label: string;
  description: string;
  issueCodes: string[];
}> = [
  {
    key: 'disk',
    label: 'Disk Presence & Readable Bitstream',
    description:
      'Confirms every manifest row resolves to an existing photograph under dataset/<Monument_Folder>/<split>/.',
    issueCodes: ['broken_download_missing_file'],
  },
  {
    key: 'decode',
    label: 'Magic Bytes & Full Pixel Decode',
    description:
      'Verifies JPEG/PNG/WebP headers, dimensions (>=400x300), aspect ratio, and non-blank pixel variance.',
    issueCodes: ['unsupported_file_format', 'corrupted_image', 'low_resolution_or_aspect'],
  },
  {
    key: 'sha256',
    label: 'SHA-256 Byte Deduplication',
    description:
      'Blocks exact duplicate files within or across splits using cryptographic SHA-256 digests.',
    issueCodes: ['duplicate_sha256_hash', 'duplicate_across_splits'],
  },
  {
    key: 'dhash',
    label: '64-Bit Perceptual dHash Cross-Split Guard',
    description:
      'Prevents visually near-identical resized/recompressed photos from leaking across splits.',
    issueCodes: ['near_duplicate_across_splits'],
  },
  {
    key: 'provenance',
    label: 'Source URL & Open-Licence Provenance',
    description:
      'Ensures valid HTTP Commons page URLs, creator attribution, and CC/Public Domain licences.',
    issueCodes: ['missing_source_url', 'missing_licence', 'missing_mandatory_metadata'],
  },
  {
    key: 'site_ids',
    label: 'Canonical 20-Site Schema Integrity',
    description:
      'Validates all non-unknown records against verified heritage site IDs in monuments.json.',
    issueCodes: ['incorrect_site_id'],
  },
];

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getApprovedImageSrc(img: ApprovedDatasetImage): string {
  if (img.relative_path) {
    return `/dataset-images/${img.relative_path.split('/').map(encodeURIComponent).join('/')}`;
  }
  const folder = img.monument_folder || img.site_id;
  return `/dataset-images/${encodeURIComponent(folder)}/${encodeURIComponent(img.image_split)}/${encodeURIComponent(img.filename)}`;
}

export function DatasetManagerPage({ onNavigate }: DatasetManagerPageProps) {
  const [monuments, setMonuments] = useState<MonumentRecord[]>([]);
  const [summary, setSummary] = useState<DatasetSummary | null>(null);
  const [validation, setValidation] = useState<DatasetValidationReport | null>(null);
  const [collectionProgress, setCollectionProgress] = useState<CollectionJobProgress | null>(null);

  // Paginated Approved view
  const [approvedImages, setApprovedImages] = useState<ApprovedDatasetImage[]>([]);
  const [approvedTotal, setApprovedTotal] = useState(0);
  const [approvedPage, setApprovedPage] = useState(1);
  const [approvedTotalPages, setApprovedTotalPages] = useState(1);
  const [availableLicences, setAvailableLicences] = useState<string[]>([]);
  const [approvedSplitFilter, setApprovedSplitFilter] = useState<DatasetSplit | 'all'>('all');
  const [approvedSiteFilter, setApprovedSiteFilter] = useState<string>('all');
  const [approvedLicenceFilter, setApprovedLicenceFilter] = useState<string>('all');
  const [approvedSearch, setApprovedSearch] = useState<string>('');

  // Paginated Candidate / Review Queue view
  const [candidates, setCandidates] = useState<WikimediaCandidate[]>([]);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [candidatesPage, setCandidatesPage] = useState(1);
  const [candidatesTotalPages, setCandidatesTotalPages] = useState(1);
  const [filterSiteId, setFilterSiteId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<CandidateApprovalStatus | 'all'>('all');
  const [candidateSearch, setCandidateSearch] = useState<string>('');
  const [candidateSplitMap, setCandidateSplitMap] = useState<Record<string, DatasetSplit>>({});

  // Rejected & Failed Downloads
  const [rejectedRecords, setRejectedRecords] = useState<RejectedDatasetRecord[]>([]);
  const [downloadFailures, setDownloadFailures] = useState<DownloadFailureRecord[]>([]);

  const [activeTab, setActiveTab] = useState<'approved' | 'review' | 'rejected' | 'audit'>('approved');

  // Automated Collection Controls
  const [collectMode, setCollectMode] = useState<'all_monuments' | 'single_monument' | 'unknown_only'>('all_monuments');
  const [collectTarget, setCollectTarget] = useState<number>(50);
  const [collectSiteId, setCollectSiteId] = useState<string>('taj-mahal');
  const [retryingFailures, setRetryingFailures] = useState(false);

  // Manual Sourcing Workbench
  const [selectedSiteId, setSelectedSiteId] = useState<string>('taj-mahal');
  const [queryOverride, setQueryOverride] = useState<string>('');
  const [defaultSplit, setDefaultSplit] = useState<DatasetSplit>('validation');

  // UI Helpers & Modals
  const [brokenImageIds, setBrokenImageIds] = useState<Record<string, boolean>>({});
  const [lightboxImage, setLightboxImage] = useState<ApprovedDatasetImage | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourcing, setSourcing] = useState(false);
  const [batchSourcing, setBatchSourcing] = useState(false);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [busyRemoveId, setBusyRemoveId] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const monumentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of monuments) {
      map.set(m.id, m.name);
    }
    map.set('unknown', 'Unknown / Distractor Class');
    return map;
  }, [monuments]);

  const loadApprovedPage = useCallback(async () => {
    const res = await fetchApprovedDatasetImages({
      siteId: approvedSiteFilter,
      split: approvedSplitFilter,
      licence: approvedLicenceFilter,
      search: approvedSearch,
      page: approvedPage,
      limit: 24,
    });
    setApprovedImages(res.images);
    setApprovedTotal(res.total);
    setApprovedTotalPages(res.totalPages);
    setAvailableLicences(res.availableLicences);
    setValidation(res.validation);
  }, [approvedSiteFilter, approvedSplitFilter, approvedLicenceFilter, approvedSearch, approvedPage]);

  const loadCandidatesPage = useCallback(async () => {
    const res = await fetchDatasetCandidates({
      siteId: filterSiteId,
      status: filterStatus,
      search: candidateSearch,
      page: candidatesPage,
      limit: 24,
    });
    setCandidates(res.candidates);
    setCandidatesTotal(res.total);
    setCandidatesTotalPages(res.totalPages);
  }, [filterSiteId, filterStatus, candidateSearch, candidatesPage]);

  const refreshAll = useCallback(async () => {
    const [sumRes, colRes, rejRes] = await Promise.all([
      fetchDatasetSummary(),
      fetchCollectionStatus(),
      fetchDatasetRejected(),
    ]);
    setSummary(sumRes.summary);
    setValidation(sumRes.validation);
    setCollectionProgress(colRes.progress);
    setRejectedRecords(rejRes.rejected);
    setDownloadFailures(rejRes.failures);
    await Promise.all([loadApprovedPage(), loadCandidatesPage()]);
  }, [loadApprovedPage, loadCandidatesPage]);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        setLoading(true);
        const [monRes, sumRes, colRes, rejRes, appRes, candRes] = await Promise.all([
          fetchMonuments(),
          fetchDatasetSummary(),
          fetchCollectionStatus(),
          fetchDatasetRejected(),
          fetchApprovedDatasetImages({ page: 1, limit: 24 }),
          fetchDatasetCandidates({ page: 1, limit: 24 }),
        ]);
        if (!active) return;
        setMonuments(monRes.monuments);
        setSummary(sumRes.summary);
        setValidation(sumRes.validation);
        setCollectionProgress(colRes.progress);
        setRejectedRecords(rejRes.rejected);
        setDownloadFailures(rejRes.failures);
        setApprovedImages(appRes.images);
        setApprovedTotal(appRes.total);
        setApprovedTotalPages(appRes.totalPages);
        setAvailableLicences(appRes.availableLicences);
        setCandidates(candRes.candidates);
        setCandidatesTotal(candRes.total);
        setCandidatesTotalPages(candRes.totalPages);
      } catch (err) {
        if (active) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load Dataset Manager.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, []);

  // Poll live progress while collection job is active
  useEffect(() => {
    if (collectionProgress?.status !== 'running') return;
    const timer = window.setInterval(() => {
      void fetchCollectionStatus()
        .then((res) => {
          setCollectionProgress(res.progress);
          if (res.progress.status !== 'running') {
            void refreshAll();
          } else {
            void fetchDatasetSummary().then((sum) => {
              setSummary(sum.summary);
              setValidation(sum.validation);
            });
          }
        })
        .catch(() => {
          // Non-blocking poll retry
        });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [collectionProgress?.status, refreshAll]);

  useEffect(() => {
    void loadApprovedPage().catch(() => {});
  }, [loadApprovedPage]);

  useEffect(() => {
    void loadCandidatesPage().catch(() => {});
  }, [loadCandidatesPage]);

  useEffect(() => {
    if (!lightboxImage) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxImage(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxImage]);

  const handleStartCollection = async () => {
    try {
      setErrorMessage(null);
      const res = await startDatasetCollection({
        mode: collectMode,
        targetPerMonument: collectTarget,
        unknownTarget: 40,
        siteId: collectMode === 'single_monument' ? collectSiteId : undefined,
      });
      setCollectionProgress(res.progress);
      setBannerMessage(
        `Started automated Wikimedia Commons collection (target: ${collectTarget} verified images/monument). Downloading, verifying hashes, and filtering synthetic/low-res candidates...`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start collection.');
    }
  };

  const handlePauseCollection = async () => {
    try {
      const res = await pauseDatasetCollection();
      setCollectionProgress(res.progress);
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to pause collection.');
    }
  };

  const handleResumeCollection = async () => {
    try {
      const res = await resumeDatasetCollection();
      setCollectionProgress(res.progress);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to resume collection.');
    }
  };

  const handleRetryFailures = async () => {
    try {
      setRetryingFailures(true);
      setErrorMessage(null);
      const res = await retryDatasetFailures();
      await refreshAll();
      setBannerMessage(
        `Retried ${res.retried} failed download(s): ${res.succeeded} recovered and verified, ${res.remainingFailures} remaining failure(s).`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to retry downloads.');
    } finally {
      setRetryingFailures(false);
    }
  };

  const handleSourceSingle = async () => {
    try {
      setSourcing(true);
      setErrorMessage(null);
      setBannerMessage(null);
      const effectiveSplit: DatasetSplit = selectedSiteId === 'unknown' ? 'unknown' : defaultSplit;
      const res = await sourceWikimediaCandidates({
        siteId: selectedSiteId,
        query: queryOverride.trim() || undefined,
        limit: 12,
        targetSplit: effectiveSplit,
      });
      setFilterSiteId(selectedSiteId);
      setFilterStatus('all');
      setCandidatesPage(1);
      await refreshAll();
      setBannerMessage(
        `Retrieved ${res.candidates.length} Wikimedia Commons candidate(s) for ${res.monumentName} (query: "${res.queryUsed}").`
      );
      setActiveTab('review');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Wikimedia Commons sourcing failed.');
    } finally {
      setSourcing(false);
    }
  };

  const handleSourceAll20 = async () => {
    try {
      setBatchSourcing(true);
      setErrorMessage(null);
      setBannerMessage(null);
      const res = await sourceAllMonumentsFromWikimedia(4);
      setFilterSiteId('all');
      setFilterStatus('pending_review');
      setCandidatesPage(1);
      await refreshAll();
      setBannerMessage(
        `Sourced ${res.totalFetched} Wikimedia Commons candidate(s) across ${res.monumentsQueried} monuments into the review queue.`
      );
      setActiveTab('review');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Batch Wikimedia Commons sourcing failed.'
      );
    } finally {
      setBatchSourcing(false);
    }
  };

  const handleApprove = async (candidate: WikimediaCandidate) => {
    const split =
      candidateSplitMap[candidate.candidate_id] ??
      (candidate.site_id === 'unknown' ? 'validation' : candidate.suggested_split);
    try {
      setBusyCandidateId(candidate.candidate_id);
      setErrorMessage(null);
      const res = await approveDatasetCandidate(candidate.candidate_id, split);
      await refreshAll();
      setBannerMessage(
        `Approved and verified "${res.approvedImage.relative_path}" (${res.approvedImage.image_width}×${res.approvedImage.image_height} px, SHA-256 ${res.approvedImage.sha256_hash.slice(0, 12)}…).`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Approval & download validation failed.'
      );
    } finally {
      setBusyCandidateId(null);
    }
  };

  const handleReject = async (candidate: WikimediaCandidate) => {
    try {
      setBusyCandidateId(candidate.candidate_id);
      setErrorMessage(null);
      await rejectDatasetCandidate(candidate.candidate_id);
      await refreshAll();
      setBannerMessage(`Rejected candidate "${candidate.commons_title}" and logged to rejected_images.csv.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to reject candidate.');
    } finally {
      setBusyCandidateId(null);
    }
  };

  const handleRemoveApproved = async (imageId: string) => {
    try {
      setBusyRemoveId(imageId);
      setConfirmRemoveId(null);
      setErrorMessage(null);
      await removeApprovedDatasetImage(imageId);
      if (lightboxImage?.image_id === imageId) setLightboxImage(null);
      await refreshAll();
      setBannerMessage(`Removed "${imageId}" from dataset and regenerated manifests.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to remove dataset image.');
    } finally {
      setBusyRemoveId(null);
    }
  };

  const handleRunAudit = async () => {
    try {
      setValidating(true);
      setErrorMessage(null);
      const [report, shaAudit, sumRes] = await Promise.all([
        fetchDatasetValidation(),
        auditDatasetIntegrity(),
        fetchDatasetSummary(),
      ]);
      setValidation(report);
      setSummary(sumRes.summary);
      setBannerMessage(
        report.is_valid && shaAudit.isIntegrityValid
          ? `Quality audit passed: ${report.files_verified_on_disk}/${report.total_records} files verified on disk · ${shaAudit.summaryMessage}`
          : `Quality audit detected ${report.issues.length} disk issue(s) · ${shaAudit.summaryMessage}`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to run dataset audit.');
    } finally {
      setValidating(false);
    }
  };

  const isCollecting = collectionProgress?.status === 'running';

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="border-b border-[#E2D9C8] pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7D5A1C]">
          Reproducible Heritage Computer Vision Corpus
        </p>
        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-[#2B1E16] sm:text-4xl">
              Heritage Image Dataset Manager
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#695547]">
              Curated Wikimedia Commons monument photography across 20 monuments and{' '}
              <code className="font-mono text-xs text-[#2B1E16]">unknown</code> distractors in{' '}
              <code className="font-mono text-xs text-[#2B1E16]">reference</code>,{' '}
              <code className="font-mono text-xs text-[#2B1E16]">validation</code>, and{' '}
              <code className="font-mono text-xs text-[#2B1E16]">test</code> splits with SHA-256
              integrity, perceptual dHash deduplication, and OpenCLIP{' '}
              <code className="font-mono text-xs text-[#2B1E16]">ViT-B-32</code> index readiness.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href="/api/dataset/export/csv"
              download="dataset_manifest.csv"
              className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap rounded-md border border-[#E2D9C8] bg-[#FDFBF7] px-3 py-1.5 text-xs font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1]"
            >
              <Download className="h-3.5 w-3.5 text-[#7D5A1C]" aria-hidden="true" />
              <span>Manifest CSV</span>
            </a>

            <a
              href="/api/dataset/export/attributions"
              download="image_attributions.csv"
              className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap rounded-md border border-[#E2D9C8] bg-[#FDFBF7] px-3 py-1.5 text-xs font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1]"
            >
              <Download className="h-3.5 w-3.5 text-[#7D5A1C]" aria-hidden="true" />
              <span>Attributions CSV</span>
            </a>

            <a
              href="/api/dataset/export/json"
              download="dataset_metadata.json"
              className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap rounded-md border border-[#E2D9C8] bg-[#FDFBF7] px-3 py-1.5 text-xs font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1]"
            >
              <Download className="h-3.5 w-3.5 text-[#7D5A1C]" aria-hidden="true" />
              <span>JSON</span>
            </a>

            <a
              href="/api/dataset/export/zip"
              download="heritage_vision_dataset.zip"
              className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap rounded-md bg-[#7D5A1C] px-3.5 py-1.5 text-xs font-medium text-[#FAF7F0] transition-colors hover:bg-[#654714]"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download Dataset ZIP</span>
            </a>

            <button
              type="button"
              onClick={handleRunAudit}
              disabled={validating}
              className="inline-flex min-h-[38px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-[#C8A55B] bg-[#FDFBF7] px-3.5 py-1.5 text-xs font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${validating ? 'animate-spin' : ''}`} />
              <span>Run Quality Audit</span>
            </button>
          </div>
        </div>
      </div>

      {/* Honest Summary Ledger */}
      {!loading && summary && validation && (
        <section
          aria-label="Dataset summary metrics"
          className="mt-8 rounded-lg border border-[#E2D9C8] bg-[#F3EDE1]/65 p-5"
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <div className="border-[#E2D9C8] sm:border-r sm:pr-4">
              <p className="text-xs font-medium text-[#695547]">Verified Photographs</p>
              <p className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {summary.total_approved_images}
              </p>
              <p className="mt-0.5 text-xs text-[#695547] tabular-nums">
                {formatBytes(summary.total_dataset_bytes)} on disk
              </p>
            </div>

            <div className="border-[#E2D9C8] lg:border-r lg:pr-4">
              <p className="text-xs font-medium text-[#695547]">Target Coverage (50+ / site)</p>
              <p className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {summary.monuments_meeting_target} / {summary.monuments_in_schema}
              </p>
              <p className="mt-0.5 text-xs text-[#695547] tabular-nums">
                {summary.monuments_with_reference_images}/20 have reference split
              </p>
            </div>

            <div className="border-[#E2D9C8] sm:border-r sm:pr-4">
              <p className="text-xs font-medium text-[#695547]">Split Distribution</p>
              <p className="mt-1 font-mono text-sm font-medium text-[#2B1E16] tabular-nums">
                Ref {summary.split_counts.reference} · Val {summary.split_counts.validation} · Test{' '}
                {summary.split_counts.test}
              </p>
              <p className="mt-0.5 text-xs text-[#695547] tabular-nums">
                {summary.review_queue_counts.review_required} review_required ·{' '}
                {summary.review_queue_counts.rejected} rejected
              </p>
            </div>

            <div className="border-[#E2D9C8] lg:border-r lg:pr-4">
              <p className="text-xs font-medium text-[#695547]">Integrity &amp; Deduplication</p>
              <div className="mt-1 flex items-center gap-1.5">
                {validation.is_valid ? (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[#166534]" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="h-4 w-4 shrink-0 text-[#7F1D1D]" aria-hidden="true" />
                )}
                <p
                  className={`font-serif text-xl font-semibold ${
                    validation.is_valid ? 'text-[#166534]' : 'text-[#7F1D1D]'
                  }`}
                >
                  {validation.is_valid ? 'Valid' : `${validation.issues.length} Issue(s)`}
                </p>
              </div>
              <p className="mt-0.5 text-xs text-[#695547] tabular-nums">
                {validation.unique_sha256_count} SHA-256 · {summary.failed_downloads_count} failures
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-[#695547]">OpenCLIP Reference Index</p>
              <div className="mt-1 flex items-center gap-1.5">
                <Cpu className="h-4 w-4 shrink-0 text-[#7D5A1C]" aria-hidden="true" />
                <p className="font-serif text-lg font-semibold text-[#2B1E16]">
                  {summary.embedding_status.generated ? 'Indexed' : 'Ready to Build'}
                </p>
              </div>
              <p className="mt-0.5 text-xs text-[#695547]">
                {summary.embedding_status.model_name} ({summary.embedding_status.checkpoint})
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Automated Resumable Dataset Collector Panel */}
      <section className="mt-8 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
        <div className="flex flex-col gap-3 border-b border-[#E2D9C8] pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
              Automated Resumable Collection Pipeline
            </h2>
            <p className="mt-0.5 text-xs text-[#695547]">
              Collects genuine Wikimedia Commons categories &amp; search results, rejects graphics/diagrams, flags{' '}
              <code className="font-mono">REVIEW_REQUIRED</code> edge cases, and commits balanced{' '}
              <code className="font-mono">reference/validation/test</code> splits with dHash anti-leakage.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isCollecting ? (
              <button
                type="button"
                onClick={handlePauseCollection}
                className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md border border-[#C8A55B] bg-[#FBF3E4] px-3.5 py-1.5 text-xs font-medium text-[#7D5A1C] hover:bg-[#F3E4C6]"
              >
                <Pause className="h-3.5 w-3.5" />
                <span>Pause Collection</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleStartCollection}
                  className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md bg-[#7D5A1C] px-4 py-1.5 text-xs font-medium text-[#FAF7F0] hover:bg-[#654714]"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>Start Collection</span>
                </button>
                {collectionProgress?.status === 'paused' && (
                  <button
                    type="button"
                    onClick={handleResumeCollection}
                    className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md border border-[#7D5A1C] bg-[#FAF7F0] px-3.5 py-1.5 text-xs font-medium text-[#7D5A1C] hover:bg-[#F3EDE1]"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Resume</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={handleRetryFailures}
              disabled={retryingFailures || isCollecting || downloadFailures.length === 0}
              className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3.5 py-1.5 text-xs font-medium text-[#2B1E16] hover:bg-[#F3EDE1] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${retryingFailures ? 'animate-spin' : ''}`} />
              <span>Retry Failures ({downloadFailures.length})</span>
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-12">
          <div className="md:col-span-4">
            <label htmlFor="collect-mode" className="block text-xs font-medium text-[#695547]">
              Collection Scope
            </label>
            <select
              id="collect-mode"
              disabled={isCollecting}
              value={collectMode}
              onChange={(e) =>
                setCollectMode(e.target.value as 'all_monuments' | 'single_monument' | 'unknown_only')
              }
              className="mt-1 min-h-[40px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16]"
            >
              <option value="all_monuments">All 20 Monuments + Unknown Distractors</option>
              <option value="single_monument">Single Selected Monument</option>
              <option value="unknown_only">Unknown Distractor Split Only</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label htmlFor="collect-target" className="block text-xs font-medium text-[#695547]">
              Target Usable Photos per Monument (60% Ref / 20% Val / 20% Test)
            </label>
            <select
              id="collect-target"
              disabled={isCollecting}
              value={collectTarget}
              onChange={(e) => setCollectTarget(Number(e.target.value))}
              className="mt-1 min-h-[40px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16]"
            >
              <option value={25}>25 per monument (15 ref / 5 val / 5 test · quick run)</option>
              <option value={50}>50 per monument (30 ref / 10 val / 10 test · standard)</option>
              <option value={65}>65 per monument (recommended)</option>
              <option value={80}>80 per monument</option>
              <option value={100}>100 per monument (full ~2,000 target)</option>
            </select>
          </div>

          {collectMode === 'single_monument' && (
            <div className="md:col-span-4">
              <label htmlFor="collect-site" className="block text-xs font-medium text-[#695547]">
                Target Monument
              </label>
              <select
                id="collect-site"
                disabled={isCollecting}
                value={collectSiteId}
                onChange={(e) => setCollectSiteId(e.target.value)}
                className="mt-1 min-h-[40px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16]"
              >
                {monuments.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.accessionCode} — {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Live Progress Strip */}
        {collectionProgress && collectionProgress.status !== 'idle' && (
          <div className="mt-4 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium text-[#2B1E16]">
                <span className="font-mono uppercase tracking-wider text-[#7D5A1C]">
                  [{collectionProgress.status}]
                </span>
                <span>
                  {collectionProgress.current_monument_name
                    ? `${collectionProgress.current_monument_name}${collectionProgress.current_query ? ` · ${collectionProgress.current_query}` : ''}`
                    : collectionProgress.last_message ?? 'Collection ready'}
                </span>
              </div>
              <span className="font-mono text-[#695547] tabular-nums">
                Classes {collectionProgress.monuments_completed} / {collectionProgress.monuments_total}
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-[#E2D9C8] pt-2.5 sm:grid-cols-6">
              <div>
                <p className="text-[11px] text-[#695547]">Downloaded</p>
                <p className="font-mono font-semibold text-[#166534] tabular-nums">
                  +{collectionProgress.images_downloaded}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#695547]">Fetched</p>
                <p className="font-mono font-semibold text-[#2B1E16] tabular-nums">
                  {collectionProgress.candidates_fetched}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#695547]">Review Required</p>
                <p className="font-mono font-semibold text-[#7D5A1C] tabular-nums">
                  {collectionProgress.flagged_review_required}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#695547]">Auto-Rejected</p>
                <p className="font-mono font-semibold text-[#7F1D1D] tabular-nums">
                  {collectionProgress.auto_rejected}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#695547]">Duplicates Blocked</p>
                <p className="font-mono font-semibold text-[#695547] tabular-nums">
                  {collectionProgress.duplicates_skipped}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#695547]">Failures</p>
                <p className="font-mono font-semibold text-[#7F1D1D] tabular-nums">
                  {collectionProgress.download_failures}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Manual Wikimedia Commons Sourcing Workbench */}
      <section className="mt-6 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
        <div className="flex flex-col gap-2 border-b border-[#E2D9C8] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[#2B1E16]">
              Manual Candidate Search Workbench (Wikimedia Commons API)
            </h2>
            <p className="mt-0.5 text-xs text-[#695547]">
              Run targeted keyword queries into the human review queue alongside creator &amp; CC licence provenance.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSourceAll20}
            disabled={batchSourcing || sourcing}
            className="inline-flex min-h-[38px] shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border border-[#C8A55B] bg-[#FAF7F0] px-3.5 py-1.5 text-xs font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1] disabled:opacity-50"
          >
            <Database className="h-3.5 w-3.5 text-[#7D5A1C]" />
            <span>
              {batchSourcing ? 'Sourcing 20 Monuments…' : 'Queue Sample Across All 20'}
            </span>
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-12">
          <div className="md:col-span-4">
            <label htmlFor="source-monument" className="block text-xs font-medium text-[#695547]">
              Target Monument or Distractor Class
            </label>
            <select
              id="source-monument"
              value={selectedSiteId}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedSiteId(next);
                if (next === 'unknown') setDefaultSplit('unknown');
                else if (defaultSplit === 'unknown') setDefaultSplit('validation');
              }}
              className="mt-1 min-h-[40px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-sm text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
            >
              {monuments.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.accessionCode} — {m.name} ({m.state})
                </option>
              ))}
              <option value="unknown">unknown — Non-Monument Distractor Class</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label htmlFor="source-query" className="block text-xs font-medium text-[#695547]">
              Custom Wikimedia Search Query
            </label>
            <input
              id="source-query"
              type="text"
              value={queryOverride}
              onChange={(e) => setQueryOverride(e.target.value)}
              placeholder="Default: Monument name + architectural detail"
              className="mt-1 min-h-[40px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-sm text-[#2B1E16] placeholder:text-[#695547]/60 focus:border-[#8B6624] focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="source-split" className="block text-xs font-medium text-[#695547]">
              Suggested Split
            </label>
            <select
              id="source-split"
              value={selectedSiteId === 'unknown' ? 'unknown' : defaultSplit}
              disabled={selectedSiteId === 'unknown'}
              onChange={(e) => setDefaultSplit(e.target.value as DatasetSplit)}
              className="mt-1 min-h-[40px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-sm text-[#2B1E16] focus:border-[#8B6624] focus:outline-none disabled:opacity-60"
            >
              <option value="reference">reference</option>
              <option value="validation">validation</option>
              <option value="test">test</option>
              <option value="unknown">unknown</option>
            </select>
          </div>

          <div className="flex items-end md:col-span-2">
            <button
              type="button"
              onClick={handleSourceSingle}
              disabled={sourcing || batchSourcing}
              className="inline-flex min-h-[40px] w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#7D5A1C] px-4 py-2 text-xs font-medium text-[#FAF7F0] transition-colors hover:bg-[#654714] disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" />
              <span>{sourcing ? 'Searching…' : 'Search Commons'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Feedback Alerts */}
      {bannerMessage && (
        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-[#C8A55B]/70 bg-[#FBF3E4] p-4 text-xs text-[#2B1E16]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#7D5A1C]" />
          <p>{bannerMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] p-4 text-xs text-[#7F1D1D]"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{errorMessage}</p>
        </div>
      )}

      {/* Workspace Tabs */}
      <div className="mt-10 flex flex-wrap gap-2 border-b border-[#E2D9C8] pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('approved')}
          className={`cursor-pointer whitespace-nowrap rounded-md px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === 'approved'
              ? 'bg-[#7D5A1C] text-[#FAF7F0]'
              : 'bg-[#F3EDE1] text-[#695547] hover:text-[#2B1E16]'
          }`}
        >
          Verified Dataset ({summary?.total_approved_images ?? approvedTotal})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('review')}
          className={`cursor-pointer whitespace-nowrap rounded-md px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === 'review'
              ? 'bg-[#7D5A1C] text-[#FAF7F0]'
              : 'bg-[#F3EDE1] text-[#695547] hover:text-[#2B1E16]'
          }`}
        >
          Review &amp; REVIEW_REQUIRED ({candidatesTotal})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('rejected')}
          className={`cursor-pointer whitespace-nowrap rounded-md px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === 'rejected'
              ? 'bg-[#7D5A1C] text-[#FAF7F0]'
              : 'bg-[#F3EDE1] text-[#695547] hover:text-[#2B1E16]'
          }`}
        >
          Rejected ({rejectedRecords.length}) &amp; Failures ({downloadFailures.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`cursor-pointer whitespace-nowrap rounded-md px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === 'audit'
              ? 'bg-[#7D5A1C] text-[#FAF7F0]'
              : 'bg-[#F3EDE1] text-[#695547] hover:text-[#2B1E16]'
          }`}
        >
          20-Monument Coverage, Splits &amp; Embeddings
        </button>
      </div>

      {/* TAB 1: Approved Dataset (Server-Paginated) */}
      {activeTab === 'approved' && (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-4 md:grid-cols-12">
            <div className="md:col-span-4">
              <label htmlFor="approved-search" className="block text-xs font-medium text-[#695547]">
                Search by monument, filename, creator, licence, or SHA-256
              </label>
              <input
                id="approved-search"
                type="search"
                value={approvedSearch}
                onChange={(e) => {
                  setApprovedSearch(e.target.value);
                  setApprovedPage(1);
                }}
                placeholder="Search verified images…"
                className="mt-1 min-h-[38px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
              />
            </div>

            <div className="md:col-span-3">
              <label htmlFor="approved-site" className="block text-xs font-medium text-[#695547]">
                Monument / Class
              </label>
              <select
                id="approved-site"
                value={approvedSiteFilter}
                onChange={(e) => {
                  setApprovedSiteFilter(e.target.value);
                  setApprovedPage(1);
                }}
                className="mt-1 min-h-[38px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
              >
                <option value="all">All Sites</option>
                {monuments.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                <option value="unknown">unknown (Distractors)</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="approved-split" className="block text-xs font-medium text-[#695547]">
                Split
              </label>
              <select
                id="approved-split"
                value={approvedSplitFilter}
                onChange={(e) => {
                  setApprovedSplitFilter(e.target.value as DatasetSplit | 'all');
                  setApprovedPage(1);
                }}
                className="mt-1 min-h-[38px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
              >
                <option value="all">All Splits</option>
                <option value="reference">reference</option>
                <option value="validation">validation</option>
                <option value="test">test</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label htmlFor="approved-licence" className="block text-xs font-medium text-[#695547]">
                Open Licence Filter
              </label>
              <select
                id="approved-licence"
                value={approvedLicenceFilter}
                onChange={(e) => {
                  setApprovedLicenceFilter(e.target.value);
                  setApprovedPage(1);
                }}
                className="mt-1 min-h-[38px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
              >
                <option value="all">All Licences ({availableLicences.length})</option>
                {availableLicences.map((lic) => (
                  <option key={lic} value={lic}>
                    {lic}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#695547]">
            <span className="font-mono tabular-nums">
              Showing {approvedImages.length} on page {approvedPage}/{approvedTotalPages} ({approvedTotal}{' '}
              matching verified photographs)
            </span>
            {(approvedSplitFilter !== 'all' ||
              approvedSiteFilter !== 'all' ||
              approvedLicenceFilter !== 'all' ||
              approvedSearch.trim() !== '') && (
              <button
                type="button"
                onClick={() => {
                  setApprovedSplitFilter('all');
                  setApprovedSiteFilter('all');
                  setApprovedLicenceFilter('all');
                  setApprovedSearch('');
                  setApprovedPage(1);
                }}
                className="cursor-pointer font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16]"
              >
                Reset filters
              </button>
            )}
          </div>

          {approvedImages.length === 0 ? (
            <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] px-6 py-12 text-center">
              <p className="font-serif text-xl font-semibold text-[#2B1E16]">
                No verified photographs match the current filters
              </p>
              <p className="mt-2 text-xs text-[#695547]">
                Start the Automated Collection Pipeline above or approve candidates from the Review tab.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {approvedImages.map((img) => {
                  const isBroken = Boolean(brokenImageIds[img.image_id]);
                  const siteLabel = monumentNameById.get(img.site_id) ?? img.site_id;
                  const localSrc = getApprovedImageSrc(img);

                  return (
                    <article
                      key={img.image_id}
                      className="flex flex-col overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#FDFBF7]"
                    >
                      <div className="group relative aspect-[4/3] w-full overflow-hidden border-b border-[#E2D9C8] bg-[#EFE9DC]">
                        {!isBroken ? (
                          <button
                            type="button"
                            onClick={() => setLightboxImage(img)}
                            aria-label={`Inspect full photograph for ${siteLabel}`}
                            className="block h-full w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B6624]"
                          >
                            <img
                              src={localSrc}
                              alt={`${siteLabel} (${img.image_split} split)`}
                              loading="lazy"
                              onError={() =>
                                setBrokenImageIds((prev) => ({ ...prev, [img.image_id]: true }))
                              }
                              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                            />
                            <span className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded border border-[#E2D9C8] bg-[#FAF7F0]/90 px-2 py-1 text-[11px] font-medium text-[#2B1E16] opacity-90 group-hover:opacity-100">
                              <Maximize2 className="h-3 w-3 text-[#7D5A1C]" aria-hidden="true" />
                              <span>Inspect</span>
                            </span>
                          </button>
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center p-4 text-center text-xs text-[#695547]">
                            <p className="font-serif text-sm font-medium text-[#2B1E16]">{siteLabel}</p>
                            <p className="mt-1 font-mono text-[11px]">{img.relative_path}</p>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col justify-between p-5 text-xs">
                        <div className="space-y-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-[#7D5A1C]">
                              {img.image_split} · {img.monument_folder || img.site_id}
                            </span>
                            <span className="font-mono text-[11px] text-[#695547] tabular-nums">
                              {img.image_width}×{img.image_height}
                            </span>
                          </div>

                          <h3 className="font-serif text-base font-semibold text-[#2B1E16]">
                            {siteLabel}
                          </h3>

                          <dl className="space-y-1 border-t border-[#E2D9C8] pt-2 text-[#695547]">
                            <div className="flex justify-between gap-2">
                              <dt>Photographer</dt>
                              <dd className="max-w-[60%] truncate text-right text-[#2B1E16]">
                                {img.creator ?? 'Not specified'}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt>Licence</dt>
                              <dd className="max-w-[60%] truncate text-right font-medium text-[#2B1E16]">
                                {img.licence}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt>SHA-256</dt>
                              <dd className="font-mono text-[11px] text-[#2B1E16]">
                                {img.sha256_hash.slice(0, 14)}…
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt>Size · Date</dt>
                              <dd className="font-mono text-[#2B1E16] tabular-nums">
                                {formatBytes(img.file_size_bytes)} · {img.download_date}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#E2D9C8] pt-3">
                          <div className="flex items-center gap-3">
                            <a
                              href={img.source_page_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-2 hover:text-[#2B1E16]"
                            >
                              <span>Commons</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            {img.site_id !== 'unknown' && (
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigate({ page: 'monument-detail', monumentId: img.site_id })
                                }
                                className="inline-flex cursor-pointer items-center gap-0.5 font-medium text-[#2B1E16] underline decoration-[#E2D9C8] underline-offset-2 hover:text-[#7D5A1C]"
                              >
                                <span>Dossier</span>
                                <ArrowUpRight className="h-3 w-3" />
                              </button>
                            )}
                          </div>

                          {confirmRemoveId === img.image_id ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyRemoveId === img.image_id}
                                onClick={() => void handleRemoveApproved(img.image_id)}
                                className="cursor-pointer rounded border border-[#B91C1C]/40 bg-[#FEF2F2] px-2 py-1 text-[11px] font-medium text-[#7F1D1D] hover:bg-[#FEE2E2]"
                              >
                                {busyRemoveId === img.image_id ? 'Removing…' : 'Confirm'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRemoveId(null)}
                                className="cursor-pointer rounded border border-[#E2D9C8] px-2 py-1 text-[11px] text-[#695547] hover:text-[#2B1E16]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={busyRemoveId === img.image_id}
                              onClick={() => setConfirmRemoveId(img.image_id)}
                              className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#E2D9C8] px-2.5 py-1 text-[11px] font-medium text-[#7F1D1D] hover:bg-[#FEF2F2] disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Remove</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Pagination Controls */}
              {approvedTotalPages > 1 && (
                <div className="flex items-center justify-between border-t border-[#E2D9C8] pt-4 text-xs">
                  <button
                    type="button"
                    disabled={approvedPage <= 1}
                    onClick={() => setApprovedPage((p) => Math.max(1, p - 1))}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#E2D9C8] bg-[#FDFBF7] px-3 py-1.5 font-medium text-[#2B1E16] hover:bg-[#F3EDE1] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Previous</span>
                  </button>
                  <span className="font-mono text-[#695547] tabular-nums">
                    Page {approvedPage} of {approvedTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={approvedPage >= approvedTotalPages}
                    onClick={() => setApprovedPage((p) => Math.min(approvedTotalPages, p + 1))}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#E2D9C8] bg-[#FDFBF7] px-3 py-1.5 font-medium text-[#2B1E16] hover:bg-[#F3EDE1] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: Human & REVIEW_REQUIRED Queue */}
      {activeTab === 'review' && (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-4 md:grid-cols-12">
            <div className="md:col-span-5">
              <label htmlFor="queue-search" className="block text-xs font-medium text-[#695547]">
                Filter queue by monument, file title, creator, or licence
              </label>
              <input
                id="queue-search"
                type="search"
                value={candidateSearch}
                onChange={(e) => {
                  setCandidateSearch(e.target.value);
                  setCandidatesPage(1);
                }}
                placeholder="Search candidates…"
                className="mt-1 min-h-[38px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
              />
            </div>

            <div className="md:col-span-4">
              <label htmlFor="queue-site" className="block text-xs font-medium text-[#695547]">
                Filter by Monument
              </label>
              <select
                id="queue-site"
                value={filterSiteId}
                onChange={(e) => {
                  setFilterSiteId(e.target.value);
                  setCandidatesPage(1);
                }}
                className="mt-1 min-h-[38px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
              >
                <option value="all">All Monuments</option>
                {monuments.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                <option value="unknown">unknown (Distractors)</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label htmlFor="queue-status" className="block text-xs font-medium text-[#695547]">
                Review Queue Status
              </label>
              <select
                id="queue-status"
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value as CandidateApprovalStatus | 'all');
                  setCandidatesPage(1);
                }}
                className="mt-1 min-h-[38px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="review_required">REVIEW_REQUIRED (QC Flagged)</option>
                <option value="pending_review">Pending Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          {candidates.length === 0 ? (
            <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] px-6 py-12 text-center">
              <p className="font-serif text-xl font-semibold text-[#2B1E16]">
                No candidates match the current queue filter
              </p>
              <p className="mt-2 text-xs text-[#695547]">
                Use the Search Commons workbench or Automated Collection pipeline to populate candidates.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {candidates.map((cand) => {
                  const selectedSplit =
                    candidateSplitMap[cand.candidate_id] ??
                    (cand.site_id === 'unknown' ? 'validation' : cand.suggested_split);
                  const isBusy = busyCandidateId === cand.candidate_id;
                  const isApproved = cand.approval_status === 'approved';
                  const isRejected = cand.approval_status === 'rejected';
                  const isReviewReq = cand.approval_status === 'review_required';
                  const isCandBroken = Boolean(brokenImageIds[cand.candidate_id]);

                  return (
                    <article
                      key={cand.candidate_id}
                      className="flex flex-col overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#FDFBF7]"
                    >
                      <div className="relative aspect-[4/3] w-full border-b border-[#E2D9C8] bg-[#EFE9DC]">
                        {cand.preview_url && !isCandBroken ? (
                          <img
                            src={cand.preview_url}
                            alt={cand.commons_title}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            onError={() =>
                              setBrokenImageIds((prev) => ({
                                ...prev,
                                [cand.candidate_id]: true,
                              }))
                            }
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-[#695547]">
                            Preview unavailable
                          </div>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col justify-between p-5 text-xs">
                        <div className="space-y-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-[11px] uppercase tracking-wider text-[#7D5A1C]">
                              {cand.monument_name}
                            </span>
                            <span
                              className={`font-mono text-[11px] font-medium uppercase ${
                                isApproved
                                  ? 'text-[#166534]'
                                  : isRejected
                                    ? 'text-[#7F1D1D]'
                                    : isReviewReq
                                      ? 'text-[#9A3412]'
                                      : 'text-[#695547]'
                              }`}
                            >
                              {cand.approval_status.replace('_', ' ')}
                            </span>
                          </div>

                          <h3 className="line-clamp-2 font-serif text-base font-semibold text-[#2B1E16]">
                            {cand.commons_title.replace(/^File:/i, '')}
                          </h3>

                          <dl className="space-y-1 border-t border-[#E2D9C8] pt-2.5 text-[#695547]">
                            <div className="flex justify-between gap-2">
                              <dt>Photographer</dt>
                              <dd className="max-w-[60%] truncate text-right font-medium text-[#2B1E16]">
                                {cand.creator ?? 'Not specified'}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt>Licence</dt>
                              <dd className="max-w-[60%] truncate text-right font-medium text-[#2B1E16]">
                                {cand.licence ?? 'Missing'}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt>Dimensions</dt>
                              <dd className="font-mono text-[#2B1E16] tabular-nums">
                                {cand.image_width} × {cand.image_height} px
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt>Source Page</dt>
                              <dd>
                                {cand.source_page_url ? (
                                  <a
                                    href={cand.source_page_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-2 hover:text-[#2B1E16]"
                                  >
                                    <span>Wikimedia Commons</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  'Missing'
                                )}
                              </dd>
                            </div>
                          </dl>

                          {cand.eligibility_warnings.length > 0 && (
                            <div className="flex items-start gap-2 rounded border border-[#C8A55B]/70 bg-[#FBF3E4] p-2.5 text-[11px] text-[#7D5A1C]">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>{cand.eligibility_warnings.join(' · ')}</span>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 space-y-2.5 border-t border-[#E2D9C8] pt-3">
                          <div className="flex items-center justify-between gap-2">
                            <label
                              htmlFor={`split-${cand.candidate_id}`}
                              className="text-[11px] font-medium text-[#695547]"
                            >
                              Assign Split:
                            </label>
                            <select
                              id={`split-${cand.candidate_id}`}
                              disabled={isApproved || cand.site_id === 'unknown'}
                              value={selectedSplit}
                              onChange={(e) =>
                                setCandidateSplitMap((prev) => ({
                                  ...prev,
                                  [cand.candidate_id]: e.target.value as DatasetSplit,
                                }))
                              }
                              className="rounded border border-[#E2D9C8] bg-[#FAF7F0] px-2 py-1 font-mono text-[11px] text-[#2B1E16] disabled:opacity-60"
                            >
                              {SPLIT_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={isBusy || isApproved}
                              onClick={() => handleApprove(cand)}
                              className="inline-flex min-h-[36px] cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[#7D5A1C] px-3 py-1.5 text-xs font-medium text-[#FAF7F0] transition-colors hover:bg-[#654714] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>
                                {isBusy ? 'Verifying…' : isApproved ? 'Approved' : 'Approve'}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={isBusy || isApproved}
                              onClick={() => handleReject(cand)}
                              className="inline-flex min-h-[36px] cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <X className="h-3.5 w-3.5" />
                              <span>{isRejected ? 'Rejected' : 'Reject'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {candidatesTotalPages > 1 && (
                <div className="flex items-center justify-between border-t border-[#E2D9C8] pt-4 text-xs">
                  <button
                    type="button"
                    disabled={candidatesPage <= 1}
                    onClick={() => setCandidatesPage((p) => Math.max(1, p - 1))}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#E2D9C8] bg-[#FDFBF7] px-3 py-1.5 font-medium text-[#2B1E16] hover:bg-[#F3EDE1] disabled:opacity-45"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Previous</span>
                  </button>
                  <span className="font-mono text-[#695547] tabular-nums">
                    Page {candidatesPage} of {candidatesTotalPages} ({candidatesTotal} total candidates)
                  </span>
                  <button
                    type="button"
                    disabled={candidatesPage >= candidatesTotalPages}
                    onClick={() => setCandidatesPage((p) => Math.min(candidatesTotalPages, p + 1))}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#E2D9C8] bg-[#FDFBF7] px-3 py-1.5 font-medium text-[#2B1E16] hover:bg-[#F3EDE1] disabled:opacity-45"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 3: Rejected & Download Failures */}
      {activeTab === 'rejected' && (
        <div className="mt-6 space-y-8">
          <section className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2D9C8] pb-4">
              <div>
                <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
                  Download Failures ({downloadFailures.length})
                </h2>
                <p className="mt-0.5 text-xs text-[#695547]">
                  Logged to <code className="font-mono">dataset/download_failures.csv</code> — recoverable HTTP or timeout errors.
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href="/api/dataset/export/failures"
                  download="download_failures.csv"
                  className="inline-flex items-center gap-1 rounded border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs font-medium text-[#2B1E16] hover:bg-[#F3EDE1]"
                >
                  <Download className="h-3.5 w-3.5 text-[#7D5A1C]" />
                  <span>Failures CSV</span>
                </a>
                <button
                  type="button"
                  onClick={handleRetryFailures}
                  disabled={retryingFailures || downloadFailures.length === 0}
                  className="inline-flex cursor-pointer items-center gap-1 rounded bg-[#7D5A1C] px-3 py-1.5 text-xs font-medium text-[#FAF7F0] hover:bg-[#654714] disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Retry All</span>
                </button>
              </div>
            </div>

            {downloadFailures.length === 0 ? (
              <p className="mt-4 text-xs text-[#695547]">Zero unresolved download failures.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E2D9C8] text-[#695547]">
                      <th className="py-2 pr-4 font-medium">Monument</th>
                      <th className="py-2 pr-4 font-medium">File</th>
                      <th className="py-2 pr-4 font-medium">HTTP</th>
                      <th className="py-2 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2D9C8]">
                    {downloadFailures.slice(0, 100).map((f) => (
                      <tr key={f.candidate_id}>
                        <td className="py-2 pr-4 font-medium text-[#2B1E16]">{f.monument_name}</td>
                        <td className="py-2 pr-4 font-mono text-[11px] text-[#695547]">{f.commons_title}</td>
                        <td className="py-2 pr-4 font-mono text-[#7F1D1D]">{f.http_status ?? 'ERR'}</td>
                        <td className="py-2 text-[#695547]">{f.error_message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2D9C8] pb-4">
              <div>
                <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
                  Rejected Media Audit Log ({rejectedRecords.length})
                </h2>
                <p className="mt-0.5 text-xs text-[#695547]">
                  Logged to <code className="font-mono">dataset/rejected_images.csv</code> with exclusion stage and reason (illustrations, diagrams, wrong site, duplicates, low resolution, restrictive licence).
                </p>
              </div>
              <a
                href="/api/dataset/export/rejected"
                download="rejected_images.csv"
                className="inline-flex items-center gap-1 rounded border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs font-medium text-[#2B1E16] hover:bg-[#F3EDE1]"
              >
                <Download className="h-3.5 w-3.5 text-[#7D5A1C]" />
                <span>Rejected CSV</span>
              </a>
            </div>

            {rejectedRecords.length === 0 ? (
              <p className="mt-4 text-xs text-[#695547]">No rejected records logged.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E2D9C8] text-[#695547]">
                      <th className="py-2 pr-4 font-medium">Monument</th>
                      <th className="py-2 pr-4 font-medium">Commons File</th>
                      <th className="py-2 pr-4 font-medium">Stage</th>
                      <th className="py-2 font-medium">Rejection Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2D9C8]">
                    {rejectedRecords.slice(0, 150).map((r) => (
                      <tr key={r.candidate_id}>
                        <td className="py-2 pr-4 font-medium text-[#2B1E16]">{r.monument_name}</td>
                        <td className="py-2 pr-4 font-mono text-[11px] text-[#695547]">
                          {r.source_page_url ? (
                            <a
                              href={r.source_page_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline decoration-[#C8A55B] hover:text-[#7D5A1C]"
                            >
                              {r.commons_title}
                            </a>
                          ) : (
                            r.commons_title
                          )}
                        </td>
                        <td className="py-2 pr-4 font-mono text-[11px] uppercase text-[#7D5A1C]">
                          {r.rejection_stage}
                        </td>
                        <td className="py-2 text-[#7F1D1D]">{r.rejection_reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rejectedRecords.length > 150 && (
                  <p className="mt-3 text-xs text-[#695547]">
                    Showing first 150 entries in browser table — download Rejected CSV for complete {rejectedRecords.length}-row log.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 4: Site Coverage, Splits, Licence Breakdown & OpenCLIP Embeddings */}
      {activeTab === 'audit' && summary && validation && (
        <div className="mt-6 space-y-8">
          {/* OpenCLIP Embedding Index & Calibration Status */}
          <section className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex flex-col gap-2 border-b border-[#E2D9C8] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <Cpu className="h-5 w-5 text-[#7D5A1C]" />
                <div>
                  <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
                    OpenCLIP Reference Embeddings &amp; Unknown Threshold Calibration
                  </h2>
                  <p className="mt-0.5 text-xs text-[#695547]">
                    {summary.embedding_status.note}
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs text-[#7D5A1C]">
                {summary.embedding_status.model_name} / {summary.embedding_status.checkpoint}
              </span>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-4 text-xs">
              <div className="rounded border border-[#E2D9C8] bg-[#FAF7F0] p-3.5">
                <p className="text-[#695547]">Reference Images Indexed</p>
                <p className="mt-1 font-serif text-xl font-semibold text-[#2B1E16] tabular-nums">
                  {summary.embedding_status.reference_images_indexed}
                </p>
              </div>
              <div className="rounded border border-[#E2D9C8] bg-[#FAF7F0] p-3.5">
                <p className="text-[#695547]">Monuments Indexed</p>
                <p className="mt-1 font-serif text-xl font-semibold text-[#2B1E16] tabular-nums">
                  {summary.embedding_status.monuments_indexed} / 20
                </p>
              </div>
              <div className="rounded border border-[#E2D9C8] bg-[#FAF7F0] p-3.5">
                <p className="text-[#695547]">Calibrated Min Cosine Similarity</p>
                <p className="mt-1 font-mono text-base font-semibold text-[#2B1E16] tabular-nums">
                  {summary.embedding_status.selected_min_similarity !== null
                    ? summary.embedding_status.selected_min_similarity.toFixed(4)
                    : 'Pending calibration'}
                </p>
              </div>
              <div className="rounded border border-[#E2D9C8] bg-[#FAF7F0] p-3.5">
                <p className="text-[#695547]">Calibrated Top-2 Margin</p>
                <p className="mt-1 font-mono text-base font-semibold text-[#2B1E16] tabular-nums">
                  {summary.embedding_status.selected_top2_margin !== null
                    ? summary.embedding_status.selected_top2_margin.toFixed(4)
                    : 'Pending calibration'}
                </p>
              </div>
            </div>
          </section>

          {/* 20-Monument Dataset Split Coverage */}
          <section className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2D9C8] pb-4">
              <div className="flex items-center gap-2.5">
                <FolderCheck className="h-5 w-5 text-[#7D5A1C]" />
                <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
                  20-Monument Dataset Coverage &amp; Shortfall Report
                </h2>
              </div>
              <span className="font-mono text-xs text-[#695547] tabular-nums">
                {summary.monuments_meeting_target} / {summary.monuments_in_schema} meeting{' '}
                {summary.target_per_monument}+ target
              </span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2D9C8] text-[#695547]">
                    <th className="py-2.5 pr-4 font-medium">Folder</th>
                    <th className="py-2.5 pr-4 font-medium">Monument</th>
                    <th className="py-2.5 pr-4 font-medium">Ref</th>
                    <th className="py-2.5 pr-4 font-medium">Val</th>
                    <th className="py-2.5 pr-4 font-medium">Test</th>
                    <th className="py-2.5 pr-4 font-medium">Total</th>
                    <th className="py-2.5 pr-4 font-medium">Shortfall</th>
                    <th className="py-2.5 pr-4 font-medium">Review Req</th>
                    <th className="py-2.5 font-medium">Rejected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2D9C8]">
                  {(summary.monument_coverage ?? []).map((row) => (
                    <tr key={row.site_id} className="hover:bg-[#F3EDE1]/40">
                      <td className="py-2.5 pr-4 font-mono text-[11px] text-[#695547]">
                        {row.monument_folder}
                      </td>
                      <td className="py-2.5 pr-4 font-medium text-[#2B1E16]">
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate({ page: 'monument-detail', monumentId: row.site_id })
                          }
                          className="cursor-pointer hover:text-[#7D5A1C] hover:underline"
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums">{row.reference}</td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums">{row.validation}</td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums">{row.test}</td>
                      <td className="py-2.5 pr-4 font-mono font-semibold tabular-nums">
                        {row.total}
                      </td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums">
                        {row.shortfall === 0 ? (
                          <span className="text-[#166534]">0 (Met)</span>
                        ) : (
                          <span className="text-[#7D5A1C]">-{row.shortfall}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums text-[#695547]">
                        {row.review_required}
                      </td>
                      <td className="py-2.5 font-mono tabular-nums text-[#695547]">
                        {row.rejected}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Open Licence Breakdown */}
          <section className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex flex-col gap-2 border-b border-[#E2D9C8] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
                  Open-Licence Distribution
                </h2>
                <p className="mt-0.5 text-xs text-[#695547]">
                  Verified Creative Commons and Public Domain licences across all approved photographs.
                </p>
              </div>
              <span className="font-mono text-xs text-[#695547] tabular-nums">
                {Object.keys(summary.licence_breakdown).length} open licence class(es)
              </span>
            </div>

            {Object.keys(summary.licence_breakdown).length === 0 ? (
              <p className="mt-4 text-xs text-[#695547]">No approved images yet.</p>
            ) : (
              <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(summary.licence_breakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([licence, count]) => (
                    <div
                      key={licence}
                      className="rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-3.5"
                    >
                      <dt className="truncate text-xs font-medium text-[#695547]" title={licence}>
                        {licence}
                      </dt>
                      <dd className="mt-1 font-serif text-xl font-semibold text-[#2B1E16] tabular-nums">
                        {count}{' '}
                        <span className="font-sans text-xs font-normal text-[#695547]">
                          {count === 1 ? 'image' : 'images'}
                        </span>
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
          </section>

          {/* Data Quality & Anti-Leakage Validation Report */}
          <section className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex flex-col gap-2 border-b border-[#E2D9C8] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
                  Data Quality &amp; Anti-Leakage Validation Report
                </h2>
                <p className="mt-1 text-xs text-[#695547]">
                  Automated binary, hash, and provenance verification over all verified files on disk.
                </p>
              </div>
              <span className="font-mono text-[11px] text-[#695547] tabular-nums">
                Checked: {new Date(validation.checked_at).toLocaleString()}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {AUDIT_CHECKS.map((chk) => {
                const failed = validation.issues.some((iss) =>
                  chk.issueCodes.includes(iss.check)
                );
                return (
                  <div
                    key={chk.key}
                    className="rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#2B1E16]">{chk.label}</span>
                      {failed ? (
                        <ShieldAlert className="h-4 w-4 shrink-0 text-[#7F1D1D]" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#166534]" />
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[#695547]">
                      {chk.description}
                    </p>
                  </div>
                );
              })}
            </div>

            {validation.issues.length === 0 ? (
              <div className="mt-5 flex items-center gap-2 text-sm font-medium text-[#166534]">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  All integrity checks passed ({validation.files_verified_on_disk} file(s) verified on
                  disk, {validation.unique_sha256_count} unique SHA-256 hashes).
                </span>
              </div>
            ) : (
              <ul className="mt-5 space-y-2 text-xs text-[#7F1D1D]">
                {validation.issues.slice(0, 50).map((issue, idx) => (
                  <li key={idx} className="rounded border border-[#B91C1C]/30 bg-[#FEF2F2] p-3">
                    <span className="font-mono font-semibold">[{issue.check}]</span>{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* Full-Resolution Dataset Image Inspector Modal */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Dataset photograph inspection: ${monumentNameById.get(lightboxImage.site_id) ?? lightboxImage.site_id}`}
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#FAF7F0]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-[#E2D9C8] px-5 py-3.5">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-[#7D5A1C]">
                  {lightboxImage.image_split} Split · {lightboxImage.relative_path}
                </p>
                <h2 className="font-serif text-lg font-semibold text-[#2B1E16]">
                  {monumentNameById.get(lightboxImage.site_id) ?? lightboxImage.site_id}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                aria-label="Close photograph inspector"
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-[#E2D9C8] bg-[#FDFBF7] text-[#2B1E16] hover:bg-[#F3EDE1]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-[#1D1612] p-4">
              <img
                src={getApprovedImageSrc(lightboxImage)}
                alt={lightboxImage.filename}
                className="mx-auto max-h-[60vh] w-auto rounded object-contain"
              />
            </div>

            <div className="grid gap-3 border-t border-[#E2D9C8] bg-[#FDFBF7] px-5 py-4 text-xs sm:grid-cols-3">
              <div>
                <p className="text-[#695547]">Attribution &amp; Licence</p>
                <p className="mt-0.5 font-medium text-[#2B1E16]">
                  {lightboxImage.attribution_text ??
                    `${lightboxImage.creator ?? 'Wikimedia'} (${lightboxImage.licence})`}
                </p>
              </div>
              <div>
                <p className="text-[#695547]">Resolution &amp; Hash</p>
                <p className="mt-0.5 font-mono text-[#2B1E16] tabular-nums">
                  {lightboxImage.image_width}×{lightboxImage.image_height} px · SHA{' '}
                  {lightboxImage.sha256_hash.slice(0, 12)}…
                </p>
              </div>
              <div className="flex items-center justify-start gap-4 sm:justify-end">
                <a
                  href={lightboxImage.source_page_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16]"
                >
                  <span>Wikimedia Commons</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
                {lightboxImage.site_id !== 'unknown' && (
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = lightboxImage.site_id;
                      setLightboxImage(null);
                      onNavigate({ page: 'monument-detail', monumentId: targetId });
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 font-medium text-[#2B1E16] underline decoration-[#E2D9C8] underline-offset-4 hover:text-[#7D5A1C]"
                  >
                    <span>Open Dossier</span>
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
