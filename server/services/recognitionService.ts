import crypto from 'node:crypto';
import type {
  PipelineStageReport,
  RecognitionResponse,
  RecognitionServiceStatus,
  SupportedImageFormat,
} from '../../src/types/heritage.ts';
import { getOpenClipConfig, getPublicRecognitionConfigSummary } from './openClipConfig.ts';
import {
  checkPythonServiceHealth,
  invokePythonOpenClipService,
  OpenClipTransportError,
} from './openClipClient.ts';
import type {
  CandidateRankingService,
  ConfidenceAssessmentService,
  ImageValidationService,
  OpenClipRecognitionAdapter,
  RecognitionImageRequest,
} from './openClipInterfaces.ts';
import {
  buildPendingPipelineStages,
  LocalCandidateRankingService,
  LocalConfidenceAssessmentService,
  LocalImageValidationService,
  resolveSupportedImageFormat,
  verifyImageMagicBytes,
} from './openClipStages.ts';

export { verifyImageMagicBytes, resolveSupportedImageFormat };
export type { RecognitionImageRequest, OpenClipRecognitionAdapter };

export interface UploadedImageInput {
  requestId?: string;
  fileName: string;
  mimeType: string;
  imageFormat?: SupportedImageFormat;
  sizeBytes: number;
  buffer: Buffer;
}

class ConfiguredOpenClipAdapter implements OpenClipRecognitionAdapter {
  public readonly adapterName = 'OpenCLIPAdapter (Pending Integration)';
  private readonly imageValidator: ImageValidationService;
  private readonly candidateRanker: CandidateRankingService;
  private readonly confidenceAssessor: ConfidenceAssessmentService;

  constructor(
    imageValidator: ImageValidationService = new LocalImageValidationService(),
    candidateRanker: CandidateRankingService = new LocalCandidateRankingService(),
    confidenceAssessor: ConfidenceAssessmentService = new LocalConfidenceAssessmentService()
  ) {
    this.imageValidator = imageValidator;
    this.candidateRanker = candidateRanker;
    this.confidenceAssessor = confidenceAssessor;
  }

  async isReady(): Promise<boolean> {
    const config = getOpenClipConfig();
    if (!config.endpointConfigured) return false;
    const health = await checkPythonServiceHealth();
    return health.reachable && health.modelLoaded;
  }

