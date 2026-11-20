import sharp from 'sharp';
import type {
  CandidateMatch,
  ConfidenceCategory,
  PipelineStageReport,
  SupportedImageFormat,
} from '../../src/types/heritage.ts';
import type {
  CandidateRankingResult,
  CandidateRankingService,
  ConfidenceAssessmentResult,
  ConfidenceAssessmentService,
  ImageValidationService,
  RawSimilarityMatch,
  RecognitionImageRequest,
  ValidatedImageArtifact,
} from './openClipInterfaces.ts';
import { getOpenClipConfig } from './openClipConfig.ts';

export const MAX_RECOGNITION_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export function resolveSupportedImageFormat(mimeType: string): SupportedImageFormat | null {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

/**
 * Validates binary magic bytes so spoofed file extensions cannot bypass MIME checks.
 */
export function verifyImageMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 12) return false;

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (mimeType === 'image/webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    return riff === 'RIFF' && webp === 'WEBP';
  }

  return false;
}

/**
 * Real local implementation of Stage 1 (Image Validation):
 * enforces size limits, magic bytes, and full pixel decode via sharp.
 */
export class LocalImageValidationService implements ImageValidationService {
  public readonly serviceName = 'LocalImageValidationService (MagicBytes + Sharp)';

  async validate(request: RecognitionImageRequest): Promise<ValidatedImageArtifact> {
    const imageFormat = resolveSupportedImageFormat(request.mimeType);

    if (!request.buffer || request.buffer.length < 12) {
      return {
        requestId: request.requestId,
        fileName: request.fileName,
        imageFormat,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        width: null,
        height: null,
        headerVerified: false,
        pixelDecodeVerified: false,
        isValid: false,
        validationError: 'Uploaded image buffer is empty or truncated.',
        buffer: request.buffer,
      };
    }

    if (request.sizeBytes > MAX_RECOGNITION_UPLOAD_BYTES) {
      return {
        requestId: request.requestId,
        fileName: request.fileName,
        imageFormat,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        width: null,
        height: null,
        headerVerified: false,
        pixelDecodeVerified: false,
        isValid: false,
        validationError: 'Image payload exceeds maximum 10 MB recognition upload limit.',
        buffer: request.buffer,
      };
    }

    if (!imageFormat) {
      return {
        requestId: request.requestId,
        fileName: request.fileName,
        imageFormat: null,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        width: null,
        height: null,
        headerVerified: false,
        pixelDecodeVerified: false,
        isValid: false,
        validationError: `Unsupported image MIME type "${request.mimeType}". Expected JPEG, PNG, or WebP.`,
        buffer: request.buffer,
      };
    }

    const headerVerified = verifyImageMagicBytes(request.buffer, request.mimeType);
    if (!headerVerified) {
      return {
        requestId: request.requestId,
        fileName: request.fileName,
        imageFormat,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        width: null,
        height: null,
        headerVerified: false,
        pixelDecodeVerified: false,
        isValid: false,
        validationError:
          'File signature validation failed: binary header does not match declared JPEG, PNG, or WebP format.',
        buffer: request.buffer,
      };
    }

    try {
      const pipeline = sharp(request.buffer, { failOn: 'error' });
      const metadata = await pipeline.metadata();
      await pipeline.stats();

      const width = metadata.width ?? null;
      const height = metadata.height ?? null;

      if (!width || !height || width < 32 || height < 32) {
        return {
          requestId: request.requestId,
          fileName: request.fileName,
          imageFormat,
          mimeType: request.mimeType,
          sizeBytes: request.sizeBytes,
          width,
          height,
          headerVerified: true,
          pixelDecodeVerified: false,
          isValid: false,
          validationError: `Image resolution (${width ?? 0}x${height ?? 0}) is below minimum 32x32 pixel input requirement.`,
          buffer: request.buffer,
        };
      }

      return {
        requestId: request.requestId,
        fileName: request.fileName,
        imageFormat,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        width,
        height,
        headerVerified: true,
        pixelDecodeVerified: true,
        isValid: true,
        validationError: null,
        buffer: request.buffer,
      };
    } catch (error) {
      return {
        requestId: request.requestId,
        fileName: request.fileName,
        imageFormat,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        width: null,
        height: null,
        headerVerified: true,
        pixelDecodeVerified: false,
        isValid: false,
        validationError:
          error instanceof Error
            ? `Corrupted or unreadable image stream: ${error.message}`
            : 'Image stream failed pixel decode verification.',
        buffer: request.buffer,
      };
    }
  }
}

/**
 * Deterministic Stage 5 implementation: ranks genuine cosine similarity matches
 * returned by the OpenCLIP matching stage and computes top-two score margin.
 */
export class LocalCandidateRankingService implements CandidateRankingService {
  public readonly serviceName = 'LocalCandidateRankingService';

