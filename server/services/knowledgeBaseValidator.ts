import type {
  ImageType,
  ImageVerificationStatus,
  KnowledgeBaseValidationReport,
  MonumentRecord,
  SourceVerificationStatus,
  UnescoStatus,
  ValidationIssue,
} from '../../src/types/heritage.ts';

const VALID_UNESCO_STATUSES = new Set<UnescoStatus>([
  'world_heritage_site',
  'tentative_list',
  'not_listed',
  'unverified',
]);

const VALID_IMAGE_TYPES = new Set<ImageType>([
  'ai_generated_reference_plate',
  'illustrative_placeholder',
  'verified_dataset_photograph',
]);

const VALID_IMAGE_VERIFICATION = new Set<ImageVerificationStatus>([
  'unverified_synthetic',
  'placeholder_no_media',
  'verified_dataset_photo',
]);

const VALID_SOURCE_STATUSES = new Set<SourceVerificationStatus>(['verified', 'unverified']);

export function isValidHttpUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  if (/\s/.test(rawUrl.trim())) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      Boolean(parsed.hostname) &&
      parsed.hostname.includes('.')
    );
  } catch {
    return false;
  }
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

/**
 * Runs structural, source-verification, and image-provenance validation across all monument records:
 * 1. Duplicate site IDs
 * 2. Missing monument names
 * 3. Invalid source URLs and missing source verification metadata
 * 4. Missing mandatory fields
 * 5. Invalid UNESCO status values
 * 6. Missing VERIFIED citations for factual descriptions
 * 7. Image metadata schema & separation of synthetic/placeholder assets from verified dataset photos
 */