  async identify(request: RecognitionImageRequest): Promise<RecognitionResponse> {
    const startMs = performance.now();
    const config = getOpenClipConfig();

    const validation = await this.imageValidator.validate(request);

    if (!validation.isValid) {
      const elapsedMs = Math.max(1, Math.round(performance.now() - startMs));
      const stages: PipelineStageReport[] = buildPendingPipelineStages(
        false,
        validation.validationError ?? 'Uploaded photograph failed format or decode checks.'
      ).map((item) =>
        item.stage === 'image_validation'
          ? item
          : {
              ...item,
              status: 'skipped',
              detail: 'Skipped because image validation failed.',
            }
      );

      return {
        requestId: request.requestId,
        recognitionStatus: 'invalid_image',
        status: 'invalid_image',
        modelConnected: false,
        endpointConfigured: config.endpointConfigured,
        modelName: null,
        adapterName: this.adapterName,
        predictedSiteId: null,
        predictedMonumentName: null,
        topCandidates: [],
        topTwoScoreMargin: null,
        confidenceCategory: 'error',
        isUnknownOrUncertain: false,
        unknownReason: null,
        processingTimeMs: elapsedMs,
        pipelineStages: stages,
        unknownRejectionPolicy: {
          minimumSimilarityThreshold: `Planned: cosine similarity >= ${config.minSimilarityThreshold.toFixed(2)} (calibrated on validation split)`,
          marginThreshold: `Planned: top1 - top2 margin >= ${config.top2MarginThreshold.toFixed(2)}`,
          calibratedThresholds: {
            minSimilarity: config.minSimilarityThreshold,
            minTop2Margin: config.top2MarginThreshold,
          },
          description:
            'Out-of-distribution rejection thresholds are only applied after valid photographs reach the OpenCLIP encoder.',
        },
        imageValidation: {
          fileName: validation.fileName,
          imageFormat: validation.imageFormat,
          mimeType: validation.mimeType,
          sizeBytes: validation.sizeBytes,
          width: validation.width,
          height: validation.height,
          headerVerified: validation.headerVerified,
          pixelDecodeVerified: validation.pixelDecodeVerified,
          validationError: validation.validationError,
        },
        explanation:
          validation.validationError ??
          'Image validation failed. Please upload a valid, uncorrupted JPEG, PNG, or WebP photograph.',
      };
    }

    const validationDetail = `Verified ${validation.imageFormat?.toUpperCase()} (${validation.width}x${validation.height} px, ${validation.sizeBytes} bytes).`;

    if (!config.endpointConfigured) {
      const elapsedMs = Math.max(1, Math.round(performance.now() - startMs));
      return {
        requestId: request.requestId,
        recognitionStatus: 'pipeline_not_connected',
        status: 'pipeline_not_connected',
        modelConnected: false,
        endpointConfigured: false,
        modelName: null,
        adapterName: 'OpenCLIPAdapter (Pending Python Service)',
        predictedSiteId: null,
        predictedMonumentName: null,
        topCandidates: [],
        topTwoScoreMargin: null,
        confidenceCategory: 'pipeline_unconfigured',
        isUnknownOrUncertain: false,
        unknownReason: null,
        processingTimeMs: elapsedMs,
        pipelineStages: buildPendingPipelineStages(true, validationDetail),
        unknownRejectionPolicy: {
          minimumSimilarityThreshold: `Planned: cosine similarity >= ${config.minSimilarityThreshold.toFixed(2)} (calibrated on validation split)`,
          marginThreshold: `Planned: top1 - top2 margin >= ${config.top2MarginThreshold.toFixed(2)}`,
          calibratedThresholds: {
            minSimilarity: config.minSimilarityThreshold,
            minTop2Margin: config.top2MarginThreshold,
          },
          description:
            'When the Python OpenCLIP microservice is connected, uploads below the minimum cosine similarity threshold or with narrow top-two score margins will be explicitly marked as Unknown / Uncertain.',
        },
        imageValidation: {
          fileName: validation.fileName,
          imageFormat: validation.imageFormat,
          mimeType: validation.mimeType,
          sizeBytes: validation.sizeBytes,
          width: validation.width,
          height: validation.height,
          headerVerified: validation.headerVerified,
          pixelDecodeVerified: validation.pixelDecodeVerified,
          validationError: null,
        },
        explanation:
          'Image validation and OpenCLIP API request framing succeeded on the Node.js layer. No predictions or similarity scores are returned because OPENCLIP_SERVICE_URL is not configured.',
      };
    }

    try {
      const { payload, rawMatches } = await invokePythonOpenClipService(validation);
      const ranking = this.candidateRanker.rankCandidates(rawMatches, 5);
      const assessment = this.confidenceAssessor.assessConfidence(ranking);
      const elapsedMs = Math.max(1, Math.round(performance.now() - startMs));

      const isUnknown = assessment.isUnknownOrUncertain;
      const recognitionStatus = isUnknown ? 'unknown_rejected' : 'identified';
      const resolvedModelName = payload.modelName || config.modelName;

      const stages: PipelineStageReport[] = [
        {
          stage: 'image_validation',
          label: 'Image Validation',
          status: 'completed',
          detail: validationDetail,
        },
        {
          stage: 'image_preprocessing',
          label: 'Image Preprocessing',
          status: 'completed',
          detail: 'Processed by Python OpenCLIP visual transform.',
        },
        {
          stage: 'embedding_generation',
          label: 'Embedding Generation',
          status: 'completed',
          detail: `L2-normalized embedding generated by ${resolvedModelName}.`,
        },
        {
          stage: 'similarity_matching',
          label: 'Similarity Matching',
          status: 'completed',
          detail: `Computed cosine similarity against ${rawMatches.length} monument gallery classes.`,
        },
        {
          stage: 'candidate_ranking',
          label: 'Candidate Ranking',
          status: 'completed',
          detail: `Ranked top ${ranking.topCandidates.length} candidates (top-2 margin: ${ranking.topTwoScoreMargin !== null ? ranking.topTwoScoreMargin.toFixed(4) : 'N/A'}).`,
        },
        {
          stage: 'confidence_assessment',
          label: 'Confidence Assessment',
          status: 'completed',
          detail: isUnknown
            ? assessment.unknownReason ?? 'Rejected by unknown/uncertain threshold policy.'
            : `Assessed as ${assessment.confidenceCategory}.`,
        },
      ];

      return {
        requestId: request.requestId,
        recognitionStatus,
        status: recognitionStatus,
        modelConnected: true,
        endpointConfigured: true,
        modelName: resolvedModelName,
        adapterName: `PythonOpenCLIPHTTPClient (${config.serviceUrl}${config.identifyPath})`,
        predictedSiteId: assessment.predictedSiteId,
        predictedMonumentName: assessment.predictedMonumentName,
        topCandidates: ranking.topCandidates,
        topTwoScoreMargin: ranking.topTwoScoreMargin,
        confidenceCategory: assessment.confidenceCategory,
        isUnknownOrUncertain: isUnknown,
        unknownReason: assessment.unknownReason,
        processingTimeMs: payload.processingTimeMs ?? elapsedMs,
        pipelineStages: stages,
        unknownRejectionPolicy: {
          minimumSimilarityThreshold: `Cosine similarity >= ${config.minSimilarityThreshold.toFixed(2)}`,
          marginThreshold: `Top1 - Top2 margin >= ${config.top2MarginThreshold.toFixed(2)}`,
          calibratedThresholds: {
            minSimilarity: config.minSimilarityThreshold,
            minTop2Margin: config.top2MarginThreshold,
          },
          description:
            'Top candidates are ranked strictly by cosine similarity (not calibrated probabilities) and gated by minimum similarity and top-two score margin thresholds.',
        },
        imageValidation: {
          fileName: validation.fileName,
          imageFormat: validation.imageFormat,
          mimeType: validation.mimeType,
          sizeBytes: validation.sizeBytes,
          width: validation.width,
          height: validation.height,
          headerVerified: validation.headerVerified,
          pixelDecodeVerified: validation.pixelDecodeVerified,
          validationError: null,
        },
        explanation:
          payload.explanation ??
          (isUnknown
            ? assessment.unknownReason ??
              'Image did not meet similarity or ambiguity margin thresholds for confident identification.'
            : `Top cosine similarity match: ${assessment.predictedMonumentName} (cosine similarity ${ranking.topOneSimilarity?.toFixed(4) ?? 'N/A'}).`),
      };
    } catch (error) {
      const elapsedMs = Math.max(1, Math.round(performance.now() - startMs));
      const isTimeout =
        error instanceof OpenClipTransportError && error.kind === 'timeout';
      const status = isTimeout ? 'timeout' : 'upstream_error';
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unexpected error communicating with Python OpenCLIP service.';

      const stages: PipelineStageReport[] = buildPendingPipelineStages(true, validationDetail).map(
        (stage) =>
          stage.stage === 'image_validation'
            ? stage
            : {
                ...stage,
                status: 'failed',
                detail:
                  stage.stage === 'image_preprocessing'
                    ? errorMessage
                    : 'Halted due to Python OpenCLIP service error.',
              }
      );

      return {
        requestId: request.requestId,
        recognitionStatus: status,
        status,
        modelConnected: false,
        endpointConfigured: true,
        modelName: config.modelName,
        adapterName: `PythonOpenCLIPHTTPClient (${config.serviceUrl}${config.identifyPath})`,
        predictedSiteId: null,
        predictedMonumentName: null,
        topCandidates: [],
        topTwoScoreMargin: null,
        confidenceCategory: 'error',
        isUnknownOrUncertain: false,
        unknownReason: null,
        processingTimeMs: elapsedMs,
        pipelineStages: stages,
        unknownRejectionPolicy: {
          minimumSimilarityThreshold: `Cosine similarity >= ${config.minSimilarityThreshold.toFixed(2)}`,
          marginThreshold: `Top1 - Top2 margin >= ${config.top2MarginThreshold.toFixed(2)}`,
          calibratedThresholds: {
            minSimilarity: config.minSimilarityThreshold,
            minTop2Margin: config.top2MarginThreshold,
          },
          description:
            'Upstream model service errors never fall back to synthetic predictions.',
        },
        imageValidation: {
          fileName: validation.fileName,
          imageFormat: validation.imageFormat,
          mimeType: validation.mimeType,
          sizeBytes: validation.sizeBytes,
          width: validation.width,
          height: validation.height,
          headerVerified: validation.headerVerified,
          pixelDecodeVerified: validation.pixelDecodeVerified,
          validationError: null,
        },
        explanation: errorMessage,
      };
    }
  }
}

const activeRecognitionAdapter: OpenClipRecognitionAdapter = new ConfiguredOpenClipAdapter();

export async function runMonumentIdentification(
  input: UploadedImageInput
): Promise<RecognitionResponse> {
  const imageFormat = input.imageFormat ?? resolveSupportedImageFormat(input.mimeType) ?? 'jpeg';
  const request: RecognitionImageRequest = {
    requestId: input.requestId?.trim() || crypto.randomUUID(),
    fileName: input.fileName,
    mimeType: input.mimeType,
    imageFormat,
    sizeBytes: input.sizeBytes,
    buffer: input.buffer,
    submittedAt: new Date().toISOString(),
  };

  return activeRecognitionAdapter.identify(request);
}

export async function getRecognitionServiceStatus(): Promise<RecognitionServiceStatus> {
  const config = getOpenClipConfig();
  if (!config.endpointConfigured) {
    return getPublicRecognitionConfigSummary(false);
  }
  const health = await checkPythonServiceHealth();
  return getPublicRecognitionConfigSummary(health.reachable && health.modelLoaded);
}
