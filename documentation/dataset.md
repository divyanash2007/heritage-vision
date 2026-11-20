# Heritage Vision — Image Dataset Preparation & Provenance Documentation

**Module:** `dataset/` & Dataset Manager (`#/dataset`)  
**Knowledge Base Scope:** 20 Indian Heritage Monuments (`server/data/monuments.json`) + `unknown` Open-Set Rejection Split  
**Current Dataset Status:** **Incomplete — Initialized & Ready for Human Curation (`0` approved/downloaded photographs)**

---

## 1. Dataset Directory & Metadata Organisation

```text
dataset/
  images/
    reference/          # Approved gallery reference images used to compute monument prototype embeddings
    validation/         # Approved held-out images used to calibrate similarity & margin rejection thresholds
    test/               # Strictly held-out evaluation images (zero overlap or near-duplicates with reference)
    unknown/            # Approved non-monument / negative distractor photographs for unknown-rejection testing
  metadata/
    image_metadata.json # Canonical array of human-approved, downloaded, hash-verified photographs
    image_metadata.csv  # RFC-4180 CSV export synchronized automatically from image_metadata.json
    dataset_summary.json# Real-time counts computed solely from approved files verified on disk
    review_queue.json   # Pending and rejected Wikimedia Commons candidate queue (excluded from dataset)
```

---

## 2. Dataset Sources

- **Sole Automated Candidate Source:** Wikimedia Commons Public MediaWiki API (`https://commons.wikimedia.org/w/api.php`), querying Namespace `6` (`File:`) with `filetype:bitmap`, `prop=imageinfo`, and `iiprop=url|size|mime|sha1|extmetadata`.
- **Excluded Visuals:**
  - AI-generated architectural reference plates (`src/assets/images/monument_*.jpg`) and SVG architectural placeholders (`MonumentPlate.tsx`) are strictly excluded from `dataset/` and never counted as dataset photographs.
  - Arbitrary web scraping is not used.

---

## 3. Collection Methodology & Human-in-the-Loop Approval

1. **Candidate Sourcing (`server/services/wikimediaService.ts`):**
   - Queries Wikimedia Commons by official monument name and city/district across any of the 20 Indian heritage sites (or distractor keywords for the `unknown` split), plus batch sourcing across all 20 sites (`POST /api/dataset/source-all`).
   - Extracts `original_source_url`, `source_page_url`, `creator` (`extmetadata.Artist`), `licence` (`LicenseShortName` / `UsageTerms`), `attribution_text`, `image_width`, `image_height`, `mime_type`, and `wikimedia_sha1`. Absent fields remain `null` and trigger eligibility warnings.
2. **Human Review (`src/pages/DatasetManagerPage.tsx`):**
   - Each candidate displays its visual preview, monument name, photographer, licence, clickable Wikimedia Commons source page link, dimensions, and approval status.
   - **No photograph enters `dataset/images/` or `image_metadata.json` without explicit human approval.**
   - Rejected candidates are recorded in `review_queue.json` (`approval_status: "rejected"`) and are never downloaded.
3. **Verified Download & Registration (`server/services/datasetService.ts`):**
   - On approval, the backend re-validates licence, URLs, and MIME type, downloads the original image bytes from `original_source_url`, verifies full binary decoding, assigns a deterministic filename (`{site_id}_{split}_{pageid}_{hash8}.{ext}`), writes to `dataset/images/{split}/`, and updates `image_metadata.json`, `image_metadata.csv`, and `dataset_summary.json`.

---

## 4. Licensing & Attribution Policy

Every approved photograph must carry an explicit, non-empty open licence recorded from Wikimedia Commons `extmetadata` (e.g., `CC0`, `CC BY 4.0`, `CC BY-SA 4.0`, `CC BY-SA 3.0`, `Public domain`).

- Candidates with `licence === null` or restrictive/non-free tags (`fair use`, `non-free`, `all rights reserved`) are flagged in the Dataset Manager UI and **blocked** from approval (`approveAndDownloadCandidate`).
- All required attribution fields (`creator`, `licence`, `attribution_text`, `source_page_url`, `original_source_url`) are stored per record in both JSON and CSV exports.

---

## 5. Inclusion & Exclusion Criteria

