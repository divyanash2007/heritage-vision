import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageIcon,
  Loader2,
  Maximize2,
  RotateCcw,
  ShieldCheck,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { fetchApprovedDatasetImages, fetchMonumentById } from '../lib/api';
import { getMonumentArchivalImage } from '../lib/monumentMedia';
import type { ArchitecturalCategory, ImageReference, MonumentRecord } from '../types/heritage';
import { MonumentPlate } from './MonumentPlate';

export interface MonumentGalleryProps {
  monumentId: string;
  monumentName?: string;
  accessionCode?: string;
  category?: ArchitecturalCategory;
  /** Optional preloaded imageReferences from parent MonumentRecord. If omitted, MonumentGallery fetches the record automatically. */
  images?: ImageReference[];
  /** Optional variant: 'feature' (hero plate + thumbnail strip, ideal for MonumentDetailPage) or 'grid' (multi-column gallery cards). */
  layout?: 'feature' | 'grid';
  className?: string;
}

interface GalleryMediaItem {
  id: string;
  siteId: string;
  previewUrl: string | null;
  highResUrl: string | null;
  caption: string;
  creator: string | null;
  licence: string | null;
  attribution: string | null;
  sourcePageUrl: string | null;
  verificationLabel: string;
  isDatasetEligible: boolean;
  dimensionsLabel: string | null;
}

function buildWikimediaFullResUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    const parsed = new URL(sourceUrl);
    if (!parsed.hostname.includes('wikimedia.org')) return null;
    const match = parsed.pathname.match(/\/wiki\/File:(.+)$/);
    if (!match?.[1]) return null;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${match[1]}`;
  } catch {
    return null;
  }
}

function resolveLocalAssetUrl(img: ImageReference): string | null {
  if (img.filename && img.filename.startsWith('dataset/')) {
    return `/dataset-images/${img.filename.replace(/^dataset\/images\//, '')}`;
  }
  const bundled = getMonumentArchivalImage(img.site_id);
  if (bundled && (!img.filename || img.filename.startsWith('src/assets/images/'))) {
    return bundled;
  }
  return img.source_url;
}

function toGalleryMediaItem(img: ImageReference): GalleryMediaItem {
  const localUrl = resolveLocalAssetUrl(img);
  const fullResUrl = buildWikimediaFullResUrl(img.source_url) ?? localUrl;
  return {
    id: img.image_id,
    siteId: img.site_id,
    previewUrl: localUrl,
    highResUrl: fullResUrl,
    caption: img.caption,
    creator: img.creator,
    licence: img.licence,
    attribution: img.attribution,
    sourcePageUrl: img.source_url,
    verificationLabel:
      img.verification_status === 'verified_dataset_photo'
        ? 'Verified CC Photograph'
        : img.verification_status,
    isDatasetEligible: img.is_recognition_dataset_image,
    dimensionsLabel: null,
  };
}

