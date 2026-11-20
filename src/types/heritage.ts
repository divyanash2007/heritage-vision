export type VerificationStatus = 'verified' | 'partially_verified' | 'requires_verification';

export type SourceVerificationStatus = 'verified' | 'unverified';

export type UnescoStatus =
  | 'world_heritage_site'
  | 'tentative_list'
  | 'not_listed'
  | 'unverified';

export type ArchitecturalCategory =
  | 'Mughal & Indo-Islamic'
  | 'Rock-Cut Caves'
  | 'Temple Architecture'
  | 'Forts & Palaces'
  | 'Stepwells & Water Architecture'
  | 'Civic & Colonial Landmarks'
  | 'Astronomical Observatories'
  | 'Buddhist Monuments';

export type ImageType =
  | 'ai_generated_reference_plate'
  | 'illustrative_placeholder'
  | 'verified_dataset_photograph';

export type ImageVerificationStatus =
  | 'unverified_synthetic'
  | 'placeholder_no_media'
  | 'verified_dataset_photo';

export interface ImageReference {
  image_id: string;
  site_id: string;
  filename: string | null;
  source_url: string | null;
  creator: string | null;
  licence: string | null;
  attribution: string | null;
  image_type: ImageType;
  verification_status: ImageVerificationStatus;
  is_recognition_dataset_image: boolean;
  caption: string;
}

export interface SourceReference {
  id: string;
  sourceTitle: string;
  publisher: string;
  url: string;
  apiVerificationUrl?: string | null;
  accessDate: string;
  verificationStatus: SourceVerificationStatus;
  authoritativeSource: boolean;
  verificationNote: string;
  supportedInformation: string[];
}

export interface PreservationInformation {
  custodian: string | null;
  statusSummary: string | null;
  requiresVerification: boolean;
}

export interface OpenClipReferenceMeta {
  classLabel: string;
  promptTemplateReady: boolean;
  referenceEmbeddingsIndexed: number;
}

export interface MonumentRecord {
  id: string;
  accessionCode: string;
  name: string;
  alternativeNames: string[];
  country: string;
  state: string;
  cityOrDistrict: string;
  category: ArchitecturalCategory;
  historicalPeriod: string | null;
  constructionDateOrPeriod: string | null;
  historicalSignificance: string | null;
  architecturalStyle: string | null;
  unescoStatus: UnescoStatus;
  unescoInscriptionYear: number | null;
  preservationInformation: PreservationInformation;
  description: string | null;
  imageReferences: ImageReference[];
  sourceReferences: SourceReference[];
  verificationStatus: VerificationStatus;
  requiresVerificationFields: string[];
  hasGeneratedPlate: boolean;
  openClipReference: OpenClipReferenceMeta;
}

export interface ValidationIssue {
  siteId: string | null;
  recordIndex: number;
  check:
    | 'duplicate_site_id'
    | 'missing_monument_name'
    | 'invalid_source_url'
    | 'missing_mandatory_field'
    | 'invalid_unesco_status'
    | 'missing_citation_for_factual_description'
    | 'invalid_source_record'
    | 'invalid_image_metadata';
  field: string;
  message: string;
}

export interface KnowledgeBaseValidationReport {
  isValid: boolean;
  checkedAt: string;
  totalRecords: number;
  uniqueIdsCount: number;
  validRecordsCount: number;
  recordsRequiringVerification: number;
  totalSourcesChecked: number;
  verifiedSourcesCount: number;
  unverifiedSourcesCount: number;
  genuineImageReferencesCount: number;
  generatedOrPlaceholderImagesCount: number;
  issues: ValidationIssue[];
}

export interface ProjectStatistics {
  totalMonumentsInSchema: number;
  statesAndTerritoriesCovered: number;
  architecturalCategoriesCount: number;
  verifiedRecordsCount: number;
  partiallyVerifiedRecordsCount: number;
  requiresVerificationRecordsCount: number;
  verifiedSourceCitationsCount: number;
  unverifiedSourceCitationsCount: number;
  genuineImageReferencesCount: number;
  generatedOrPlaceholderImagesCount: number;
  validationPassed: boolean;
  openClipModelConnected: boolean;
  qaRetrieverConnected: boolean;
}

