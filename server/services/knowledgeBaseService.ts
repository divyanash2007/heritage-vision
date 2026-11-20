import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  KnowledgeBaseValidationReport,
  MonumentRecord,
  ProjectStatistics,
} from '../../src/types/heritage.ts';
import { validateKnowledgeBase } from './knowledgeBaseValidator.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MONUMENTS_PATH = path.resolve(__dirname, '../data/monuments.json');

let cachedMonuments: MonumentRecord[] | null = null;
let cachedValidation: KnowledgeBaseValidationReport | null = null;

export function loadMonuments(): MonumentRecord[] {
  if (cachedMonuments) {
    return cachedMonuments;
  }
  const raw = fs.readFileSync(MONUMENTS_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as MonumentRecord[];
  cachedMonuments = parsed;
  cachedValidation = validateKnowledgeBase(parsed);

  if (!cachedValidation.isValid) {
    console.warn(
      `[KnowledgeBase] Validation detected ${cachedValidation.issues.length} issue(s):`,
      cachedValidation.issues
    );
  }

  return parsed;
}

export function getKnowledgeBaseValidationReport(): KnowledgeBaseValidationReport {
  if (!cachedValidation) {
    loadMonuments();
  }
  return cachedValidation ?? validateKnowledgeBase(loadMonuments());
}

export interface MonumentQueryFilters {
  search?: string;
  state?: string;
  category?: string;
  unescoStatus?: string;
}

export function queryMonuments(filters: MonumentQueryFilters = {}): {
  monuments: MonumentRecord[];
  availableStates: string[];
  availableCategories: string[];
  availableUnescoStatuses: string[];
} {
  const all = loadMonuments();
  const availableStates = Array.from(new Set(all.map((m) => m.state))).sort();
  const availableCategories = Array.from(new Set(all.map((m) => m.category))).sort();
  const availableUnescoStatuses = Array.from(new Set(all.map((m) => m.unescoStatus))).sort();

  const searchNormalized = filters.search?.trim().toLowerCase() ?? '';
  const stateFilter = filters.state?.trim() ?? '';
  const categoryFilter = filters.category?.trim() ?? '';
  const unescoFilter = filters.unescoStatus?.trim() ?? '';

  const filtered = all.filter((item) => {
    const matchesAltName = item.alternativeNames.some((alt) =>
      alt.toLowerCase().includes(searchNormalized)
    );

    const matchesSearch =
      !searchNormalized ||
      item.name.toLowerCase().includes(searchNormalized) ||
      matchesAltName ||
      item.state.toLowerCase().includes(searchNormalized) ||
      item.cityOrDistrict.toLowerCase().includes(searchNormalized) ||
      item.category.toLowerCase().includes(searchNormalized) ||
      item.accessionCode.toLowerCase().includes(searchNormalized) ||
      item.id.toLowerCase().includes(searchNormalized);

    const matchesState = !stateFilter || stateFilter === 'All' || item.state === stateFilter;
    const matchesCategory =
      !categoryFilter || categoryFilter === 'All' || item.category === categoryFilter;
    const matchesUnesco =
      !unescoFilter || unescoFilter === 'All' || item.unescoStatus === unescoFilter;

    return matchesSearch && matchesState && matchesCategory && matchesUnesco;
  });

  return {
    monuments: filtered,
    availableStates,
    availableCategories,
    availableUnescoStatuses,
  };
}

export function findMonumentById(id: string): MonumentRecord | null {
  const normalizedId = id.trim().toLowerCase();
  if (!normalizedId) return null;
  const all = loadMonuments();
  return all.find((item) => item.id.toLowerCase() === normalizedId) ?? null;
}

export function computeProjectStatistics(): ProjectStatistics {
  const all = loadMonuments();
  const validation = getKnowledgeBaseValidationReport();

  const states = new Set(all.map((m) => m.state));
  const categories = new Set(all.map((m) => m.category));
  const verifiedRecordsCount = all.filter((m) => m.verificationStatus === 'verified').length;
  const partiallyVerifiedRecordsCount = all.filter(
    (m) => m.verificationStatus === 'partially_verified'
  ).length;
  const requiresVerificationRecordsCount = all.filter(
    (m) => m.verificationStatus === 'requires_verification'
  ).length;

  return {
    totalMonumentsInSchema: validation.validRecordsCount,
    statesAndTerritoriesCovered: states.size,
    architecturalCategoriesCount: categories.size,
    verifiedRecordsCount,
    partiallyVerifiedRecordsCount,
    requiresVerificationRecordsCount,
    verifiedSourceCitationsCount: validation.verifiedSourcesCount,
    unverifiedSourceCitationsCount: validation.unverifiedSourcesCount,
    genuineImageReferencesCount: validation.genuineImageReferencesCount,
    generatedOrPlaceholderImagesCount: validation.generatedOrPlaceholderImagesCount,
    validationPassed: validation.isValid,
    openClipModelConnected: false,
    qaRetrieverConnected: true,
  };
}
