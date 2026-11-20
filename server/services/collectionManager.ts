import type {
  CollectionJobProgress,
  RejectedDatasetRecord,
  WikimediaCandidate,
} from '../../src/types/heritage.ts';
import {
  MONUMENT_SEARCH_PROFILES,
  UNKNOWN_DISTRACTOR_PROFILE,
  type MonumentSearchProfile,
} from './monumentSearchProfiles.ts';
import {
  DEFAULT_TARGET_PER_MONUMENT,
  appendRejectedRecords,
  commitCandidateToDataset,
  computeAndSaveDatasetSummary,
  loadApprovedImages,
  loadDownloadFailures,
  loadReviewQueue,
  mergeCandidatesIntoQueue,
  removeDownloadFailure,
  selectBalancedSplitForCandidate,
  writeReviewQueue,
} from './datasetService.ts';
import {
  fetchCategoryMembersPaginated,
  searchWikimediaPaginated,
  sleepMs,
} from './wikimediaService.ts';

let progress: CollectionJobProgress = {
  status: 'idle',
  mode: 'all_monuments',
  target_per_monument: DEFAULT_TARGET_PER_MONUMENT,
  monuments_total: MONUMENT_SEARCH_PROFILES.length,
  monuments_completed: 0,
  current_site_id: null,
  current_monument_name: null,
  current_query: null,
  candidates_fetched: 0,
  images_downloaded: 0,
  flagged_review_required: 0,
  auto_rejected: 0,
  duplicates_skipped: 0,
  download_failures: 0,
  started_at: null,
  updated_at: null,
  last_message: null,
};

let pauseRequested = false;
let activePromise: Promise<void> | null = null;
let lastStartParams: StartCollectionOptions = {
  mode: 'all_monuments',
  targetPerMonument: DEFAULT_TARGET_PER_MONUMENT,
};

export interface StartCollectionOptions {
  mode?: 'all_monuments' | 'single_monument' | 'unknown_only' | 'retry_failures';
  targetPerMonument?: number;
  unknownTarget?: number;
  siteId?: string;
}

export function getCollectionProgress(): CollectionJobProgress {
  return { ...progress };
}

function touchProgress(patch: Partial<CollectionJobProgress>): void {
  progress = {
    ...progress,
    ...patch,
    updated_at: new Date().toISOString(),
  };
}

function markQueueCandidateRejected(
  candidateId: string,
  reason: string
): WikimediaCandidate | null {
  const queue = loadReviewQueue();
  const idx = queue.findIndex((c) => c.candidate_id === candidateId);
  if (idx === -1) return null;
  queue[idx] = {
    ...queue[idx],
    approval_status: 'rejected',
    rejection_reason: reason,
    reviewed_at: new Date().toISOString(),
  };
  writeReviewQueue(queue);
  return queue[idx];
}

