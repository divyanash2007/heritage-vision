# Heritage Vision — OpenCLIP Recognition Integration Architecture

**Milestone:** Architecture & API Contract Preparation (Python OpenCLIP Service Pending)  
**Backend Integration Layer:** `server/services/` (`openClipConfig.ts`, `openClipInterfaces.ts`, `openClipStages.ts`, `openClipClient.ts`, `recognitionService.ts`)  
**API Endpoints:** `POST /api/identify`, `GET /api/recognition/status`, `GET /api/health`  
**Frontend Workbench:** `src/lib/api.ts` & `src/pages/IdentifyPage.tsx`

> **Current Status Statement:** OpenCLIP inference is **not yet connected**. When `OPENCLIP_SERVICE_URL` is unset, `POST /api/identify` executes real binary and pixel-decode validation (`LocalImageValidationService`) and returns `recognitionStatus: "pipeline_not_connected"` with `modelConnected: false`, empty `topCandidates: []`, and `predictedSiteId: null`. Zero synthetic scores, random numbers, or fabricated predictions are ever generated.

---

## 1. Architectural Separation

To keep browser code, Node.js orchestration, and PyTorch/OpenCLIP GPU or CPU inference cleanly decoupled:

```text
React Frontend (src/pages/IdentifyPage.tsx & src/lib/api.ts)
   └─ Multipart upload: image + imageFormat + requestId (+ AbortController timeout)
        │
        ▼
Node.js / Express Gateway (server/routes/api.ts -> POST /api/identify)
   └─ Stage 1: LocalImageValidationService (magic bytes + sharp pixel decode + 10 MB cap)
   └─ Configurable HTTP Client (server/services/openClipClient.ts)
        │  [If OPENCLIP_SERVICE_URL is empty -> returns pipeline_not_connected]
        │  [If configured -> POST ${OPENCLIP_SERVICE_URL}${OPENCLIP_IDENTIFY_PATH}]
        ▼
Future Python OpenCLIP Microservice (FastAPI + open_clip_torch + NumPy/FAISS)
   ├─ Stage 2: ImagePreprocessingService (EXIF orient, 224x224 center-crop, CLIP RGB norm)
   ├─ Stage 3: EmbeddingGenerationService (OpenCLIP ViT-B-32 / ViT-L-14 L2-normalized vector)
   ├─ Stage 4: SimilarityMatchingService (Cosine dot product vs reference gallery prototypes)
   ├─ Stage 5: CandidateRankingService (Top-5 ranked cosine similarities + top1 - top2 margin)
   └─ Stage 6: ConfidenceAssessmentService (Threshold tau_unknown & ambiguity delta gates)
```

---

## 2. Separated Service Interfaces (`server/services/openClipInterfaces.ts`)

Each stage of the recognition pipeline is defined behind an explicit TypeScript interface so stages can execute locally in Node.js or remotely over HTTP in Python without coupling UI components:

| Stage | Interface | Current Status in Milestone 1 |
| --- | --- | --- |
| 1. Image Validation | `ImageValidationService` | **Active locally** (`LocalImageValidationService`: byte limits, MIME, magic bytes, `sharp` pixel decode + dimensions) |
| 2. Image Preprocessing | `ImagePreprocessingService` | Interface contract ready for Python OpenCLIP transforms (`open_clip.create_model_and_transforms`) |
| 3. Embedding Generation | `EmbeddingGenerationService` | Interface contract ready for L2-normalized OpenCLIP image tensor encoding |
| 4. Similarity Matching | `SimilarityMatchingService` | Interface contract ready for cosine similarity against `dataset/images/reference/` prototypes |
| 5. Candidate Ranking | `CandidateRankingService` | **Active deterministically** (`LocalCandidateRankingService`: descending cosine sort, top-5 slice, `topTwoScoreMargin`) |
| 6. Confidence Assessment | `ConfidenceAssessmentService` | **Active deterministically** (`LocalConfidenceAssessmentService`: applies calibrated `tau_unknown` and `delta_ambiguity` gates) |

---

## 3. Request & Response API Contracts

### 3.1 Image Recognition Request (`POST /api/identify`)

Accepted as `multipart/form-data` from the frontend or external clients:

| Field / Header | Type | Requirement | Description |
| --- | --- | --- | --- |
| `image` | Binary File (`File`) | **Required** | JPEG, PNG, or WebP photograph (max `10 MB`, `>= 32x32 px`) |
| `imageFormat` | `'jpeg' \| 'png' \| 'webp'` | Optional (derived from MIME if omitted) | Normalized raster format identifier |
| `requestId` / `X-Request-Id` | `string` | Optional (server generates UUID if omitted) | End-to-end correlation ID across browser, Node, and Python logs |

### 3.2 Image Recognition Response Schema (`RecognitionResponse`)

```json
{
  "requestId": "6f8a2b34-1c2d-4f5a-9a1b-123456789abc",
  "recognitionStatus": "pipeline_not_connected",
  "status": "pipeline_not_connected",
  "modelConnected": false,
  "endpointConfigured": false,
  "modelName": null,
  "adapterName": "OpenCLIPAdapter (Pending Python Service)",
  "predictedSiteId": null,
  "predictedMonumentName": null,
  "topCandidates": [],
  "topTwoScoreMargin": null,
  "confidenceCategory": "pipeline_unconfigured",
  "isUnknownOrUncertain": false,
  "unknownReason": null,
  "processingTimeMs": 4,
  "pipelineStages": [
    {
      "stage": "image_validation",
      "label": "Image Validation",
      "status": "completed",
      "detail": "Verified JPEG (1600x1067 px, 342180 bytes)."
    }
  ],
  "imageValidation": {
    "fileName": "sample.jpg",
    "imageFormat": "jpeg",
    "mimeType": "image/jpeg",
    "sizeBytes": 342180,
    "width": 1600,
    "height": 1067,
    "headerVerified": true,
    "pixelDecodeVerified": true,
    "validationError": null
  },
  "explanation": "Image validation and OpenCLIP API request framing succeeded on the Node.js layer. No predictions or similarity scores are returned because OPENCLIP_SERVICE_URL is not configured."
}
```

