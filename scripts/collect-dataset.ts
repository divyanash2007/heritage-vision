import 'dotenv/config';
import { runCollectionBlocking } from '../server/services/collectionManager.ts';
import { computeAndSaveDatasetSummary } from '../server/services/datasetService.ts';

function parseArgs() {
  const args = process.argv.slice(2);
  let target = 50;
  let unknownTarget = 40;
  let siteId: string | undefined;
  let mode: 'all_monuments' | 'single_monument' | 'unknown_only' = 'all_monuments';

  for (const arg of args) {
    if (arg.startsWith('--target=')) {
      target = Number(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--unknown=')) {
      unknownTarget = Number(arg.split('=')[1]) || 40;
    } else if (arg.startsWith('--site=')) {
      siteId = arg.split('=')[1]?.trim();
      if (siteId) mode = siteId === 'unknown' ? 'unknown_only' : 'single_monument';
    }
  }

  return { mode, targetPerMonument: target, unknownTarget, siteId };
}

async function main() {
  const opts = parseArgs();
  console.log(
    `Starting HERITAGE VISION Wikimedia Commons collection (${opts.mode}, target=${opts.targetPerMonument}/monument, unknown=${opts.unknownTarget})...`
  );

  const progress = await runCollectionBlocking(opts);
  const { summary, validation } = await computeAndSaveDatasetSummary(opts.targetPerMonument);

  console.log('\n=== Collection Complete ===');
  console.log(JSON.stringify(progress, null, 2));
  console.log('\n=== Dataset Summary ===');
  console.log(
    JSON.stringify(
      {
        total_approved_images: summary.total_approved_images,
        total_dataset_bytes: summary.total_dataset_bytes,
        monuments_with_reference_images: summary.monuments_with_reference_images,
        monuments_meeting_target: summary.monuments_meeting_target,
        split_counts: summary.split_counts,
        review_queue_counts: summary.review_queue_counts,
        failed_downloads_count: summary.failed_downloads_count,
        quality_valid: validation.is_valid,
        quality_issues: validation.issues.length,
      },
      null,
      2
    )
  );

  process.exit(0);
}

main().catch((err) => {
  console.error('Dataset collection script failed:', err);
  process.exit(1);
});
