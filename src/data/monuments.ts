import monumentsJson from '../../server/data/monuments.json';
import type {
  ArchitecturalCategory,
  ImageReference,
  ImageType,
  ImageVerificationStatus,
  KnowledgeBaseValidationReport,
  MonumentRecord,
  OpenClipReferenceMeta,
  PreservationInformation,
  SourceReference,
  SourceVerificationStatus,
  UnescoStatus,
  ValidationIssue,
  VerificationStatus,
} from '../types/heritage';

export type {
  ArchitecturalCategory,
  ImageReference,
  ImageType,
  ImageVerificationStatus,
  KnowledgeBaseValidationReport,
  MonumentRecord,
  OpenClipReferenceMeta,
  PreservationInformation,
  SourceReference,
  SourceVerificationStatus,
  UnescoStatus,
  ValidationIssue,
  VerificationStatus,
};

/**
 * Strongly typed Heritage Knowledge Base dataset for all 20 Indian heritage sites.
 * Loaded from the canonical JSON knowledge base with verified UNESCO sources
 * and explicit null + verification flags wherever authoritative verification is pending.
 */
export const HERITAGE_MONUMENTS_SCHEMA: readonly MonumentRecord[] =
  monumentsJson as MonumentRecord[];

export const MONUMENT_SCHEMA_COUNT = HERITAGE_MONUMENTS_SCHEMA.length;
