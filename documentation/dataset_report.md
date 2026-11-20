# HERITAGE VISION — Heritage Image Dataset Architecture & Curation Report

## 1. Overview & Scientific Principles

HERITAGE VISION's computer vision pipeline pairs a curated, verifiable open-licensed Wikimedia Commons monument image corpus with an `OpenCLIP ViT-B-32` (`laion2b_s34b_b79k`) feature extraction backend.

All data collection and validation follow strict provenance and integrity safeguards:
- **Genuine Photographic Media Only:** Zero AI-generated images, CGI renders, architectural elevation drawings, maps, diagrams, stamps, logos, or stock-watermarked assets.
- **Verifiable Open Licences:** Only Creative Commons (`CC0`, `CC BY`, `CC BY-SA`) and verified Public Domain (`PD`) photographs retrieved directly from the Wikimedia Commons MediaWiki API (`https://commons.wikimedia.org/w/api.php`) are admitted.
- **No Fabricated Metrics or Probabilities:** All similarity matching reports raw cosine similarity rankings across distinct monument classes—never calibrated classification probabilities or fabricated confidence percentages.

---

## 2. Dataset Organization & Splits

```
dataset/
├── Taj_Mahal/
│   ├── reference/          # OpenCLIP ViT-B-32 gallery embeddings (~60% of monument images)
│   ├── validation/         # Held-out validation split for threshold calibration (~20%)
│   └── test/               # Held-out single-pass test evaluation split (~20%)
├── ... (20 monuments)
├── unknown/
│   ├── validation/         # Non-monument distractors for open-set rejection calibration
│   └── test/               # Held-out non-monument distractors for test evaluation
├── dataset_metadata.json   # Complete JSON manifest
├── dataset_manifest.csv    # Full spreadsheet manifest (format, dimensions, hashes, URLs)
├── image_attributions.csv  # Creator, licence, licence URL, attribution ledger
├── split_manifest.csv      # Deterministic split membership index
├── rejected_images.csv     # Automated & human rejection log with exclusion reasons
├── download_failures.csv   # Recoverable HTTP/network failure log for retry workflow
├── dataset_summary.json    # Real-time computed dataset statistics & embedding index status
└── README.md               # Auto-updated summary of disk contents
```

---

## 3. Quality Control, Deduplication & Anti-Leakage Safeguards

1. **Automated Pre-Ingestion Metadata Triage (`classifyCandidateQuality`):**
   - Rejects unsupported MIME types (`SVG`, `GIF`, `TIFF`, `PDF`), restrictive/missing licences, dimensions `< 400×300`, extreme aspect ratios (`> 4.5:1`), monument confusion keywords (e.g. *Bibi Ka Maqbara* excluded from *Taj Mahal*; *Agra Fort* excluded from Delhi *Red Fort*), and graphic/illustration/CGI keywords.
   - Flags uncertain items (`missing_creator`, `< 640×480` moderate resolution, wide panoramics, possible archival prints/watermarks) into `review_required` for human curator inspection rather than silently admitting questionable imagery.
2. **Binary Stream & Pixel Variance Verification (`inspectImageBuffer` / `src/services/datasetValidation.ts`):**
   - Validates JPEG/PNG/WebP magic bytes, parses frame headers and trailing EOI/IEND markers, runs full pixel stream decoding via Sharp (`failOn: 'error'`), and verifies non-blank pixel variance (`stdev >= 10`).
3. **Cryptographic & Perceptual Anti-Leakage (`SHA-256` + 64-bit `dHash`):**
   - Exact SHA-256 deduplication prevents identical image files anywhere in the dataset.
   - 64-bit perceptual difference hashing (`dHash`, Hamming distance threshold `<= 8`) prevents resized, re-encoded, or slightly cropped copies from leaking between `reference`, `validation`, and `test`.
   - Filename base-stem clustering (`extractBaseStem`) assigns related crops/variants from the same camera capture strictly to the same split.

---

## 4. Orchestration, Concurrency & Resumability

- **Client/Isomorphic Orchestrator (`src/services/datasetOrchestrator.ts`):**
  - `executeBatchedWikiRequests`: Executes chunked MediaWiki Commons API batches with configurable concurrency, exponential backoff retries, page ID deduplication, and `AbortSignal` support.
  - `manageConcurrentDownloads`: Manages a bounded concurrent download worker pool (`1..8` workers), timeout cancellation, exponential backoff with jitter on `429`/`5xx`/network failures, binary magic-byte checks, and real-time SHA-256 duplicate blocking.
  - `auditDatasetIntegrity`: Verifies 64-character SHA-256 digests, scans cross-split leakage, and reconciles disk validation reports.
  - `orchestrateDatasetPipeline`: Runs end-to-end batched discovery → concurrent download → SHA-256 validation.
- **Server & CLI Collector (`server/services/collectionManager.ts` & `scripts/collect-dataset.ts`):**
  - Supports **Start / Pause / Resume / Retry Failures** via both Dataset Manager UI and CLI (`npx tsx scripts/collect-dataset.ts --target=50 --unknown=40`).
  - Uses serialized metadata mutex (`withMetadataLock`) around manifest writes so 5 concurrent download workers commit safely without race conditions.

---

## 5. OpenCLIP Embedding & Open-Set Rejection Scripts

- **`python/build_reference_embeddings.py`**:
  - Encodes strictly `reference`-split images with `open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')`, L2-normalizes vectors, stores `embeddings/reference_embeddings.npz` and `embeddings/reference_index.json` separately from raw imagery, skips recomputation via SHA-256 manifest fingerprinting unless `--force` is passed, and aggregates top-5 distinct monument rankings using both `max_cosine_similarity` and `avg_cosine_similarity`.
- **`python/evaluate_unknown_rejection.py`**:
  - Sweeps `(min_similarity, min_margin)` thresholds exclusively on `validation` + `unknown/validation` and evaluates once on held-out `test` + `unknown/test`, writing `embeddings/threshold_calibration_report.json`.