### 3.3 Candidate Score & Naming Discipline

- Each element in `topCandidates` carries `"scoreType": "cosine_similarity"`.
- Cosine similarities lie in `[-1.0, 1.0]` (typically `[0.10, 0.45]` for CLIP image-to-image/text alignment) and are **never converted into softmax percentages or labelled as probabilities**.

---

## 4. Environment Configuration (`.env`)

Configure the Python service endpoint without code edits via `.env`:

| Variable | Default | Description |
| --- | --- | --- |
| `OPENCLIP_SERVICE_URL` | `""` (unset) | Base HTTP/HTTPS URL of Python service, e.g. `http://127.0.0.1:8001` |
| `OPENCLIP_IDENTIFY_PATH` | `"/v1/recognize"` | POST endpoint path on the Python service |
| `OPENCLIP_HEALTH_PATH` | `"/health"` | GET readiness probe path on the Python service |
| `OPENCLIP_MODEL_NAME` | `"ViT-B-32 (laion2b_s34b_b79k)"` | OpenCLIP model checkpoint label displayed when connected |
| `OPENCLIP_TIMEOUT_MS` | `"15000"` | Request timeout enforced via `AbortController` |
| `OPENCLIP_MIN_SIMILARITY_THRESHOLD` | `"0.28"` | $\tau_{\text{unknown}}$ baseline minimum top-1 cosine similarity gate |
| `OPENCLIP_TOP2_MARGIN_THRESHOLD` | `"0.04"` | $\Delta_{\text{ambiguity}}$ minimum `top1 - top2` similarity separation gate |
| `OPENCLIP_AUTH_TOKEN` | unset | Optional shared Bearer token sent in `Authorization` header |

Inspect live configuration at runtime via `GET /api/recognition/status`.

---

## 5. Error, Timeout, and Unknown-Result Handling

| Condition | HTTP Status (`POST /api/identify`) | `recognitionStatus` | Behavior |
| --- | --- | --- | --- |
| Corrupted header, truncated file, spoofed MIME, or >10 MB | `400` / `413` | `invalid_image` | Blocked at Stage 1 before Python inference; exact decode error returned |
| `OPENCLIP_SERVICE_URL` blank/unset | `200` | `pipeline_not_connected` | Returns validated metadata, zero candidates, no fake scores |
| Python service fails to respond within `OPENCLIP_TIMEOUT_MS` | `504` | `timeout` | `AbortController` aborts HTTP call; frontend allows immediate retry or cancel |
| Python service offline (`ECONNREFUSED`), 5xx, or invalid schema | `502` | `upstream_error` | Transport layer rejects malformed payloads cleanly |
| `top1 < tau_unknown` or `(top1 - top2) < delta_ambiguity` | `200` | `unknown_rejected` | `isUnknownOrUncertain: true`, `predictedSiteId: null`, rejection rationale shown |
| Valid match passing both thresholds | `200` | `identified` | Returns `predictedSiteId`, `predictedMonumentName`, top-5 candidates, and margin |

---

## 6. How to Connect the Future Python OpenCLIP Service

1. **Build the Reference Index from Verified Dataset:**
   - First curate and approve real photographs in `#/dataset` (`dataset/images/reference/` and `dataset/metadata/image_metadata.json`).
   - Run an offline Python script using `open_clip` (e.g., `ViT-B-32`, pretrained `laion2b_s34b_b79k` or `ViT-L-14`) to encode every approved `reference` image, average + L2-normalize class embeddings per `site_id`, and save the index matrix alongside `dataset/images/validation/` & `dataset/images/unknown/` to empirically calibrate $\tau_{\text{unknown}}$ and $\Delta_{\text{ambiguity}}$.
2. **Expose Two FastAPI Endpoints on Python Side (e.g., port `8001`):**
   - `GET /health` returning `{ "ready": true, "modelLoaded": true, "modelName": "ViT-B-32 (laion2b_s34b_b79k)" }`.
   - `POST /v1/recognize` accepting JSON `{ requestId, fileName, imageFormat, mimeType, sizeBytes, width, height, imageBase64, thresholds }` and returning:
     ```json
     {
       "requestId": "...",
       "recognitionStatus": "identified",
       "modelName": "ViT-B-32 (laion2b_s34b_b79k)",
       "predictedSiteId": "taj-mahal",
       "predictedMonumentName": "Taj Mahal",
       "topCandidates": [
         {
           "rank": 1,
           "siteId": "taj-mahal",
           "monumentName": "Taj Mahal",
           "state": "Uttar Pradesh",
           "similarityScore": 0.384211,
           "scoreType": "cosine_similarity"
         }
       ],
       "topTwoScoreMargin": 0.091420
     }
     ```
   - *(Note: `server/services/openClipStages.ts` also independently re-runs `LocalCandidateRankingService` and `LocalConfidenceAssessmentService` on `topCandidates` so unknown-rejection thresholds configured in Node.js `.env` remain consistently enforced.)*
3. **Enable in Environment:**
   - Set `OPENCLIP_SERVICE_URL="http://127.0.0.1:8001"` in `.env` and restart the server.
   - `GET /api/health` and `GET /api/recognition/status` will immediately verify live readiness and switch `openClipConnected` to `true` only once `/health` confirms `ready: true`.