  rankCandidates(matches: RawSimilarityMatch[], topK = 5): CandidateRankingResult {
    if (!matches.length) {
      return {
        topCandidates: [],
        topOneSimilarity: null,
        topTwoScoreMargin: null,
      };
    }

    const sorted = [...matches]
      .filter((item) => Number.isFinite(item.similarityScore))
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, topK);

    const topCandidates: CandidateMatch[] = sorted.map((item, idx) => ({
      rank: idx + 1,
      siteId: item.siteId,
      monumentId: item.siteId,
      monumentName: item.monumentName,
      state: item.state,
      similarityScore: Number(item.similarityScore.toFixed(6)),
      scoreType: 'cosine_similarity',
    }));

    const topOneSimilarity = topCandidates[0]?.similarityScore ?? null;
    const topTwoSimilarity = topCandidates[1]?.similarityScore ?? null;
    const topTwoScoreMargin =
      topOneSimilarity !== null && topTwoSimilarity !== null
        ? Number((topOneSimilarity - topTwoSimilarity).toFixed(6))
        : null;

    return {
      topCandidates,
      topOneSimilarity,
      topTwoScoreMargin,
    };
  }
}

/**
 * Deterministic Stage 6 implementation: applies calibrated minimum similarity
 * and top-2 margin gates to reject out-of-distribution or ambiguous uploads.
 */
export class LocalConfidenceAssessmentService implements ConfidenceAssessmentService {
  public readonly serviceName = 'LocalConfidenceAssessmentService';

  assessConfidence(ranking: CandidateRankingResult): ConfidenceAssessmentResult {
    const config = getOpenClipConfig();
    const top1 = ranking.topCandidates[0] ?? null;
    const top1Score = ranking.topOneSimilarity;
    const margin = ranking.topTwoScoreMargin;

    if (!top1 || top1Score === null) {
      return {
        confidenceCategory: 'unknown_rejected',
        isUnknownOrUncertain: true,
        unknownReason: 'No monument gallery similarities exceeded baseline indexing criteria.',
        predictedSiteId: null,
        predictedMonumentName: null,
      };
    }

    if (top1Score < config.minSimilarityThreshold) {
      return {
        confidenceCategory: 'unknown_rejected',
        isUnknownOrUncertain: true,
        unknownReason: `Top cosine similarity (${top1Score.toFixed(4)}) is below minimum threshold (${config.minSimilarityThreshold.toFixed(2)}).`,
        predictedSiteId: null,
        predictedMonumentName: null,
      };
    }

    if (margin !== null && margin < config.top2MarginThreshold) {
      return {
        confidenceCategory: 'low_confidence_uncertain',
        isUnknownOrUncertain: true,
        unknownReason: `Top-two cosine score margin (${margin.toFixed(4)}) is narrower than ambiguity threshold (${config.top2MarginThreshold.toFixed(2)}).`,
        predictedSiteId: null,
        predictedMonumentName: null,
      };
    }

    let confidenceCategory: ConfidenceCategory = 'moderate_confidence';
    if (top1Score >= config.minSimilarityThreshold + 0.14 && (margin === null || margin >= config.top2MarginThreshold * 2)) {
      confidenceCategory = 'high_confidence';
    }

    return {
      confidenceCategory,
      isUnknownOrUncertain: false,
      unknownReason: null,
      predictedSiteId: top1.siteId,
      predictedMonumentName: top1.monumentName,
    };
  }
}

export function buildPendingPipelineStages(
  validationOk: boolean,
  validationDetail: string
): PipelineStageReport[] {
  return [
    {
      stage: 'image_validation',
      label: 'Image Validation',
      status: validationOk ? 'completed' : 'failed',
      detail: validationDetail,
    },
    {
      stage: 'image_preprocessing',
      label: 'Image Preprocessing',
      status: 'awaiting_service',
      detail: 'Awaiting Python OpenCLIP transform pipeline (resize, center-crop, RGB normalization).',
    },
    {
      stage: 'embedding_generation',
      label: 'Embedding Generation',
      status: 'awaiting_service',
      detail: 'Awaiting Python OpenCLIP ViT image encoder.',
    },
    {
      stage: 'similarity_matching',
      label: 'Similarity Matching',
      status: 'awaiting_service',
      detail: 'Awaiting cosine similarity comparison against approved reference gallery.',
    },
    {
      stage: 'candidate_ranking',
      label: 'Candidate Ranking',
      status: 'awaiting_service',
      detail: 'Top-5 ranking and top-2 margin calculation ready once similarity scores are produced.',
    },
    {
      stage: 'confidence_assessment',
      label: 'Confidence Assessment',
      status: 'awaiting_service',
      detail: 'Unknown/uncertain threshold gating ready once candidate scores are produced.',
    },
  ];
}