export type SupportedImageFormat = 'jpeg' | 'png' | 'webp';

export type RecognitionStatus =
  | 'identified'
  | 'unknown_rejected'
  | 'pipeline_not_connected'
  | 'invalid_image'
  | 'upstream_error'
  | 'timeout';

export type ConfidenceCategory =
  | 'high_confidence'
  | 'moderate_confidence'
  | 'low_confidence_uncertain'
  | 'unknown_rejected'
  | 'pipeline_unconfigured'
  | 'error';

export type RecognitionPipelineStageName =
  | 'image_validation'
  | 'image_preprocessing'
  | 'embedding_generation'
  | 'similarity_matching'
  | 'candidate_ranking'
  | 'confidence_assessment';

export type PipelineStageStatus = 'completed' | 'skipped' | 'awaiting_service' | 'failed';

export interface PipelineStageReport {
  stage: RecognitionPipelineStageName;
  label: string;
  status: PipelineStageStatus;
  detail: string;
}

export interface RecognitionRequestContract {
  requestId: string;
  imageFormat: SupportedImageFormat;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  submittedAt: string;
}

export interface CandidateMatch {
  rank: number;
  siteId: string;
  monumentId: string;
  monumentName: string;
  state: string;
  similarityScore: number | null;
  scoreType: 'cosine_similarity';
}

export interface RecognitionResponse {
  requestId: string;
  recognitionStatus: RecognitionStatus;
  status: RecognitionStatus;
  modelConnected: boolean;
  endpointConfigured: boolean;
  modelName: string | null;
  adapterName: string;
  predictedSiteId: string | null;
  predictedMonumentName: string | null;
  topCandidates: CandidateMatch[];
  topTwoScoreMargin: number | null;
  confidenceCategory: ConfidenceCategory;
  isUnknownOrUncertain: boolean;
  unknownReason: string | null;
  processingTimeMs: number;
  pipelineStages: PipelineStageReport[];
  unknownRejectionPolicy: {
    minimumSimilarityThreshold: string;
    marginThreshold: string;
    calibratedThresholds: {
      minSimilarity: number;
      minTop2Margin: number;
    };
    description: string;
  };
  imageValidation: {
    fileName: string;
    imageFormat: SupportedImageFormat | null;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    headerVerified: boolean;
    pixelDecodeVerified: boolean;
    validationError: string | null;
  };
  explanation: string;
}

export interface RecognitionServiceStatus {
  openClipConnected: boolean;
  endpointConfigured: boolean;
  serviceEndpoint: string | null;
  identifyPath: string;
  healthPath: string;
  configuredModelName: string;
  timeoutMs: number;
  thresholds: {
    minSimilarity: number;
    top2Margin: number;
  };
  statusMessage: string;
}

export type AssistantTopic =
  | 'history'
  | 'architecture'
  | 'culture'
  | 'personalities'
  | 'unesco'
  | 'preservation'
  | 'comparison'
  | 'overview';

export interface DiscoveryCitation {
  sourceId: string;
  monumentId: string;
  monumentName: string;
  title: string;
  institution: string;
  excerpt: string;
  url: string;
  apiVerificationUrl?: string | null;
  accessDate: string;
  verificationStatus: SourceVerificationStatus;
}

export interface RetrievedKnowledgeFact {
  monumentId: string;
  monumentName: string;
  fieldLabel: string;
  value: string;
  citationIds: string[];
}

export interface DiscoveryResponse {
  status: 'grounded_answer' | 'partial_grounded' | 'insufficient_evidence';
  monumentId: string;
  monumentName: string;
  matchedMonumentIds: string[];
  matchedMonumentNames: string[];
  detectedTopics: AssistantTopic[];
  question: string;
  answer: string | null;
  answerSections: Array<{
    heading: string;
    content: string;
  }>;
  unverifiedNotices: string[];
  retrievedFacts: RetrievedKnowledgeFact[];
  message: string;
  citations: DiscoveryCitation[];
  evidenceDocumentsChecked: number;
  retrievalMode: 'verified_kb_field_retrieval';
  missingCapabilities: string[];
  pipelineStatus:
    | 'kb_retrieval_active_rag_pending'
    | 'scaffold_awaiting_verified_corpus'
    | 'active';
}

