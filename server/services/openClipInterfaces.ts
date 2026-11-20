import type {
  CandidateMatch,
  ConfidenceCategory,
  RecognitionRequestContract,
  RecognitionResponse,
  SupportedImageFormat,
} from '../../src/types/heritage.ts';

export interface RecognitionImageRequest extends RecognitionRequestContract {
  buffer: Buffer;
}

export interface ValidatedImageArtifact {
  requestId: string;
  fileName: string;
  imageFormat: SupportedImageFormat | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  headerVerified: boolean;
  pixelDecodeVerified: boolean;
  isValid: boolean;
  validationError: string | null;
  buffer: Buffer;
}

export interface PreprocessedImageArtifact {
  requestId: string;
  targetResolution: { width: number; height: number };
  colorSpace: 'RGB';
  normalizationMean: [number, number, number];
  normalizationStd: [number, number, number];
  tensorShape: [1, 3, number, number];
}

export interface EmbeddingVectorArtifact {
  requestId: string;
  modelName: string;
  embeddingDim: number;
  l2Normalized: boolean;
  vector: number[];
  inferenceTimeMs: number;
}

export interface RawSimilarityMatch {
  siteId: string;
  monumentName: string;
  state: string;
  similarityScore: number;
  matchedReferenceCount?: number;
}

export interface CandidateRankingResult {
  topCandidates: CandidateMatch[];
  topOneSimilarity: number | null;
  topTwoScoreMargin: number | null;
}

export interface ConfidenceAssessmentResult {
  confidenceCategory: ConfidenceCategory;
  isUnknownOrUncertain: boolean;
  unknownReason: string | null;
  predictedSiteId: string | null;
  predictedMonumentName: string | null;
}

/**
 * Stage 1: Binary format, MIME, byte-limit, and pixel decode validation.
 */
export interface ImageValidationService {
  readonly serviceName: string;
  validate(request: RecognitionImageRequest): Promise<ValidatedImageArtifact>;
}

/**
 * Stage 2: OpenCLIP visual transform (EXIF orientation, resize/center-crop, RGB normalization).
 */
export interface ImagePreprocessingService {
  readonly serviceName: string;
  preprocess(validated: ValidatedImageArtifact): Promise<PreprocessedImageArtifact>;
}

/**
 * Stage 3: Neural forward pass producing L2-normalized image embedding vector.
 */
export interface EmbeddingGenerationService {
  readonly serviceName: string;
  readonly modelName: string;
  generateEmbedding(preprocessed: PreprocessedImageArtifact): Promise<EmbeddingVectorArtifact>;
}

/**
 * Stage 4: Cosine similarity search against indexed monument gallery embeddings.
 */
export interface SimilarityMatchingService {
  readonly serviceName: string;
  matchGallery(embedding: EmbeddingVectorArtifact): Promise<RawSimilarityMatch[]>;
}

/**
 * Stage 5: Deterministic ranking of top-K candidates and top-two similarity margin calculation.
 */
export interface CandidateRankingService {
  readonly serviceName: string;
  rankCandidates(matches: RawSimilarityMatch[], topK?: number): CandidateRankingResult;
}

/**
 * Stage 6: Open-set threshold calibration & unknown/uncertain rejection logic.
 */
export interface ConfidenceAssessmentService {
  readonly serviceName: string;
  assessConfidence(ranking: CandidateRankingResult): ConfidenceAssessmentResult;
}

/**
 * Unified adapter interface for executing the end-to-end recognition pipeline.
 */
export interface OpenClipRecognitionAdapter {
  readonly adapterName: string;
  isReady(): Promise<boolean>;
  identify(request: RecognitionImageRequest): Promise<RecognitionResponse>;
}