async function processMonumentProfile(
  profile: MonumentSearchProfile,
  targetCount: number
): Promise<void> {
  touchProgress({
    current_site_id: profile.siteId,
    current_monument_name: profile.monumentName,
    current_query: null,
  });

  const alreadyApproved = loadApprovedImages().filter((i) => i.site_id === profile.siteId);
  if (alreadyApproved.length >= targetCount) {
    touchProgress({
      last_message: `${profile.monumentName}: already meets target (${alreadyApproved.length}/${targetCount} verified).`,
    });
    return;
  }

  const candidatePool = new Map<string, WikimediaCandidate>();

  // First include any existing clean pending_review candidates already cached in queue for resumability
  for (const existing of loadReviewQueue()) {
    if (existing.site_id === profile.siteId && existing.approval_status === 'pending_review') {
      candidatePool.set(existing.candidate_id, existing);
    }
  }

  const processedUrls = new Set(
    loadApprovedImages().map((a) => a.source_page_url)
  );
  const queueHistory = loadReviewQueue();
  const previouslyHandledIds = new Set(
    queueHistory
      .filter((c) => c.approval_status === 'approved' || c.approval_status === 'rejected')
      .map((c) => c.candidate_id)
  );

  const neededRemaining = () => {
    const current = loadApprovedImages().filter((i) => i.site_id === profile.siteId).length;
    return Math.max(0, targetCount - current);
  };

  const ingestPool = async () => {
    const workQueue = Array.from(candidatePool.values());
    let nextIdx = 0;
    const WORKER_COUNT = 5;

    async function runWorker() {
      while (true) {
        if (pauseRequested || neededRemaining() <= 0) return;
        const idx = nextIdx;
        if (idx >= workQueue.length) return;
        nextIdx += 1;

        const cand = workQueue[idx];
        if (previouslyHandledIds.has(cand.candidate_id)) continue;
        if (cand.source_page_url && processedUrls.has(cand.source_page_url)) {
          touchProgress({ duplicates_skipped: progress.duplicates_skipped + 1 });
          previouslyHandledIds.add(cand.candidate_id);
          continue;
        }

        if (cand.approval_status === 'review_required') {
          touchProgress({ flagged_review_required: progress.flagged_review_required + 1 });
          previouslyHandledIds.add(cand.candidate_id);
          continue;
        }

        if (cand.approval_status !== 'pending_review') continue;
        previouslyHandledIds.add(cand.candidate_id);

        const existingForSite = loadApprovedImages().filter((i) => i.site_id === profile.siteId);
        if (existingForSite.length >= targetCount) return;

        const split = selectBalancedSplitForCandidate({
          siteId: profile.siteId,
          commonsTitle: cand.commons_title,
          existingForSite,
          targetTotal: targetCount,
        });

        try {
          await commitCandidateToDataset({
            candidate: cand,
            targetSplit: split,
            deferSummary: true,
          });
          if (cand.source_page_url) processedUrls.add(cand.source_page_url);
          touchProgress({
            images_downloaded: progress.images_downloaded + 1,
            last_message: `Verified & saved ${profile.monumentName} (${Math.min(existingForSite.length + 1, targetCount)}/${targetCount})`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Candidate ingestion failed';
          if (/duplicate|already exists|near-identical/i.test(msg)) {
            touchProgress({ duplicates_skipped: progress.duplicates_skipped + 1 });
            markQueueCandidateRejected(cand.candidate_id, msg);
            appendRejectedRecords([
              {
                candidate_id: cand.candidate_id,
                site_id: cand.site_id,
                monument_folder: cand.monument_folder,
                monument_name: cand.monument_name,
                commons_title: cand.commons_title,
                source_page_url: cand.source_page_url,
                direct_image_url: cand.download_url ?? cand.original_source_url,
                licence: cand.licence,
                image_width: cand.image_width,
                image_height: cand.image_height,
                rejection_stage: 'duplicate_guard',
                rejection_reason: msg,
                rejected_at: new Date().toISOString(),
              },
            ]);
          } else if (/HTTP|Network|fetch|abort|timeout/i.test(msg)) {
            touchProgress({ download_failures: progress.download_failures + 1 });
          } else {
            touchProgress({ auto_rejected: progress.auto_rejected + 1 });
            markQueueCandidateRejected(cand.candidate_id, msg);
            const rej: RejectedDatasetRecord = {
              candidate_id: cand.candidate_id,
              site_id: cand.site_id,
              monument_folder: cand.monument_folder,
              monument_name: cand.monument_name,
              commons_title: cand.commons_title,
              source_page_url: cand.source_page_url,
              direct_image_url: cand.download_url ?? cand.original_source_url,
              licence: cand.licence,
              image_width: cand.image_width,
              image_height: cand.image_height,
              rejection_stage: 'quality_pipeline',
              rejection_reason: msg,
              rejected_at: new Date().toISOString(),
            };
            appendRejectedRecords([rej]);
          }
        }
        await sleepMs(60);
      }
    }

    await Promise.all(Array.from({ length: WORKER_COUNT }, () => runWorker()));
  };

  // Pass 1: Ingest any already-queued clean candidates first
  await ingestPool();
  if (pauseRequested || neededRemaining() <= 0) return;

  // Pass 2: Category-based retrieval from Wikimedia Commons
  for (const category of profile.categories) {
    if (pauseRequested || neededRemaining() <= 0) break;
    touchProgress({ current_query: category });

    try {
      const fetchCap = Math.min(Math.max(neededRemaining() * 2 + 12, 25), 110);
      const { candidates, autoRejected } = await fetchCategoryMembersPaginated({
        siteId: profile.siteId,
        categoryTitle: category,
        maxResults: fetchCap,
        targetSplit: profile.siteId === 'unknown' ? 'validation' : 'reference',
      });

      mergeCandidatesIntoQueue(candidates);
      appendRejectedRecords(autoRejected);

      const newRevReq = candidates.filter((c) => c.approval_status === 'review_required').length;
      touchProgress({
        candidates_fetched: progress.candidates_fetched + candidates.length,
        auto_rejected: progress.auto_rejected + autoRejected.length,
        flagged_review_required: progress.flagged_review_required + newRevReq,
      });

      for (const c of candidates) {
        if (!previouslyHandledIds.has(c.candidate_id)) {
          candidatePool.set(c.candidate_id, c);
        }
      }

      await ingestPool();
    } catch (err) {
      touchProgress({
        last_message: `Warning querying ${category}: ${err instanceof Error ? err.message : 'failed'}`,
      });
    }
    await sleepMs(160);
  }

  // Pass 3: Keyword & architectural feature search queries if more needed
  for (const query of profile.queries) {
    if (pauseRequested || neededRemaining() <= 0) break;
    touchProgress({ current_query: query });

    try {
      const fetchCap = Math.min(Math.max(neededRemaining() * 2 + 10, 25), 80);
      const { candidates, autoRejected } = await searchWikimediaPaginated({
        siteId: profile.siteId,
        query,
        maxResults: fetchCap,
        targetSplit: profile.siteId === 'unknown' ? 'validation' : 'reference',
      });

      mergeCandidatesIntoQueue(candidates);
      appendRejectedRecords(autoRejected);

      const newRevReq = candidates.filter((c) => c.approval_status === 'review_required').length;
      touchProgress({
        candidates_fetched: progress.candidates_fetched + candidates.length,
        auto_rejected: progress.auto_rejected + autoRejected.length,
        flagged_review_required: progress.flagged_review_required + newRevReq,
      });

      for (const c of candidates) {
        if (!previouslyHandledIds.has(c.candidate_id)) {
          candidatePool.set(c.candidate_id, c);
        }
      }

      await ingestPool();
    } catch (err) {
      touchProgress({
        last_message: `Warning searching "${query}": ${err instanceof Error ? err.message : 'failed'}`,
      });
    }
    await sleepMs(160);
  }

  const finalForSite = loadApprovedImages().filter((i) => i.site_id === profile.siteId);
  console.log(
    `[collector] ${profile.monumentName} (${profile.siteId}): ${finalForSite.length}/${targetCount} verified images on disk`
  );
  await computeAndSaveDatasetSummary(targetCount);
}

async function runCollectionWorker(options: StartCollectionOptions): Promise<void> {
  const targetPerMonument = Math.min(Math.max(options.targetPerMonument ?? DEFAULT_TARGET_PER_MONUMENT, 5), 150);
  const unknownTarget = Math.min(Math.max(options.unknownTarget ?? 40, 10), 120);
  const mode = options.mode ?? 'all_monuments';

  let targets: Array<{ profile: MonumentSearchProfile; target: number }> = [];
  if (mode === 'single_monument' && options.siteId) {
    const found =
      MONUMENT_SEARCH_PROFILES.find((p) => p.siteId === options.siteId) ??
      (options.siteId === 'unknown' ? UNKNOWN_DISTRACTOR_PROFILE : null);
    if (!found) {
      throw new Error(`No search profile configured for site "${options.siteId}".`);
    }
    targets = [
      {
        profile: found,
        target: found.siteId === 'unknown' ? unknownTarget : targetPerMonument,
      },
    ];
  } else if (mode === 'unknown_only') {
    targets = [{ profile: UNKNOWN_DISTRACTOR_PROFILE, target: unknownTarget }];
  } else {
    targets = [
      ...MONUMENT_SEARCH_PROFILES.map((p) => ({ profile: p, target: targetPerMonument })),
      { profile: UNKNOWN_DISTRACTOR_PROFILE, target: unknownTarget },
    ];
  }

  touchProgress({
    status: 'running',
    mode,
    target_per_monument: targetPerMonument,
    monuments_total: targets.length,
    monuments_completed: 0,
    started_at: progress.started_at ?? new Date().toISOString(),
    last_message: `Starting Wikimedia Commons dataset collection across ${targets.length} class(es)...`,
  });

  try {
    for (let i = 0; i < targets.length; i += 1) {
      if (pauseRequested) {
        await computeAndSaveDatasetSummary(targetPerMonument);
        touchProgress({
          status: 'paused',
          last_message: `Paused after ${i} of ${targets.length} classes (${progress.images_downloaded} new images verified).`,
        });
        return;
      }

      const { profile, target } = targets[i];
      await processMonumentProfile(profile, target);

      touchProgress({
        monuments_completed: i + 1,
      });
    }

    await computeAndSaveDatasetSummary(targetPerMonument);
    touchProgress({
      status: pauseRequested ? 'paused' : 'completed',
      current_site_id: null,
      current_monument_name: null,
      current_query: null,
      last_message: pauseRequested
        ? `Paused collection (${progress.images_downloaded} new images saved).`
        : `Collection finished across ${targets.length} class(es): ${progress.images_downloaded} verified image(s) added.`,
    });
  } catch (err) {
    touchProgress({
      status: 'error',
      last_message: err instanceof Error ? err.message : 'Collection encountered an unexpected error.',
    });
  } finally {
    activePromise = null;
  }
}

export function startCollection(options: StartCollectionOptions = {}): CollectionJobProgress {
  if (progress.status === 'running' && activePromise) {
    return getCollectionProgress();
  }

  pauseRequested = false;
  lastStartParams = {
    mode: options.mode ?? 'all_monuments',
    targetPerMonument: options.targetPerMonument ?? DEFAULT_TARGET_PER_MONUMENT,
    unknownTarget: options.unknownTarget ?? 40,
    siteId: options.siteId,
  };

  progress = {
    status: 'running',
    mode: lastStartParams.mode ?? 'all_monuments',
    target_per_monument: lastStartParams.targetPerMonument ?? DEFAULT_TARGET_PER_MONUMENT,
    monuments_total:
      lastStartParams.mode === 'single_monument' || lastStartParams.mode === 'unknown_only'
        ? 1
        : MONUMENT_SEARCH_PROFILES.length + 1,
    monuments_completed: 0,
    current_site_id: null,
    current_monument_name: null,
    current_query: null,
    candidates_fetched: 0,
    images_downloaded: 0,
    flagged_review_required: 0,
    auto_rejected: 0,
    duplicates_skipped: 0,
    download_failures: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_message: 'Initializing Wikimedia Commons dataset collection...',
  };

  activePromise = runCollectionWorker(lastStartParams);
  return getCollectionProgress();
}

export async function runCollectionBlocking(options: StartCollectionOptions = {}): Promise<CollectionJobProgress> {
  startCollection(options);
  if (activePromise) {
    await activePromise;
  }
  return getCollectionProgress();
}

export function pauseCollection(): CollectionJobProgress {
  if (progress.status === 'running') {
    pauseRequested = true;
    touchProgress({
      last_message: 'Pause requested — finishing current image verification cleanly...',
    });
  }
  return getCollectionProgress();
}

export function resumeCollection(): CollectionJobProgress {
  if (progress.status === 'running' && activePromise) {
    return getCollectionProgress();
  }
  pauseRequested = false;
  progress.started_at = progress.started_at ?? new Date().toISOString();
  activePromise = runCollectionWorker(lastStartParams);
  touchProgress({
    status: 'running',
    last_message: 'Resuming Wikimedia Commons collection from last saved checkpoint...',
  });
  return getCollectionProgress();
}

export async function retryFailedDownloads(): Promise<{
  retried: number;
  succeeded: number;
  remainingFailures: number;
}> {
  const failures = loadDownloadFailures();
  if (failures.length === 0) {
    return { retried: 0, succeeded: 0, remainingFailures: 0 };
  }

  const queue = loadReviewQueue();
  const byId = new Map(queue.map((c) => [c.candidate_id, c]));
  let succeeded = 0;

  for (const fail of failures) {
    const cand = byId.get(fail.candidate_id);
    if (!cand) {
      removeDownloadFailure(fail.candidate_id);
      continue;
    }

    try {
      await commitCandidateToDataset({
        candidate: cand,
        targetSplit: fail.target_split,
        deferSummary: true,
      });
      succeeded += 1;
    } catch {
      // Updated failure timestamp already recorded
    }
    await sleepMs(120);
  }

  await computeAndSaveDatasetSummary(progress.target_per_monument);
  return {
    retried: failures.length,
    succeeded,
    remainingFailures: loadDownloadFailures().length,
  };
}
