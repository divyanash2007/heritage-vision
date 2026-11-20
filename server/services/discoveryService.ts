import type { DiscoveryResponse, MonumentRecord } from '../../src/types/heritage.ts';
import { runHeritageAssistantQuery } from './heritageAssistantService.ts';

export interface DiscoveryQueryParams {
  monument?: MonumentRecord | null;
  monumentId?: string | null;
  question: string;
  sessionMonumentIds?: string[];
}

export interface CulturalDiscoveryAdapter {
  answer(params: DiscoveryQueryParams): Promise<DiscoveryResponse>;
}

/**
 * Modular Knowledge-Base-Grounded Cultural Discovery Adapter.
 * Executes deterministic field retrieval over the verified 20-monument
 * knowledge base and UNESCO/ASI source metadata while explicitly refusing
 * to fabricate unverified facts or external RAG passages.
 */
class VerifiedKnowledgeBaseDiscoveryAdapter implements CulturalDiscoveryAdapter {
  async answer(params: DiscoveryQueryParams): Promise<DiscoveryResponse> {
    return runHeritageAssistantQuery({
      monumentId: params.monument?.id ?? params.monumentId ?? 'auto',
      question: params.question,
      sessionMonumentIds: params.sessionMonumentIds,
    });
  }
}

const activeDiscoveryAdapter: CulturalDiscoveryAdapter =
  new VerifiedKnowledgeBaseDiscoveryAdapter();

export async function runGroundedDiscovery(
  paramsOrMonument: MonumentRecord | DiscoveryQueryParams,
  legacyQuestion?: string
): Promise<DiscoveryResponse> {
  if (typeof legacyQuestion === 'string') {
    const monument = paramsOrMonument as MonumentRecord;
    return activeDiscoveryAdapter.answer({
      monument,
      monumentId: monument.id,
      question: legacyQuestion,
    });
  }

  return activeDiscoveryAdapter.answer(paramsOrMonument as DiscoveryQueryParams);
}