export function MonumentGallery({
  monumentId,
  monumentName,
  accessionCode,
  category,
  images: externalImages,
  layout = 'feature',
  className = '',
}: MonumentGalleryProps) {
  const [fetchedRecord, setFetchedRecord] = useState<MonumentRecord | null>(null);
  const [approvedDatasetExtras, setApprovedDatasetExtras] = useState<GalleryMediaItem[]>([]);
  const [loading, setLoading] = useState<boolean>(!externalImages);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<1 | 1.5 | 2>(1);
  const [highResLoadedUrl, setHighResLoadedUrl] = useState<string | null>(null);

  // Fetch monument record (especially when used standalone with monumentId) and approved dataset extras
  useEffect(() => {
    let active = true;

    async function loadGalleryData() {
      try {
        if (!externalImages) {
          setLoading(true);
        }
        setError(null);

        const [recordResult, approvedResult] = await Promise.allSettled([
          fetchMonumentById(monumentId),
          fetchApprovedDatasetImages({ siteId: monumentId, limit: 24 }),
        ]);

        if (!active) return;

        if (recordResult.status === 'fulfilled') {
          setFetchedRecord(recordResult.value);
        } else if (!externalImages) {
          setError(
            recordResult.reason instanceof Error
              ? recordResult.reason.message
              : 'Unable to fetch monument gallery images.'
          );
        }

        if (approvedResult.status === 'fulfilled') {
          const monumentTitle =
            recordResult.status === 'fulfilled'
              ? recordResult.value.name
              : monumentName ?? monumentId;
          const matching = approvedResult.value.images
            .filter((img) => img.site_id === monumentId)
            .map((img): GalleryMediaItem => {
              const relUrl = `/dataset-images/${
                img.relative_path || `${img.monument_folder}/${img.image_split}/${img.filename}`
              }`;
              return {
                id: img.image_id,
                siteId: img.site_id,
                previewUrl: relUrl,
                highResUrl:
                  buildWikimediaFullResUrl(img.source_page_url) ??
                  img.original_source_url ??
                  relUrl,
                caption: `${monumentTitle} (${img.image_split} dataset photograph)`,
                creator: img.creator,
                licence: img.licence,
                attribution: img.attribution_text,
                sourcePageUrl: img.source_page_url,
                verificationLabel: `Approved ${img.image_split} Photo`,
                isDatasetEligible: true,
                dimensionsLabel:
                  img.image_width && img.image_height
                    ? `${img.image_width} × ${img.image_height} px`
                    : null,
              };
            });
          setApprovedDatasetExtras(matching);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadGalleryData();
    return () => {
      active = false;
    };
  }, [monumentId, externalImages, reloadTick]);

  const resolvedName = monumentName ?? fetchedRecord?.name ?? monumentId;
  const resolvedAccession = accessionCode ?? fetchedRecord?.accessionCode ?? 'HV';
  const resolvedCategory = category ?? fetchedRecord?.category ?? 'Mughal & Indo-Islamic';

  const galleryItems = useMemo(() => {
    const baseRefs = fetchedRecord?.imageReferences ?? externalImages ?? [];
    const baseItems = baseRefs.map(toGalleryMediaItem);
    const seenUrls = new Set(
      baseItems.map((item) => item.sourcePageUrl).filter((url): url is string => Boolean(url))
    );
    const merged = [...baseItems];
    for (const extra of approvedDatasetExtras) {
      if (extra.sourcePageUrl && seenUrls.has(extra.sourcePageUrl)) continue;
      merged.push(extra);
    }
    return merged;
  }, [fetchedRecord, externalImages, approvedDatasetExtras]);

  useEffect(() => {
    setActiveIndex(0);
    setLightboxOpen(false);
    setZoomLevel(1);
    setHighResLoadedUrl(null);
  }, [monumentId]);

  const currentItem = galleryItems[activeIndex] ?? galleryItems[0] ?? null;

  // Progressive full-resolution loader whenever lightbox is open on an item
  useEffect(() => {
    if (!lightboxOpen || !currentItem?.highResUrl) return;
    if (currentItem.highResUrl === currentItem.previewUrl) {
      setHighResLoadedUrl(currentItem.previewUrl);
      return;
    }

    let cancelled = false;
    setHighResLoadedUrl(null);
    const preload = new Image();
    preload.referrerPolicy = 'no-referrer';
    preload.onload = () => {
      if (!cancelled) {
        setHighResLoadedUrl(currentItem.highResUrl);
      }
    };
    preload.onerror = () => {
      if (!cancelled) {
        setHighResLoadedUrl(currentItem.previewUrl);
      }
    };
    preload.src = currentItem.highResUrl;

    return () => {
      cancelled = true;
    };
  }, [lightboxOpen, currentItem]);

  const openLightboxAt = useCallback((idx: number) => {
    setActiveIndex(idx);
    setZoomLevel(1);
    setLightboxOpen(true);
  }, []);

  const showPrevious = useCallback(() => {
    if (galleryItems.length <= 1) return;
    setZoomLevel(1);
    setActiveIndex((prev) => (prev - 1 + galleryItems.length) % galleryItems.length);
  }, [galleryItems.length]);

  const showNext = useCallback(() => {
    if (galleryItems.length <= 1) return;
    setZoomLevel(1);
    setActiveIndex((prev) => (prev + 1) % galleryItems.length);
  }, [galleryItems.length]);

  // Keyboard navigation inside Lightbox
  useEffect(() => {
    if (!lightboxOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setLightboxOpen(false);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showPrevious();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        showNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, showPrevious, showNext]);

  if (loading) {
    return (
      <div
        className={`flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-[#E2D9C8] bg-[#F3EDE1]/60 ${className}`}
      >
        <div className="flex items-center gap-2 text-xs text-[#695547]">
          <Loader2 className="h-4 w-4 animate-spin text-[#7D5A1C]" aria-hidden="true" />
          <span>Loading monument photographs...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className={`rounded-lg border border-[#7F1D1D]/30 bg-[#FEF2F2] p-6 text-center ${className}`}
      >
        <p className="text-sm font-medium text-[#7F1D1D]">{error}</p>
        <button
          type="button"
          onClick={() => setReloadTick((n) => n + 1)}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded border border-[#7F1D1D]/40 bg-white px-3 py-1.5 text-xs font-medium text-[#7F1D1D] hover:bg-[#FEF2F2]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Retry Gallery Fetch</span>
        </button>
      </div>
    );
  }

  if (galleryItems.length === 0 || !currentItem) {
    return (
      <div className={`overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] ${className}`}>
        <MonumentPlate
          monumentId={monumentId}
          monumentName={resolvedName}
          accessionCode={resolvedAccession}
          category={resolvedCategory}
          className="aspect-[4/3] w-full"
        />
        <p className="border-t border-[#E2D9C8] px-4 py-3 text-xs italic text-[#695547]">
          No photographs indexed in imageReferences for {resolvedName}.
        </p>
      </div>
    );
  }

  const activeLightboxSrc =
    highResLoadedUrl ?? currentItem.previewUrl ?? currentItem.highResUrl ?? '';
  const isShowingFullRes =
    Boolean(highResLoadedUrl) &&
    currentItem.highResUrl !== currentItem.previewUrl &&
    highResLoadedUrl === currentItem.highResUrl;

  return (
    <div className={className}>
      {layout === 'feature' ? (
        <figure className="overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#FDFBF7]">
          <div className="group relative aspect-[4/3] w-full overflow-hidden bg-[#EFE9DC]">
            <button
              type="button"
              onClick={() => openLightboxAt(activeIndex)}
              aria-label={`Open full-size lightbox view for ${resolvedName}`}
              className="block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#8B6624]"
            >
              {currentItem.previewUrl ? (
                <img
                  src={currentItem.previewUrl}
                  alt={currentItem.caption || `${resolvedName} heritage photograph`}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
                />
              ) : (
                <MonumentPlate
                  monumentId={monumentId}
                  monumentName={resolvedName}
                  accessionCode={resolvedAccession}
                  category={resolvedCategory}
                  className="h-full w-full"
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => openLightboxAt(activeIndex)}
              className="absolute right-3 bottom-3 inline-flex cursor-pointer items-center gap-1.5 rounded border border-[#E2D9C8]/90 bg-[#2B1E16]/85 px-3 py-1.5 text-xs font-medium text-[#FAF7F0] backdrop-blur-xs transition-colors hover:bg-[#7D5A1C]"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>View High-Resolution</span>
            </button>
          </div>

          <figcaption className="border-t border-[#E2D9C8] px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-serif text-xs italic text-[#2B1E16]">
                {currentItem.caption || `Architectural photograph of ${resolvedName}.`}
              </p>
              <span className="shrink-0 font-mono text-[11px] text-[#7D5A1C] tabular-nums">
                {activeIndex + 1} / {galleryItems.length} photo{galleryItems.length === 1 ? '' : 's'}
              </span>
            </div>

            {(currentItem.creator || currentItem.licence) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#695547]">
                {currentItem.creator && <span>Photographer: {currentItem.creator}</span>}
                {currentItem.licence && <span>· Licence: {currentItem.licence}</span>}
                {currentItem.sourcePageUrl && (
                  <a
                    href={currentItem.sourcePageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-2 hover:text-[#2B1E16]"
                  >
                    <span>Wikimedia File</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            )}

            {galleryItems.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-[#E2D9C8] pt-3">
                {galleryItems.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveIndex(idx)}
                    onDoubleClick={() => openLightboxAt(idx)}
                    aria-label={`Select gallery photograph ${idx + 1} for ${resolvedName}`}
                    className={`h-14 w-20 cursor-pointer overflow-hidden rounded border transition-all ${
                      idx === activeIndex
                        ? 'border-[#7D5A1C] ring-2 ring-[#C8A55B]/60'
                        : 'border-[#E2D9C8] opacity-75 hover:opacity-100'
                    }`}
                  >
                    {item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt={item.caption}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#F3EDE1]">
                        <ImageIcon className="h-4 w-4 text-[#7D5A1C]" aria-hidden="true" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </figcaption>
        </figure>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {galleryItems.map((item, idx) => (
            <figure
              key={item.id}
              className="group overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#FDFBF7]"
            >
              <button
                type="button"
                onClick={() => openLightboxAt(idx)}
                className="relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden bg-[#EFE9DC]"
              >
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.caption}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <MonumentPlate
                    monumentId={monumentId}
                    monumentName={resolvedName}
                    accessionCode={resolvedAccession}
                    category={resolvedCategory}
                    className="h-full w-full"
                  />
                )}
                <span className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded bg-[#2B1E16]/80 px-2 py-1 text-[11px] font-medium text-[#FAF7F0]">
                  <Maximize2 className="h-3 w-3" aria-hidden="true" />
                  <span>Inspect</span>
                </span>
              </button>
              <figcaption className="border-t border-[#E2D9C8] p-3 text-xs">
                <p className="line-clamp-2 font-medium text-[#2B1E16]">{item.caption}</p>
                <p className="mt-1 text-[11px] text-[#695547]">
                  {item.creator ?? 'Verified Source'} · {item.licence ?? 'Open Licence'}
                </p>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {/* Full-Size High-Resolution Lightbox Modal */}
      {lightboxOpen && currentItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`High-resolution photograph viewer for ${resolvedName}`}
          className="fixed inset-0 z-50 flex flex-col bg-[#1A130F]/95 text-[#FAF7F0] backdrop-blur-xs"
        >
          {/* Lightbox Top Bar */}
          <div className="flex items-center justify-between gap-4 border-b border-[#E2D9C8]/20 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-wider text-[#C8A55B] tabular-nums">
                {resolvedAccession} · {currentItem.id} · Image {activeIndex + 1} of{' '}
                {galleryItems.length}
              </p>
              <h2 className="truncate font-serif text-lg font-semibold text-[#FAF7F0]">
                {resolvedName}
              </h2>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setZoomLevel((prev) => (prev === 2 ? 1.5 : prev === 1.5 ? 1 : 1))
                }
                disabled={zoomLevel === 1}
                aria-label="Zoom out"
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded border border-[#E2D9C8]/30 text-[#FAF7F0] hover:bg-[#FAF7F0]/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </button>

              <span className="min-w-[46px] text-center font-mono text-xs text-[#E2D9C8] tabular-nums">
                {Math.round(zoomLevel * 100)}%
              </span>

              <button
                type="button"
                onClick={() =>
                  setZoomLevel((prev) => (prev === 1 ? 1.5 : prev === 1.5 ? 2 : 2))
                }
                disabled={zoomLevel === 2}
                aria-label="Zoom in"
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded border border-[#E2D9C8]/30 text-[#FAF7F0] hover:bg-[#FAF7F0]/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                aria-label="Close high-resolution lightbox"
                className="ml-2 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded border border-[#C8A55B]/60 bg-[#7D5A1C] px-3 text-xs font-medium text-[#FAF7F0] hover:bg-[#654714]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Close</span>
              </button>
            </div>
          </div>

          {/* Main Lightbox Viewport */}
          <div className="relative flex flex-1 items-center justify-center overflow-auto p-4 sm:p-8">
            {galleryItems.length > 1 && (
              <button
                type="button"
                onClick={showPrevious}
                aria-label="Previous photograph"
                className="fixed top-1/2 left-3 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded border border-[#E2D9C8]/30 bg-[#1A130F]/80 text-[#FAF7F0] hover:bg-[#7D5A1C] sm:left-6"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            )}

            <div className="flex max-h-full max-w-full items-center justify-center overflow-auto">
              <img
                src={activeLightboxSrc}
                alt={currentItem.caption || resolvedName}
                referrerPolicy="no-referrer"
                onClick={() => setZoomLevel((prev) => (prev === 1 ? 1.5 : 1))}
                className={`rounded border border-[#E2D9C8]/25 object-contain shadow-2xl transition-all duration-200 ${
                  zoomLevel === 1
                    ? 'max-h-[72vh] max-w-[90vw] cursor-zoom-in'
                    : zoomLevel === 1.5
                      ? 'max-h-[110vh] max-w-[135vw] cursor-zoom-in'
                      : 'max-h-[150vh] max-w-[180vw] cursor-zoom-out'
                }`}
              />
            </div>

            {galleryItems.length > 1 && (
              <button
                type="button"
                onClick={showNext}
                aria-label="Next photograph"
                className="fixed top-1/2 right-3 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded border border-[#E2D9C8]/30 bg-[#1A130F]/80 text-[#FAF7F0] hover:bg-[#7D5A1C] sm:right-6"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Lightbox Metadata Footer */}
          <div className="border-t border-[#E2D9C8]/20 bg-[#231914] px-4 py-3.5 sm:px-6">
            <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="font-serif text-sm text-[#FAF7F0]">{currentItem.caption}</p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#E2D9C8]/80">
                  <span className="inline-flex items-center gap-1 text-[#C8A55B]">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{currentItem.verificationLabel}</span>
                  </span>
                  {currentItem.creator && <span>· Creator: {currentItem.creator}</span>}
                  {currentItem.licence && <span>· Licence: {currentItem.licence}</span>}
                  {currentItem.dimensionsLabel && <span>· {currentItem.dimensionsLabel}</span>}
                  <span className="font-mono text-[11px] text-[#C8A55B]">
                    · {isShowingFullRes ? 'Full-Resolution Wikimedia Master' : 'Archival High-Res Plate'}
                  </span>
                </p>
              </div>

              {currentItem.sourcePageUrl && (
                <a
                  href={currentItem.sourcePageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded border border-[#C8A55B]/60 px-3 py-1.5 text-xs font-medium text-[#FAF7F0] hover:bg-[#7D5A1C]"
                >
                  <span>Inspect Wikimedia Source</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
