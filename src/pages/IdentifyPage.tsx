import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileImage,
  Info,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import {
  checkFastApiBackendStatus,
  FASTAPI_RECOGNITION_ENDPOINT,
  FastApiRecognitionError,
  recognizeMonumentWithFastApi,
  SUPPORTED_MONUMENT_DISPLAY_NAMES,
  type FastApiBackendStatus,
  type MonumentRecognitionResult,
} from '../services/recognitionApi';
import type { AppRoute } from '../components/Navbar';

interface IdentifyPageProps {
  onNavigate: (route: AppRoute) => void;
}

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function IdentifyPage({ onNavigate }: IdentifyPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);

  const [backendStatus, setBackendStatus] = useState<FastApiBackendStatus | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(
    null
  );
  const [dragActive, setDragActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<{
    kind: 'network' | 'timeout' | 'http_error' | 'invalid_response' | 'aborted';
    message: string;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<MonumentRecognitionResult | null>(null);

  useEffect(() => {
    let active = true;
    checkFastApiBackendStatus()
      .then((status) => {
        if (active) setBackendStatus(status);
      })
      .catch(() => {
        // Handled cleanly inside checkFastApiBackendStatus
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      activeAbortRef.current?.abort();
    };
  }, []);

  const handleFileSelection = (file: File | undefined) => {
    setValidationError(null);
    setApiError(null);
    setResult(null);
    setImageDimensions(null);

    if (!file) return;

    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      setValidationError(
        `Unsupported format "${file.type || 'unknown'}". Please upload a JPEG, PNG, or WebP photograph.`
      );
      return;
    }

    if (file.size < 64) {
      setValidationError('Selected file is empty or too small to be a valid photograph.');
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setValidationError(
        `File size (${formatBytes(file.size)}) exceeds the 10 MB upload limit.`
      );
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(objectUrl);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    handleFileSelection(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    handleFileSelection(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleClear = () => {
    activeAbortRef.current?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    setImageDimensions(null);
    setValidationError(null);
    setApiError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCancelRequest = () => {
    activeAbortRef.current?.abort();
  };

  const handleIdentify = async () => {
    if (!selectedFile) {
      setValidationError('Please select or drop a monument photograph before identifying.');
      return;
    }

    const controller = new AbortController();
    activeAbortRef.current = controller;

    setIsProcessing(true);
    setValidationError(null);
    setApiError(null);
    setResult(null);

    try {
      const response = await recognizeMonumentWithFastApi(selectedFile, {
        timeoutMs: 25000,
        signal: controller.signal,
      });
      setResult(response);
      setBackendStatus((prev) => ({
        reachable: true,
        project: prev?.project ?? 'HERITAGE VISION',
        status: 'API is running',
        recognitionEngine: prev?.recognitionEngine ?? 'OpenCLIP ViT-B-32',
        supportedLabels: prev?.supportedLabels ?? ['Taj_Mahal', 'Red_Fort', 'Qutub_Minar'],
        error: null,
      }));
    } catch (err) {
      if (err instanceof FastApiRecognitionError) {
        if (err.kind === 'network' || err.kind === 'timeout') {
          setBackendStatus((prev) =>
            prev
              ? { ...prev, reachable: false, error: err.message }
              : {
                  reachable: false,
                  project: null,
                  status: null,
                  recognitionEngine: null,
                  supportedLabels: [],
                  error: err.message,
                }
          );
        }
        setApiError({
          kind: err.kind,
          message: err.message,
        });
      } else {
        setApiError({
          kind: 'network',
          message:
            err instanceof Error
              ? err.message
              : 'Unable to communicate with the OpenCLIP recognition backend.',
        });
      }
    } finally {
      setIsProcessing(false);
      activeAbortRef.current = null;
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="border-b border-[#E2D9C8] pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7D5A1C]">
          Visual Recognition Workbench
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-[#2B1E16] sm:text-4xl">
          Monument Image Identification
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#695547]">
          Upload an Indian monument photograph to query the experimental OpenCLIP FastAPI
          recognition service. The current model evaluates similarity strictly across three
          supported monuments: Taj Mahal, Red Fort, and Qutub Minar.
        </p>

        <dl className="mt-5 grid gap-4 border-t border-[#E2D9C8] pt-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[#695547]">FastAPI Backend Status</dt>
            <dd className="mt-0.5 font-mono font-medium text-[#2B1E16]">
              {backendStatus === null
                ? 'Checking endpoint...'
                : backendStatus.reachable
                  ? `Connected (${backendStatus.status ?? 'Online'})`
                  : 'Unavailable / Tunnel Offline'}
            </dd>
          </div>
          <div>
            <dt className="text-[#695547]">Recognition Engine</dt>
            <dd className="mt-0.5 font-mono text-[#2B1E16]">
              {backendStatus?.recognitionEngine ?? 'OpenCLIP ViT-B-32 (Prototype)'}
            </dd>
          </div>
          <div>
            <dt className="text-[#695547]">Supported Backend Monuments (3)</dt>
            <dd className="mt-0.5 font-medium text-[#2B1E16]">
              {SUPPORTED_MONUMENT_DISPLAY_NAMES.join(' · ')}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        {/* Left Column: Upload & Preview */}
        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
              Upload Photograph
            </h2>
            <p className="mt-1 text-xs text-[#695547]">
              Supported formats: JPEG, PNG, WebP · Maximum file size: 10 MB
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleInputChange}
              className="sr-only"
              id="monument-image-upload"
            />

            {!previewUrl ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`mt-5 flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-6 py-10 text-center transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B6624] ${
                  dragActive
                    ? 'border-[#8B6624] bg-[#F3EDE1]'
                    : 'border-[#C8A55B] bg-[#FAF7F0] hover:bg-[#F3EDE1]/60'
                }`}
              >
                <Upload className="h-8 w-8 text-[#7D5A1C]" aria-hidden="true" />
                <p className="mt-4 text-sm font-medium text-[#2B1E16]">
                  Drag and drop a monument photograph here
                </p>
                <p className="mt-1 text-xs text-[#695547]">
                  or click to browse from your device
                </p>
                <p className="mt-4 font-mono text-[11px] text-[#695547]">
                  JPG / PNG / WEBP · Up to 10 MB
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="relative overflow-hidden rounded-md border border-[#E2D9C8] bg-[#EFE9DC]">
                  <img
                    src={previewUrl}
                    alt={selectedFile ? `Preview of ${selectedFile.name}` : 'Selected monument preview'}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setImageDimensions({
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                      });
                    }}
                    onError={() => {
                      setValidationError(
                        'Unable to decode image preview. The file may be corrupted or mislabelled.'
                      );
                    }}
                    className="max-h-[340px] w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={handleClear}
                    aria-label="Remove selected image"
                    className="absolute right-2.5 top-2.5 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[#E2D9C8] bg-[#FAF7F0]/95 text-[#2B1E16] hover:bg-[#F3EDE1]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {selectedFile && (
                  <dl className="grid grid-cols-2 gap-3 border-t border-[#E2D9C8] pt-4 text-xs">
                    <div>
                      <dt className="text-[#695547]">File Name</dt>
                      <dd className="mt-0.5 truncate font-medium text-[#2B1E16]">
                        {selectedFile.name}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#695547]">Size &amp; Format</dt>
                      <dd className="mt-0.5 font-mono text-[#2B1E16] tabular-nums">
                        {formatBytes(selectedFile.size)} ·{' '}
                        {selectedFile.type.replace('image/', '').toUpperCase()}
                      </dd>
                    </div>
                    {imageDimensions && (
                      <div className="col-span-2">
                        <dt className="text-[#695547]">Resolution</dt>
                        <dd className="mt-0.5 font-mono text-[#2B1E16] tabular-nums">
                          {imageDimensions.width} × {imageDimensions.height} px
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            )}

            {validationError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-md border border-[#B91C1C]/30 bg-[#FEF2F2] p-3.5 text-xs text-[#7F1D1D]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{validationError}</span>
              </div>
            )}

            {apiError && (
              <div
                role="alert"
                className="mt-4 space-y-3 rounded-md border border-[#B91C1C]/30 bg-[#FEF2F2] p-4 text-xs text-[#7F1D1D]"
              >
                <div className="flex items-start gap-2.5">
                  {apiError.kind === 'timeout' ? (
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <div className="space-y-1">
                    <p className="font-semibold">
                      {apiError.kind === 'timeout'
                        ? 'Recognition Backend Timed Out'
                        : apiError.kind === 'aborted'
                          ? 'Recognition Request Cancelled'
                          : 'Recognition Backend Unavailable / Error'}
                    </p>
                    <p className="leading-relaxed">{apiError.message}</p>
                  </div>
                </div>

                {selectedFile && !isProcessing && (
                  <button
                    type="button"
                    onClick={handleIdentify}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#B91C1C]/40 bg-white px-3 py-1.5 text-xs font-medium text-[#7F1D1D] transition-colors hover:bg-[#FEE2E2]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Retry Identification</span>
                  </button>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!selectedFile || isProcessing}
                onClick={handleIdentify}
                className="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-md bg-[#7D5A1C] px-5 py-2.5 text-sm font-medium text-[#FAF7F0] transition-colors duration-150 hover:bg-[#654714] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Analyzing Image...</span>
                  </>
                ) : (
                  <>
                    <FileImage className="h-4 w-4" aria-hidden="true" />
                    <span>Identify Monument</span>
                  </>
                )}
              </button>

              {isProcessing ? (
                <button
                  type="button"
                  onClick={handleCancelRequest}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-4 py-2.5 text-sm font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1]"
                >
                  Cancel
                </button>
              ) : (
                selectedFile && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-4 py-2.5 text-sm font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1]"
                  >
                    Clear
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Recognition Output Structure */}
        <div className="space-y-6 lg:col-span-7" aria-live="polite">
          {/* Best Matching Monument & Response Status */}
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex flex-col gap-3 border-b border-[#E2D9C8] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-[#695547]">Best Matching Monument</p>
                <h2 className="mt-1 font-serif text-xl font-semibold text-[#2B1E16]">
                  {result
                    ? result.bestMatch.monumentName
                    : isProcessing
                      ? 'Querying OpenCLIP Service...'
                      : 'Awaiting Image Submission'}
                </h2>
              </div>

              <div className="text-left sm:text-right">
                <p className="text-xs text-[#695547]">Inference Backend</p>
                <p className="mt-0.5 font-mono text-xs font-medium text-[#7D5A1C]">
                  {result?.modelEngine ?? backendStatus?.recognitionEngine ?? 'OpenCLIP ViT-B-32'}
                </p>
              </div>
            </div>

            {!result && !isProcessing && !apiError && (
              <div className="mt-5 flex items-start gap-3 text-sm leading-relaxed text-[#695547]">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#7D5A1C]" aria-hidden="true" />
                <p>
                  Select or drop a photograph on the left and click{' '}
                  <strong className="font-medium text-[#2B1E16]">Identify Monument</strong> to send
                  the file to the OpenCLIP FastAPI service. Ranked similarity percentages for Taj
                  Mahal, Red Fort, and Qutub Minar will appear here in descending order.
                </p>
              </div>
            )}

            {isProcessing && (
              <div className="mt-5 flex items-center gap-3 text-sm text-[#695547]">
                <Loader2 className="h-4 w-4 animate-spin text-[#7D5A1C]" aria-hidden="true" />
                <span>
                  Uploading photograph via multipart FormData to{' '}
                  <span className="font-mono text-xs text-[#2B1E16]">POST /recognize</span>...
                </span>
              </div>
            )}

            {!isProcessing && apiError && !result && (
              <div className="mt-5 flex items-start justify-between gap-4 rounded-md border border-[#B91C1C]/30 bg-[#FEF2F2] p-4 text-xs text-[#7F1D1D]">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">No Recognition Results Available</p>
                    <p className="mt-1 leading-relaxed">
                      Because the FastAPI backend returned an error or was unreachable, no
                      synthetic predictions or fallback scores are shown.
                    </p>
                  </div>
                </div>
                {selectedFile && (
                  <button
                    type="button"
                    onClick={handleIdentify}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[#B91C1C]/40 bg-white px-3 py-1.5 font-medium text-[#7F1D1D] hover:bg-[#FEE2E2]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            )}

            {result && (
              <div className="mt-5 space-y-5">
                <div className="rounded-md border border-[#C8A55B]/70 bg-[#FBF3E4] p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <CheckCircle2
                        className="mt-0.5 h-5 w-5 shrink-0 text-[#7D5A1C]"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-xs font-medium text-[#695547]">
                          Top Similarity Match (#1) · {result.bestMatch.state}
                        </p>
                        <p className="mt-0.5 font-serif text-2xl font-semibold text-[#2B1E16]">
                          {result.bestMatch.monumentName}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate({
                              page: 'monument-detail',
                              monumentId: result.bestMatch.siteId,
                            })
                          }
                          className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16]"
                        >
                          <span>View verified historical dossier</span>
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-[#E2D9C8] pt-3 text-left sm:border-t-0 sm:pt-0 sm:text-right">
                      <p className="text-xs text-[#695547]">Similarity Percentage</p>
                      <p className="mt-0.5 font-mono text-2xl font-semibold text-[#7D5A1C] tabular-nums">
                        {result.bestMatch.similarityPercentage.toFixed(2)}%
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-[#695547]">
                        Cosine score: {result.bestMatch.similarity.toFixed(4)}
                      </p>
                    </div>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-4 border-t border-[#E2D9C8] pt-4 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-[#695547]">Response Status</dt>
                    <dd className="mt-0.5 font-mono font-medium text-[#2B1E16]">
                      {result.status}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#695547]">Backend Filename</dt>
                    <dd
                      className="mt-0.5 truncate font-mono text-[#2B1E16]"
                      title={result.filename}
                    >
                      {result.filename}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#695547]">Top-2 Separation</dt>
                    <dd className="mt-0.5 font-mono text-[#2B1E16] tabular-nums">
                      {result.topTwoMarginPercent !== null
                        ? `${result.topTwoMarginPercent.toFixed(2)}%`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#695547]">Round-Trip Time</dt>
                    <dd className="mt-0.5 font-mono text-[#2B1E16] tabular-nums">
                      {result.responseTimeMs} ms
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>

          {/* Ranked Candidates Table (Descending Order) */}
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex flex-col gap-1 border-b border-[#E2D9C8] pb-4 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <h3 className="font-serif text-lg font-semibold text-[#2B1E16]">
                  Ranked Candidate Similarities
                </h3>
                <p className="mt-0.5 text-xs text-[#695547]">
                  Ordered descending by OpenCLIP cosine similarity percentage (NOT a verified
                  confidence probability)
                </p>
              </div>
              <span className="font-mono text-xs text-[#695547] tabular-nums">
                {result ? `${result.candidates.length} / 3 returned` : '3 supported classes'}
              </span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#E2D9C8] text-xs font-medium text-[#695547]">
                    <th className="py-2.5 pr-4">Rank</th>
                    <th className="py-2.5 pr-4">Candidate Monument</th>
                    <th className="py-2.5 pr-4">Relative Visual Bar</th>
                    <th className="py-2.5 text-right">Similarity % (Raw Score)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2D9C8]">
                  {result
                    ? result.candidates.map((candidate) => (
                        <tr key={candidate.siteId} className="hover:bg-[#F3EDE1]/50">
                          <td className="py-3 pr-4 font-mono text-xs text-[#695547] tabular-nums">
                            #{candidate.rank}{' '}
                            {candidate.rank === 1 ? '· Best' : '· Alt'}
                          </td>
                          <td className="py-3 pr-4">
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate({
                                  page: 'monument-detail',
                                  monumentId: candidate.siteId,
                                })
                              }
                              className="cursor-pointer font-medium text-[#2B1E16] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#7D5A1C]"
                            >
                              {candidate.monumentName}
                            </button>
                            <p className="mt-0.5 text-[11px] text-[#695547]">{candidate.state}</p>
                          </td>
                          <td className="py-3 pr-4">
                            <svg
                              viewBox="0 0 100 8"
                              preserveAspectRatio="none"
                              role="img"
                              aria-label={`${candidate.similarityPercentage.toFixed(2)}% similarity bar`}
                              className="h-2 w-full max-w-[160px] overflow-hidden rounded-sm bg-[#EFE9DC]"
                            >
                              <rect
                                x="0"
                                y="0"
                                height="8"
                                width={Math.max(2, Math.min(100, candidate.similarityPercentage))}
                                fill="#7D5A1C"
                              />
                            </svg>
                          </td>
                          <td className="py-3 text-right font-mono text-xs text-[#2B1E16] tabular-nums">
                            <span className="font-semibold">
                              {candidate.similarityPercentage.toFixed(2)}%
                            </span>{' '}
                            <span className="text-[#695547]">
                              ({candidate.similarity.toFixed(4)})
                            </span>
                          </td>
                        </tr>
                      ))
                    : SUPPORTED_MONUMENT_DISPLAY_NAMES.map((name, idx) => (
                        <tr key={name} className="text-[#695547]/75">
                          <td className="py-3 pr-4 font-mono text-xs tabular-nums">#{idx + 1}</td>
                          <td className="py-3 pr-4 text-xs">{name}</td>
                          <td className="py-3 pr-4 text-xs">—</td>
                          <td className="py-3 text-right font-mono text-xs tabular-nums">—</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Scope & Prototype Limitations Notice */}
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#7D5A1C]" aria-hidden="true" />
              <div>
                <h3 className="font-serif text-lg font-semibold text-[#2B1E16]">
                  Experimental Scope &amp; Similarity Interpretation
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-[#695547]">
                  The active FastAPI OpenCLIP backend currently indexes only three monuments:{' '}
                  <strong className="font-medium text-[#2B1E16]">
                    Taj Mahal, Red Fort, and Qutub Minar
                  </strong>
                  . Photographs depicting other Indian monuments (even those documented in the
                  20-site Heritage Explorer) or non-monument scenes will still receive similarity
                  scores against these three classes and must not be interpreted as supported
                  identifications.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-[#695547]">
                  Similarity percentages represent normalized OpenCLIP cosine similarity scaled for
                  readability—not calibrated probabilities, verification certainty, or
                  production-ready classification accuracy.
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-[#E2D9C8] pt-3 text-[11px] text-[#695547]">
              Endpoint:{' '}
              <span className="font-mono text-[#2B1E16]">{FASTAPI_RECOGNITION_ENDPOINT}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