export type DatasetSplit = 'reference' | 'validation' | 'test' | 'unknown';

export type CandidateApprovalStatus =
  | 'pending_review'
  | 'review_required'
  | 'approved'
  | 'rejected';

export interface WikimediaCandidate {
  candidate_id: string;
  site_id: string;
  monument_folder: string;
  monument_name: string;
  monument_category: string;
  search_query: string;
  source_category: string | null;
  commons_page_id: number;
  commons_title: string;
  original_filename: string;
  preview_url: string;
  download_url: string | null;
  original_source_url: string | null;
  source_page_url: string | null;
  creator: string | null;
  licence: string | null;
  licence_url: string | null;
  attribution_text: string | null;
  image_description: string | null;
  image_width: number;
  image_height: number;
  file_size_bytes: number;
  mime_type: string;
  file_format: string;
  wikimedia_sha1: string | null;
  suggested_split: DatasetSplit;
  approval_status: CandidateApprovalStatus;
  eligibility_warnings: string[];
  quality_flags: string[];
  rejection_reason: string | null;
  reviewed_at: string | null;
  fetched_at: string;
}

export interface ApprovedDatasetImage {
  image_id: string;
  site_id: string;
  monument_folder: string;
  monument_name: string;
  monument_category: string;
  filename: string;
  original_filename: string;
  relative_path: string;
  original_source_url: string;
  source_page_url: string;
  source_category: string | null;
  creator: string | null;
  licence: string;
  licence_url: string | null;
  attribution_text: string | null;
  image_description: string | null;
  image_width: number;
  image_height: number;
  image_split: DatasetSplit;
  verification_status: 'approved_verified';
  download_date: string;
  sha256_hash: string;
  perceptual_dhash: string;
  file_size_bytes: number;
  mime_type: string;
  file_format: string;
}

export interface RejectedDatasetRecord {
  candidate_id: string;
  site_id: string;
  monument_folder: string;
  monument_name: string;
  commons_title: string;
  source_page_url: string | null;
  direct_image_url: string | null;
  licence: string | null;
  image_width: number;
  image_height: number;
  rejection_stage: 'metadata_filter' | 'quality_pipeline' | 'duplicate_guard' | 'human_review';
  rejection_reason: string;
  rejected_at: string;
}

export interface DownloadFailureRecord {
  candidate_id: string;
  site_id: string;
  monument_folder: string;
  monument_name: string;
  commons_title: string;
  attempted_url: string;
  target_split: DatasetSplit;
  error_message: string;
  http_status: number | null;
  retry_count: number;
  failed_at: string;
}

export type DatasetValidationCheck =
  | 'broken_download_missing_file'
  | 'duplicate_sha256_hash'
  | 'missing_source_url'
  | 'missing_licence'
  | 'incorrect_site_id'
  | 'unsupported_file_format'
  | 'corrupted_image'
  | 'duplicate_across_splits'
  | 'near_duplicate_across_splits'
  | 'low_resolution_or_aspect'
  | 'missing_mandatory_metadata';

export interface DatasetValidationIssue {
  image_id: string | null;
  filename: string | null;
  check: DatasetValidationCheck;
  message: string;
}

export interface DatasetValidationReport {
  is_valid: boolean;
  checked_at: string;
  total_records: number;
  files_verified_on_disk: number;
  unique_sha256_count: number;
  issues: DatasetValidationIssue[];
}

export interface MonumentDatasetCoverage {
  site_id: string;
  monument_folder: string;
  name: string;
  target_total: number;
  reference: number;
  validation: number;
  test: number;
  total: number;
  pending_review: number;
  review_required: number;
  rejected: number;
  failed: number;
  shortfall: number;
}