export function validateKnowledgeBase(
  records: MonumentRecord[]
): KnowledgeBaseValidationReport {
  const issues: ValidationIssue[] = [];
  const seenIds = new Map<string, number>();
  const invalidRecordIndices = new Set<number>();

  let totalSourcesChecked = 0;
  let verifiedSourcesCount = 0;
  let unverifiedSourcesCount = 0;
  let genuineImageReferencesCount = 0;
  let generatedOrPlaceholderImagesCount = 0;
  let recordsRequiringVerification = 0;

  records.forEach((record, index) => {
    const siteId = isNonEmptyString(record.id) ? record.id.trim() : null;

    // 1. Duplicate and missing site IDs
    if (!siteId) {
      invalidRecordIndices.add(index);
      issues.push({
        siteId: null,
        recordIndex: index,
        check: 'missing_mandatory_field',
        field: 'id',
        message: `Record at index ${index} is missing a unique site ID.`,
      });
    } else {
      const normalizedId = siteId.toLowerCase();
      if (seenIds.has(normalizedId)) {
        invalidRecordIndices.add(index);
        issues.push({
          siteId,
          recordIndex: index,
          check: 'duplicate_site_id',
          field: 'id',
          message: `Duplicate site ID "${siteId}" (first seen at index ${seenIds.get(normalizedId)}).`,
        });
      } else {
        seenIds.set(normalizedId, index);
      }
    }

    // 2. Missing monument name
    if (!isNonEmptyString(record.name)) {
      invalidRecordIndices.add(index);
      issues.push({
        siteId,
        recordIndex: index,
        check: 'missing_monument_name',
        field: 'name',
        message: `Record "${siteId ?? index}" is missing an official monument name.`,
      });
    }

    // 4. Missing mandatory fields
    const mandatoryStringFields: Array<keyof MonumentRecord> = [
      'accessionCode',
      'country',
      'state',
      'cityOrDistrict',
      'category',
    ];
    for (const fieldName of mandatoryStringFields) {
      if (!isNonEmptyString(record[fieldName])) {
        invalidRecordIndices.add(index);
        issues.push({
          siteId,
          recordIndex: index,
          check: 'missing_mandatory_field',
          field: String(fieldName),
          message: `Record "${siteId ?? index}" is missing mandatory field "${String(fieldName)}".`,
        });
      }
    }

    if (!Array.isArray(record.alternativeNames)) {
      invalidRecordIndices.add(index);
      issues.push({
        siteId,
        recordIndex: index,
        check: 'missing_mandatory_field',
        field: 'alternativeNames',
        message: `Record "${siteId ?? index}" must define an alternativeNames array.`,
      });
    }

    if (!Array.isArray(record.imageReferences)) {
      invalidRecordIndices.add(index);
      issues.push({
        siteId,
        recordIndex: index,
        check: 'missing_mandatory_field',
        field: 'imageReferences',
        message: `Record "${siteId ?? index}" must define an imageReferences array.`,
      });
    }

    if (!Array.isArray(record.sourceReferences)) {
      invalidRecordIndices.add(index);
      issues.push({
        siteId,
        recordIndex: index,
        check: 'missing_mandatory_field',
        field: 'sourceReferences',
        message: `Record "${siteId ?? index}" must define a sourceReferences array.`,
      });
    }

    if (!record.preservationInformation || typeof record.preservationInformation !== 'object') {
      invalidRecordIndices.add(index);
      issues.push({
        siteId,
        recordIndex: index,
        check: 'missing_mandatory_field',
        field: 'preservationInformation',
        message: `Record "${siteId ?? index}" is missing preservationInformation object.`,
      });
    }

    // 5. Invalid UNESCO status values
    if (!VALID_UNESCO_STATUSES.has(record.unescoStatus)) {
      invalidRecordIndices.add(index);
      issues.push({
        siteId,
        recordIndex: index,
        check: 'invalid_unesco_status',
        field: 'unescoStatus',
        message: `Record "${siteId ?? index}" has invalid UNESCO status "${String(record.unescoStatus)}".`,
      });
    }

    // 3. Source tracking & URL verification
    const sources = Array.isArray(record.sourceReferences) ? record.sourceReferences : [];
    let verifiedSourceCountForRecord = 0;

    sources.forEach((src, srcIdx) => {
      totalSourcesChecked += 1;

      if (!isValidHttpUrl(src.url)) {
        invalidRecordIndices.add(index);
        issues.push({
          siteId,
          recordIndex: index,
          check: 'invalid_source_url',
          field: `sourceReferences[${srcIdx}].url`,
          message: `Record "${siteId ?? index}" has invalid source URL "${src.url}".`,
        });
      }

      if (src.apiVerificationUrl && !isValidHttpUrl(src.apiVerificationUrl)) {
        invalidRecordIndices.add(index);
        issues.push({
          siteId,
          recordIndex: index,
          check: 'invalid_source_url',
          field: `sourceReferences[${srcIdx}].apiVerificationUrl`,
          message: `Record "${siteId ?? index}" has invalid apiVerificationUrl "${src.apiVerificationUrl}".`,
        });
      }

      if (
        !isNonEmptyString(src.sourceTitle) ||
        !isNonEmptyString(src.publisher) ||
        !isNonEmptyString(src.accessDate) ||
        !VALID_SOURCE_STATUSES.has(src.verificationStatus) ||
        typeof src.authoritativeSource !== 'boolean'
      ) {
        invalidRecordIndices.add(index);
        issues.push({
          siteId,
          recordIndex: index,
          check: 'invalid_source_record',
          field: `sourceReferences[${srcIdx}]`,
          message: `Source reference #${srcIdx + 1} for "${siteId ?? index}" is missing required tracking metadata.`,
        });
      } else if (src.verificationStatus === 'verified') {
        if (!Array.isArray(src.supportedInformation) || src.supportedInformation.length === 0) {
          invalidRecordIndices.add(index);
          issues.push({
            siteId,
            recordIndex: index,
            check: 'invalid_source_record',
            field: `sourceReferences[${srcIdx}].supportedInformation`,
            message: `Verified source #${srcIdx + 1} for "${siteId ?? index}" must list supportedInformation.`,
          });
        } else if (isValidHttpUrl(src.url)) {
          verifiedSourceCountForRecord += 1;
          verifiedSourcesCount += 1;
        }
      } else {
        unverifiedSourcesCount += 1;
      }
    });

    // 6. Missing VERIFIED citations for factual descriptions
    const hasFactualContent =
      isNonEmptyString(record.description) ||
      isNonEmptyString(record.historicalPeriod) ||
      isNonEmptyString(record.constructionDateOrPeriod) ||
      isNonEmptyString(record.historicalSignificance) ||
      isNonEmptyString(record.architecturalStyle) ||
      isNonEmptyString(record.preservationInformation?.statusSummary);

    if (hasFactualContent && verifiedSourceCountForRecord === 0) {
      invalidRecordIndices.add(index);
      issues.push({
        siteId,
        recordIndex: index,
        check: 'missing_citation_for_factual_description',
        field: 'sourceReferences',
        message: `Record "${siteId ?? index}" includes factual historical or architectural text without a verified authoritative source citation.`,
      });
    }

    // 7. Image metadata schema validation & provenance separation
    const images = Array.isArray(record.imageReferences) ? record.imageReferences : [];
    images.forEach((img, imgIdx) => {
      if (
        !isNonEmptyString(img.image_id) ||
        !isNonEmptyString(img.site_id) ||
        (siteId && img.site_id !== siteId) ||
        !VALID_IMAGE_TYPES.has(img.image_type) ||
        !VALID_IMAGE_VERIFICATION.has(img.verification_status) ||
        typeof img.is_recognition_dataset_image !== 'boolean'
      ) {
        invalidRecordIndices.add(index);
        issues.push({
          siteId,
          recordIndex: index,
          check: 'invalid_image_metadata',
          field: `imageReferences[${imgIdx}]`,
          message: `Image reference #${imgIdx + 1} for "${siteId ?? index}" failed schema or site_id consistency checks.`,
        });
      } else if (
        img.image_type === 'verified_dataset_photograph' &&
        img.verification_status === 'verified_dataset_photo' &&
        img.is_recognition_dataset_image
      ) {
        if (!isNonEmptyString(img.source_url) || !isNonEmptyString(img.licence)) {
          invalidRecordIndices.add(index);
          issues.push({
            siteId,
            recordIndex: index,
            check: 'invalid_image_metadata',
            field: `imageReferences[${imgIdx}]`,
            message: `Verified dataset photo #${imgIdx + 1} for "${siteId ?? index}" is missing provenance source_url or licence.`,
          });
        } else {
          genuineImageReferencesCount += 1;
        }
      } else {
        if (img.is_recognition_dataset_image) {
          invalidRecordIndices.add(index);
          issues.push({
            siteId,
            recordIndex: index,
            check: 'invalid_image_metadata',
            field: `imageReferences[${imgIdx}].is_recognition_dataset_image`,
            message: `Synthetic or placeholder image #${imgIdx + 1} for "${siteId ?? index}" cannot be flagged as a recognition dataset photograph.`,
          });
        }
        generatedOrPlaceholderImagesCount += 1;
      }
    });

    if (
      record.verificationStatus === 'requires_verification' ||
      (Array.isArray(record.requiresVerificationFields) &&
        record.requiresVerificationFields.length > 0)
    ) {
      recordsRequiringVerification += 1;
    }
  });

  return {
    isValid: issues.length === 0,
    checkedAt: new Date().toISOString(),
    totalRecords: records.length,
    uniqueIdsCount: seenIds.size,
    validRecordsCount: records.length - invalidRecordIndices.size,
    recordsRequiringVerification,
    totalSourcesChecked,
    verifiedSourcesCount,
    unverifiedSourcesCount,
    genuineImageReferencesCount,
    generatedOrPlaceholderImagesCount,
    issues,
  };
}