**Inclusion Criteria:**
- Genuine photograph depicting the target monument (`site_id` matches one of the 20 indexed sites) or a genuine non-monument distractor scene (`site_id: "unknown"`, `image_split: "unknown"`).
- Supported raster format: `image/jpeg`, `image/png`, or `image/webp`.
- Valid open-content licence and resolvable `source_page_url` + `original_source_url`.
- Full binary integrity verified via header magic bytes and pixel-stream decode (`sharp`).

**Exclusion Criteria:**
- AI-generated plates, SVG placeholders, illustrations, maps, scans of text/diagrams, or watermarks.
- Candidates missing licence metadata or source URLs.
- Unsupported formats (e.g., TIFF, GIF, PDF, SVG).
- Exact byte duplicates (`sha256_hash`) or visually near-identical re-encodes/crops (`perceptual_dhash` Hamming distance $\le 6$) across dataset splits.

---

## 6. Preprocessing & Integrity Validation (`server/services/datasetValidator.ts`)

Before committing any approved photograph — and during live quality audits (`GET /api/dataset/validate`) — the backend executes:

1. **Magic-Byte & Format Verification:** Confirms JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), or WebP (`RIFF...WEBP`) signatures.
2. **Full Pixel Decode Integrity:** Runs `sharp(buffer, { failOn: 'error' }).stats()` to verify the image is not truncated or corrupted and reads verified `width` and `height` directly from image bytes.
3. **Cryptographic Deduplication (`sha256_hash`):** Blocks identical binary files anywhere in the dataset.
4. **Perceptual Near-Duplicate Prevention (`perceptual_dhash`):** Computes a 64-bit difference hash over an EXIF-oriented `9x8` grayscale downsample and enforces Hamming distance $> 6$ against all existing records, specifically preventing visually identical or re-scaled photographs from appearing in both `reference` and `test` (or `validation`) splits.
5. **Metadata Consistency Checks:** Validates `site_id` against the 20 knowledge-base IDs (plus `"unknown"`), checks URL syntax, checks presence on disk, and ensures `licence` and `download_date` are present.

*(Original verified photographs are preserved unmodified on disk; OpenCLIP inference-time resizing/normalization will be applied downstream without overwriting raw archived dataset files.)*

---

## 7. Dataset Splits

| Split | Directory | Purpose in Recognition Pipeline | Anti-Leakage Rule |
| --- | --- | --- | --- |
| `reference` | `dataset/images/reference/` | Monument gallery prototypes indexed into OpenCLIP | Zero SHA-256 or dHash ($\le 6$) overlap with `validation`/`test` |
| `validation` | `dataset/images/validation/` | Calibrating cosine similarity threshold $\tau_{\text{unknown}}$ and top-2 margin $\Delta$ | Disjoint photographs from `reference` and `test` |
| `test` | `dataset/images/test/` | Unbiased Top-1 / Top-5 accuracy & unknown-rejection evaluation | Strictly isolated from `reference` & `validation` |
| `unknown` | `dataset/images/unknown/` | Negative/out-of-distribution non-monument samples for rejection evaluation | `site_id` strictly `"unknown"` |

---

## 8. Known Limitations

1. **Initial Count (`0` Approved Images):** At module initialization, `0` photographs have been approved or downloaded into `dataset/images/`; human review via `#/dataset` is required before training or calibrating OpenCLIP thresholds.
2. **Wikimedia Metadata Completeness:** Some historical or community uploads omit structured `Artist` or machine-readable `Attribution` tags in `extmetadata`; such fields are stored honestly as `null` for reviewer inspection.
3. **Perceptual Hash Scope:** 64-bit dHash reliably catches identical, resized, and re-compressed duplicates across splits, but photographs of the same facade taken moments apart from a slightly shifted camera angle require human reviewer vigilance when assigning `reference` vs. `test` splits.
4. **Class Imbalance Risk:** Iconic monuments (e.g., Taj Mahal) have far more Wikimedia Commons uploads than regional sites, requiring balanced curator review across all 20 monuments.

---

## 9. Current Verified Dataset Summary

Generated strictly from `dataset/metadata/dataset_summary.json` (reflecting actual downloaded and approved files on disk):

- **Total Approved & Downloaded Images:** `0`
- **Monuments With Reference Images:** `0 / 20`
- **Monuments Missing Reference Images:** `20 / 20`
- **Split Counts:** `reference: 0`, `validation: 0`, `test: 0`, `unknown: 0`
- **Dataset Complete:** `false` (remains `false` until all 20 monuments have verified reference coverage plus validation/test splits passing all quality checks)