export interface EmbeddingIndexStatus {
  generated: boolean;
  model_name: string;
  checkpoint: string;
  generated_at: string | null;
  reference_images_indexed: number;
  monuments_indexed: number;
  embeddings_file_exists: boolean;
  threshold_calibrated: boolean;
  selected_min_similarity: number | null;
  selected_top2_margin: number | null;
  note: string;
}

export interface DatasetSummary {
  generated_at: string;
  dataset_complete: boolean;
  target_per_monument: number;
  target_split_per_monument: {
    reference: number;
    validation: number;
    test: number;
  };
  total_approved_images: number;
  total_dataset_bytes: number;
  monuments_in_schema: number;
  monuments_with_reference_images: number;
  monuments_missing_reference_images: number;
  monuments_meeting_target: number;
  split_counts: Record<DatasetSplit, number>;
  review_queue_counts: {
    pending_review: number;
    review_required: number;
    approved: number;
    rejected: number;
  };
  failed_downloads_count: number;
  duplicate_blocked_count: number;
  licence_breakdown: Record<string, number>;
  quality_status: {
    is_valid: boolean;
    issues_count: number;
  };
  embedding_status: EmbeddingIndexStatus;
  monument_coverage?: MonumentDatasetCoverage[];
  note: string;
}

export type CollectionStatusState = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface CollectionJobProgress {
  status: CollectionStatusState;
  mode: 'all_monuments' | 'single_monument' | 'unknown_only' | 'retry_failures';
  target_per_monument: number;
  monuments_total: number;
  monuments_completed: number;
  current_site_id: string | null;
  current_monument_name: string | null;
  current_query: string | null;
  candidates_fetched: number;
  images_downloaded: number;
  flagged_review_required: number;
  auto_rejected: number;
  duplicates_skipped: number;
  download_failures: number;
  started_at: string | null;
  updated_at: string | null;
  last_message: string | null;
}

export interface PreservationSourceCitation {
  id: string;
  sourceTitle: string;
  publisher: string;
  url: string;
  apiVerificationUrl: string | null;
  accessDate: string;
  verificationStatus: 'verified' | 'unverified';
}

export type PreservationTimeframe = 'current' | 'historical' | 'statutory' | 'unverified';

export interface PreservationFacet {
  value: string | null;
  isVerified: boolean;
  timeframe: PreservationTimeframe;
  unverifiedNote: string | null;
  citationIds: string[];
}

export type ConservationAvailabilityFilter =
  | 'all'
  | 'has_current_condition'
  | 'has_historical_deterioration'
  | 'has_environmental_threats'
  | 'has_structural_challenges'
  | 'has_restoration_initiatives'
  | 'has_detailed_conservation_notes'
  | 'pending_current_condition';

export interface PreservationProfile {
  siteId: string;
  accessionCode: string;
  name: string;
  alternativeNames: string[];
  state: string;
  cityOrDistrict: string;
  country: string;
  category: string;
  historicalPeriod: string | null;
  unescoStatus: UnescoStatus;
  unescoInscriptionYear: number | null;
  unescoSummary: string;
  statutoryProtectionSummary: string | null;
  currentConservationStatus: PreservationFacet;
  historicalDeterioration: PreservationFacet;
  environmentalThreats: PreservationFacet;
  structuralChallenges: PreservationFacet;
  restorationInitiatives: PreservationFacet;
  responsibleOrganisations: PreservationFacet;
  verifiedDetailedFacetCount: number;
  missingDetailedFacets: string[];
  verifiedSources: PreservationSourceCitation[];
  unverifiedSources: PreservationSourceCitation[];
}

export interface PreservationCoverageStats {
  totalMonuments: number;
  withVerifiedCustodian: number;
  withExplicitCurrentCondition: number;
  withHistoricalDeterioration: number;
  withEnvironmentalThreats: number;
  withStructuralChallenges: number;
  withRestorationInitiatives: number;
  withVerifiedUnescoListing: number;
  pendingCurrentConditionInspection: number;
}

export interface PreservationListResponse {
  profiles: PreservationProfile[];
  stats: PreservationCoverageStats;
  availableLocations: string[];
  availableCategories: string[];
  availableUnescoStatuses: UnescoStatus[];
}

