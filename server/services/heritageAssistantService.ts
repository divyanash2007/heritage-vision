import type {
  AssistantTopic,
  DiscoveryCitation,
  DiscoveryResponse,
  MonumentRecord,
  RetrievedKnowledgeFact,
  SourceReference,
} from '../../src/types/heritage.ts';
import { loadMonuments } from './knowledgeBaseService.ts';
import { buildPreservationProfile } from './preservationService.ts';

const MISSING_RAG_CAPABILITIES = [
  'Dense vector RAG over external multi-page ASI excavation volumes and offline PDF archives is not attached; retrieval runs deterministically over the verified 20-site JSON knowledge base, 6-facet preservation profiles, and cited UNESCO/ASI source scopes.',
];

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'between',
  'both',
  'build',
  'built',
  'by',
  'can',
  'compare',
  'comparison',
  'construct',
  'constructed',
  'construction',
  'could',
  'cultural',
  'culture',
  'describe',
  'did',
  'difference',
  'differences',
  'do',
  'does',
  'during',
  'explain',
  'for',
  'from',
  'give',
  'has',
  'have',
  'heritage',
  'history',
  'historical',
  'how',
  'in',
  'india',
  'indian',
  'information',
  'is',
  'it',
  'its',
  'know',
  'list',
  'located',
  'location',
  'made',
  'me',
  'monument',
  'monuments',
  'most',
  'name',
  'of',
  'on',
  'or',
  'overview',
  'period',
  'please',
  'preservation',
  'preserve',
  'preserves',
  'protected',
  'protection',
  'significance',
  'significant',
  'site',
  'sites',
  'style',
  'tell',
  'that',
  'the',
  'their',
  'them',
  'these',
  'they',
  'this',
  'those',
  'to',
  'unesco',
  'used',
  'vs',
  'versus',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'with',
  'world',
  'you',
  'your',
]);

interface MonumentAliasRule {
  monumentId: string;
  phrase: string;
}

function tokenizeNormalized(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function buildMonumentSearchCorpus(m: MonumentRecord): string {
  const preservation = buildPreservationProfile(m);
  const vSrc = getVerifiedSources(m);
  return [
    m.name,
    ...m.alternativeNames,
    m.state,
    m.cityOrDistrict,
    m.category,
    m.historicalPeriod ?? '',
    m.constructionDateOrPeriod ?? '',
    m.description ?? '',
    m.historicalSignificance ?? '',
    m.architecturalStyle ?? '',
    preservation.responsibleOrganisations.value ?? '',
    preservation.statutoryProtectionSummary ?? '',
    preservation.currentConservationStatus.value ?? '',
    preservation.historicalDeterioration.value ?? '',
    preservation.environmentalThreats.value ?? '',
    preservation.structuralChallenges.value ?? '',
    preservation.restorationInitiatives.value ?? '',
    ...vSrc.flatMap((s) => s.supportedInformation),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * IDF-weighted lexical retriever across all verified monument descriptions,
 * architectural styles, personalities, preservation facets, and cited source scopes.
 * Enables grounded discovery even when a user asks by feature, ruler, city, or event
 * without naming the monument explicitly.
 */
function retrieveMonumentsByContentSimilarity(
  question: string,
  allMonuments: MonumentRecord[]
): MonumentRecord[] {
  const queryTokens = Array.from(new Set(tokenizeNormalized(question)));
  if (queryTokens.length === 0) return [];

  const docTokenSets = allMonuments.map((m) => ({
    monument: m,
    tokens: new Set(tokenizeNormalized(buildMonumentSearchCorpus(m))),
    rawLower: buildMonumentSearchCorpus(m).toLowerCase(),
  }));

  const N = docTokenSets.length;
  const dfMap = new Map<string, number>();
  for (const qt of queryTokens) {
    let df = 0;
    for (const doc of docTokenSets) {
      if (doc.tokens.has(qt) || doc.rawLower.includes(qt)) {
        df += 1;
      }
    }
    dfMap.set(qt, df);
  }

  // Filter out tokens that never appear in the verified KB at all
  const inVocabTokens = queryTokens.filter((qt) => (dfMap.get(qt) ?? 0) > 0);
  if (inVocabTokens.length === 0) return [];

  const scored = docTokenSets
    .map((doc) => {
      let score = 0;
      let matchedDistinct = 0;
      for (const qt of inVocabTokens) {
        const df = dfMap.get(qt) ?? 0;
        if (df === 0) continue;
        if (doc.tokens.has(qt) || doc.rawLower.includes(qt)) {
          const idf = Math.log((N + 1) / (df + 0.5)) + 0.5;
          score += idf;
          matchedDistinct += 1;
        }
      }
      return { monument: doc.monument, score, matchedDistinct };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  const top = scored[0];
  const queryCoverage = top.matchedDistinct / queryTokens.length;

  // Guard against out-of-scope proper nouns (e.g., "Eiffel Tower" matching only "tower"):
  // Require at least 2 matching domain tokens when >=2 content tokens exist, plus >= 50% token coverage.
  if (queryTokens.length >= 2) {
    if (top.matchedDistinct < 2 || queryCoverage < 0.5) {
      return [];
    }
  } else if (top.score < 2.2) {
    return [];
  }

  // Return top match, or multiple close matches if it's a multi-monument or comparison phrasing
  const closeThreshold = top.score * 0.85;
  const isPluralIntent = /\b(which monuments|which sites|monuments|compare|all|both)\b/i.test(
    question
  );
  if (isPluralIntent) {
    return scored
      .filter((s) => s.score >= Math.max(1.8, closeThreshold * 0.7) && s.matchedDistinct >= 2)
      .slice(0, 5)
      .map((s) => s.monument);
  }

  return [top.monument];
}

function buildMonumentAliasRules(monuments: MonumentRecord[]): MonumentAliasRule[] {
  const rules: MonumentAliasRule[] = [];
  const customAliases: Record<string, string[]> = {
    'taj-mahal': ['taj mahal', 'taj'],
    'agra-fort': ['red fort of agra', 'agra fort'],
    'fatehpur-sikri': ['fatehpur sikri', 'city of victory', 'sikri'],
    'red-fort': ['red fort complex', 'red fort', 'lal qila'],
    'qutub-minar': ['qutub minar', 'qutb minar', 'qutub', 'qutb'],
    'humayuns-tomb': ["humayun's tomb", 'humayuns tomb', 'humayun tomb', 'humayun'],
    'ajanta-caves': ['ajanta caves', 'ajanta'],
    'ellora-caves': ['ellora caves', 'ellora'],
    'gateway-of-india': ['gateway of india'],
    'sanchi-stupa': ['sanchi stupa', 'great stupa at sanchi', 'sanchi'],
    'khajuraho-temples': ['khajuraho temples', 'khajuraho'],
    hampi: ['hampi', 'vijayanagara', 'vijayanagar'],
    'gol-gumbaz': ['gol gumbaz', 'gol gumbad'],
    'konark-sun-temple': ['konark sun temple', 'sun temple konark', 'konark', 'konarak'],
    mahabalipuram: ['mahabalipuram', 'mamallapuram'],
    'amer-fort': ['amer fort', 'amber fort', 'amer', 'amber palace'],
    'chittorgarh-fort': ['chittorgarh fort', 'chittorgarh', 'chittor fort'],
    charminar: ['charminar'],
    'rani-ki-vav': ['rani ki vav', 'rani-ki-vav', "queen's stepwell"],
    'jantar-mantar-jaipur': ['jantar mantar jaipur', 'jantar mantar'],
  };

  for (const m of monuments) {
    rules.push({ monumentId: m.id, phrase: m.name.toLowerCase() });
    rules.push({ monumentId: m.id, phrase: m.id.replace(/-/g, ' ').toLowerCase() });
    for (const alt of m.alternativeNames) {
      if (alt.trim()) {
        rules.push({ monumentId: m.id, phrase: alt.trim().toLowerCase() });
      }
    }
    const extras = customAliases[m.id] ?? [];
    for (const alias of extras) {
      rules.push({ monumentId: m.id, phrase: alias });
    }
  }

  const seen = new Set<string>();
  return rules
    .filter((r) => {
      const key = `${r.monumentId}::${r.phrase}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.phrase.length - a.phrase.length);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchMonumentsInQuestion(
  question: string,
  monuments: MonumentRecord[]
): MonumentRecord[] {
  const rules = buildMonumentAliasRules(monuments);
  const byId = new Map(monuments.map((m) => [m.id, m]));
  let maskedQuery = question.toLowerCase();
  const matchedEntries: Array<{ id: string; position: number }> = [];

  for (const rule of rules) {
    const pattern = new RegExp(`\\b${escapeRegex(rule.phrase)}\\b`, 'i');
    const match = pattern.exec(maskedQuery);
    if (match) {
      if (!matchedEntries.some((entry) => entry.id === rule.monumentId)) {
        matchedEntries.push({ id: rule.monumentId, position: match.index });
      }
      maskedQuery = maskedQuery.replace(
        new RegExp(`\\b${escapeRegex(rule.phrase)}\\b`, 'gi'),
        (found) => ' '.repeat(found.length)
      );
    }
  }

  matchedEntries.sort((a, b) => a.position - b.position);

  return matchedEntries
    .map((entry) => byId.get(entry.id))
    .filter((m): m is MonumentRecord => Boolean(m));
}

function detectQuestionTopics(
  question: string,
  monumentCount: number,
  monuments: MonumentRecord[] = []
): AssistantTopic[] {
  let q = question.toLowerCase();
  for (const m of monuments) {
    for (const phrase of [m.name, ...m.alternativeNames]) {
      if (phrase.trim()) {
        q = q.replace(new RegExp(`\\b${escapeRegex(phrase.trim().toLowerCase())}\\b`, 'gi'), ' ');
      }
    }
  }

  const topics: AssistantTopic[] = [];

  if (
    monumentCount > 1 ||
    /\b(compare|comparison|difference|differences|versus|vs\.?|contrast|similarities|similarity|between)\b/.test(
      q
    )
  ) {
    topics.push('comparison');
  }
  if (
    /\b(history|historical|historically|background|why|purpose|built|build|construct|constructed|construction|date|when|century|period|era|origin|chronology|founded)\b/.test(
      q
    )
  ) {
    topics.push('history');
  }
  if (
    /\b(architecture|architectural|style|design|material|marble|sandstone|basalt|carving|stupa|observatory|instrument|instruments|stepwell|mausoleum|dome|mosque|pavilion|palace|structure|structures|minaret|whispering gallery|canal|channel|wheels|horses|stucco)\b/.test(
      q
    )
  ) {
    topics.push('architecture');
  }
  if (
    /\b(culture|cultural|culturally|significance|significant|important|importance|masterpiece|heritage|role|influence|religion|religious|buddhist|hindu|jain|islamic|mughal|why)\b/.test(
      q
    )
  ) {
    topics.push('culture');
  }
  if (
    /\b(person|personalities|personality|ruler|rulers|emperor|emperors|king|kings|queen|queens|sultan|patron|patrons|commissioned|founder|builder|dynasty|dynasties|architect)\b/.test(
      q
    ) ||
    /\bwho\s+(built|build|constructed|commissioned|founded|designed|ruled|ordered|erected)\b/.test(
      q
    )
  ) {
    topics.push('personalities');
  }
  if (/\b(unesco|world heritage|inscribed|inscription|listed|list|criterion|criteria)\b/.test(q)) {
    topics.push('unesco');
  }
  if (
    /\b(preserv\w*|conserv\w*|maintain\w*|maintenance|custodian\w*|asi|archaeological survey|protect\w*|amasr|ttz|taj trapezium|management|buffer|threat\w*|challenge\w*|risk\w*|pollut\w*|air quality|quarr\w*|seismic|damag\w*|lightning|deteriorat\w*|restor\w*|repair\w*|condition\w*|aktc|weathering)\b/.test(
      q
    )
  ) {
    topics.push('preservation');
  }

  if (topics.length === 0) {
    topics.push('overview');
  }

  return topics;
}

function detectAnaphoricFollowUp(question: string): boolean {
  return /\b(it|its|this monument|that monument|this site|that site|them|these|those|they|their|compare it|same site|this one|both)\b/i.test(
    question
  );
}

function detectCatalogFilterQuery(
  question: string,
  allMonuments: MonumentRecord[]
): {
  kind: 'unesco_list' | 'state_list' | 'category_list';
  label: string;
  records: MonumentRecord[];
} | null {
  const q = question.toLowerCase();

  if (
    (/\b(which|what|list|all|show)\b.*\b(unesco|world heritage)\b/.test(q) &&
      /\b(monuments|sites|ones|listed)\b/.test(q)) ||
    /\bunesco\b.*\b(monuments|sites)\b/.test(q)
  ) {
    const records = allMonuments.filter((m) => m.unescoStatus === 'world_heritage_site');
    return {
      kind: 'unesco_list',
      label: 'Monuments inscribed as UNESCO World Heritage Sites in the knowledge base',
      records,
    };
  }

  const stateMatches = allMonuments.filter(
    (m) =>
      q.includes(m.state.toLowerCase()) ||
      (m.cityOrDistrict && q.includes(m.cityOrDistrict.toLowerCase()))
  );
  if (stateMatches.length > 0 && /\b(which|what|list|all|monuments|sites|in|located)\b/.test(q)) {
    const matchedRegions = Array.from(new Set(stateMatches.map((m) => m.state)));
    return {
      kind: 'state_list',
      label: `Indexed monuments in ${matchedRegions.join(', ')}`,
      records: stateMatches,
    };
  }

  if (/\b(mughal|rock-cut|cave|caves|stepwell|observatory|buddhist|temple|fort)\b/.test(q)) {
    const isPluralOrFilter = /\b(which|what|list|all|compare|monuments|sites|temples|forts|caves)\b/.test(
      q
    );
    if (isPluralOrFilter) {
      const records = allMonuments.filter(
        (m) =>
          (q.includes('mughal') && m.category === 'Mughal & Indo-Islamic') ||
          ((q.includes('cave') || q.includes('rock-cut')) && m.category === 'Rock-Cut Caves') ||
          (q.includes('temple') && m.category === 'Temple Architecture') ||
          (q.includes('fort') && m.category === 'Forts & Palaces') ||
          (q.includes('stepwell') && m.category === 'Stepwells & Water Architecture') ||
          (q.includes('observatory') && m.category === 'Astronomical Observatories') ||
          (q.includes('buddhist') && m.category === 'Buddhist Monuments')
      );
      if (records.length > 0) {
        return {
          kind: 'category_list',
          label: 'Indexed monuments matching the requested architectural category',
          records,
        };
      }
    }
  }

  return null;
}

function getVerifiedSources(monument: MonumentRecord): SourceReference[] {
  return (Array.isArray(monument.sourceReferences) ? monument.sourceReferences : []).filter(
    (src) => src.verificationStatus === 'verified'
  );
}

function toDiscoveryCitations(monument: MonumentRecord, sources: SourceReference[]): DiscoveryCitation[] {
  return sources.map((src) => ({
    sourceId: src.id,
    monumentId: monument.id,
    monumentName: monument.name,
    title: src.sourceTitle,
    institution: src.publisher,
    excerpt: `Supported scope: ${src.supportedInformation.join('; ')}`,
    url: src.url,
    apiVerificationUrl: src.apiVerificationUrl ?? null,
    accessDate: src.accessDate,
    verificationStatus: src.verificationStatus,
  }));
}

function extractDocumentedPersonalities(monument: MonumentRecord): string[] {
  const corpus = [
    monument.historicalPeriod ?? '',
    monument.constructionDateOrPeriod ?? '',
    monument.description ?? '',
    monument.historicalSignificance ?? '',
    monument.architecturalStyle ?? '',
    monument.preservationInformation.statusSummary ?? '',
    ...getVerifiedSources(monument).flatMap((s) => s.supportedInformation),
  ].join(' ');

  const knownNamedPatterns: Array<{ regex: RegExp; label: string }> = [
    { regex: /\bShah Jahan\b/i, label: 'Mughal Emperor Shah Jahan' },
    { regex: /\bEmperor Akbar\b|\bAkbar\b/i, label: 'Mughal Emperor Akbar' },
    { regex: /\bHumayun\b/i, label: 'Mughal Emperor Humayun' },
    { regex: /\bJahangir\b/i, label: 'Mughal Emperor Jahangir' },
    { regex: /\bAsaf Jah III\b/i, label: 'Asaf Jah III (1824 CE restoration patron)' },
    { regex: /\bMuhammad Adil Shah II\b|\bAdil Shah\b/i, label: 'Sultan Muhammad Adil Shah II (Adil Shahi dynasty)' },
    { regex: /\bMohammad Quli Qutub Shah\b|\bQuli Qutub Shah\b|\bQuli Qutb Shah\b/i, label: 'Sultan Mohammad Quli Qutub Shah (Qutub Shahi dynasty)' },
    { regex: /\bMahatma Gandhi\b/i, label: 'Mahatma Gandhi (historic civic association)' },
    { regex: /\bKing George V\b/i, label: 'King George V (1911 visit commemoration)' },
    { regex: /\bPallava\b/i, label: 'Pallava kings / dynasty' },
    { regex: /\bChandella\b/i, label: 'Chandella dynasty' },
    { regex: /\bVijayanagara\b|\bVijayanagar\b/i, label: 'Kingdom of Vijayanagar rulers' },
    { regex: /\bMughal\b/i, label: 'Mughal Imperial patronage' },
    { regex: /\bRajput\b/i, label: 'Rajput princely states' },
  ];

  const found: string[] = [];
  for (const item of knownNamedPatterns) {
    if (item.regex.test(corpus) && !found.includes(item.label)) {
      found.push(item.label);
    }
  }
  return found;
}

function detectUnverifiedSpecifics(question: string, monuments: MonumentRecord[]): {
  notices: string[];
  onlyUnverifiedRequested: boolean;
} {
  const q = question.toLowerCase();
  const notices: string[] = [];
  const combinedCorpus = monuments
    .map((m) =>
      [
        m.description ?? '',
        m.historicalSignificance ?? '',
        m.architecturalStyle ?? '',
        m.historicalPeriod ?? '',
        m.constructionDateOrPeriod ?? '',
        m.preservationInformation.custodian ?? '',
        m.preservationInformation.statusSummary ?? '',
      ].join(' ')
    )
    .join(' ')
    .toLowerCase();

  let asksVisitorLogistics = false;
  if (
    /\b(ticket|entry fee|price|cost|opening hours|timings|open today|close|closed|hotel|nearby|distance from|airport|railway|bus|weather)\b/.test(
      q
    )
  ) {
    asksVisitorLogistics = true;
    notices.push(
      'Visitor logistics (entry fees, opening timings, travel routes, and local weather) are not stored in the Heritage Vision historical knowledge base and cannot be verified here.'
    );
  }

  let asksUndocumentedMeasurement = false;
  if (
    /\b(how tall|height in|exact height|how high|meters tall|feet tall|weight|how many steps|how many rooms|cost of building|workers|laborers)\b/.test(
      q
    )
  ) {
    const hasDimensionInCorpus = /\b(\d+(?:\.\d+)?\s*(m|km|sq km|sq m|feet|ft|metres|meters))\b/i.test(
      combinedCorpus
    );
    if (
      !hasDimensionInCorpus ||
      /\b(workers|laborers|cost of building|how many rooms|how many steps)\b/.test(q)
    ) {
      asksUndocumentedMeasurement = true;
      notices.push(
        'Specific structural dimensions, workforce numbers, or construction expenditure details not present in the verified UNESCO/ASI summary records could not be verified.'
      );
    }
  }

  let asksUndocumentedArchitect = false;
  if (/\b(chief architect|calligrapher|master architect|named architect|mason|sculptor name)\b/.test(q)) {
    const mentionsArchitect = /\b(architect|designed by)\b/i.test(combinedCorpus);
    if (!mentionsArchitect) {
      asksUndocumentedArchitect = true;
      notices.push(
        'Named individual architects, master artisans, or calligraphers are not recorded for the matched monument(s) in the current verified knowledge-base schema.'
      );
    }
  }

  const hasSubstantiveKbTopic =
    /\b(history|historical|background|period|era|architecture|architectural|style|culture|cultural|significance|unesco|world heritage|preserv\w*|conserv\w*|custodian\w*|threat\w*|challenge\w*|risk\w*|restor\w*|damag\w*|compare|comparison|overview|tell me about|explain|what is|who commissioned|who built|why)\b/.test(
      q
    ) && !asksVisitorLogistics;

  const onlyUnverifiedRequested =
    (asksVisitorLogistics ||
      (asksUndocumentedMeasurement && !hasSubstantiveKbTopic) ||
      (asksUndocumentedArchitect && !hasSubstantiveKbTopic)) &&
    notices.length > 0;

  return { notices, onlyUnverifiedRequested };
}

function formatUnescoFact(m: MonumentRecord): { text: string; isVerified: boolean } {
  switch (m.unescoStatus) {
    case 'world_heritage_site':
      return {
        text: m.unescoInscriptionYear
          ? `Inscribed as a UNESCO World Heritage Site (${m.unescoInscriptionYear}).`
          : 'Inscribed as a UNESCO World Heritage Site (exact year not recorded in field).',
        isVerified: true,
      };
    case 'tentative_list':
      return {
        text: 'Listed on the UNESCO World Heritage Tentative List.',
        isVerified: true,
      };
    case 'not_listed':
      return {
        text: 'Not inscribed on the UNESCO World Heritage List.',
        isVerified: true,
      };
    case 'unverified':
    default:
      return {
        text: 'UNESCO World Heritage status is currently marked as "unverified" in the knowledge base and requires verification.',
        isVerified: false,
      };
  }
}

function answerForSingleMonument(
  monument: MonumentRecord,
  question: string,
  topics: AssistantTopic[]
): DiscoveryResponse {
  const verifiedSources = getVerifiedSources(monument);
  const citations = toDiscoveryCitations(monument, verifiedSources);

  if (verifiedSources.length === 0) {
    return {
      status: 'insufficient_evidence',
      monumentId: monument.id,
      monumentName: monument.name,
      matchedMonumentIds: [monument.id],
      matchedMonumentNames: [monument.name],
      detectedTopics: topics,
      question,
      answer: null,
      answerSections: [],
      unverifiedNotices: [
        `No verified authoritative sources are currently attached to "${monument.name}" (${monument.accessionCode}).`,
      ],
      retrievedFacts: [],
      message: `Insufficient verified evidence for "${monument.name}". Grounded responses require at least one verified primary citation.`,
      citations: [],
      evidenceDocumentsChecked: 0,
      retrievalMode: 'verified_kb_field_retrieval',
      missingCapabilities: MISSING_RAG_CAPABILITIES,
      pipelineStatus: 'kb_retrieval_active_rag_pending',
    };
  }

  const { notices: unverifiedNotices, onlyUnverifiedRequested } = detectUnverifiedSpecifics(
    question,
    [monument]
  );

  if (onlyUnverifiedRequested) {
    return {
      status: 'insufficient_evidence',
      monumentId: monument.id,
      monumentName: monument.name,
      matchedMonumentIds: [monument.id],
      matchedMonumentNames: [monument.name],
      detectedTopics: topics,
      question,
      answer: null,
      answerSections: [],
      unverifiedNotices,
      retrievedFacts: [],
      message: `The requested details for "${monument.name}" could not be verified in the indexed Heritage Vision knowledge base.`,
      citations,
      evidenceDocumentsChecked: verifiedSources.length,
      retrievalMode: 'verified_kb_field_retrieval',
      missingCapabilities: MISSING_RAG_CAPABILITIES,
      pipelineStatus: 'kb_retrieval_active_rag_pending',
    };
  }

  const citationIds = verifiedSources.map((s) => s.id);
  const answerSections: Array<{ heading: string; content: string }> = [];
  const retrievedFacts: RetrievedKnowledgeFact[] = [];

  if (topics.includes('overview') || topics.includes('history')) {
    const datePart = monument.constructionDateOrPeriod
      ? `Construction date/period: ${monument.constructionDateOrPeriod}.`
      : 'Construction date/period: currently stored as null (requires further authoritative date verification).';

    if (
      monument.constructionDateOrPeriod === null &&
      /\b(date|when|year|century|built|constructed)\b/i.test(question)
    ) {
      unverifiedNotices.push(
        `The exact construction date/period field for ${monument.name} is currently null in the knowledge base and awaits primary-source verification.`
      );
    }

    const parts = [
      `${monument.name} (${monument.accessionCode}) is located in ${monument.cityOrDistrict}, ${monument.state}, ${monument.country}.`,
      monument.historicalPeriod ? `Historical period: ${monument.historicalPeriod}.` : null,
      datePart,
      monument.description,
    ].filter(Boolean);

    answerSections.push({
      heading: 'Historical Background & Purpose',
      content: parts.join(' '),
    });
    retrievedFacts.push({
      monumentId: monument.id,
      monumentName: monument.name,
      fieldLabel: 'Historical Background & Purpose',
      value: parts.join(' '),
      citationIds,
    });
  }

  if (topics.includes('architecture')) {
    const parts = [
      `Category: ${monument.category}.`,
      monument.architecturalStyle
        ? `Documented architectural style: ${monument.architecturalStyle}.`
        : 'Architectural style field requires verification (null).',
      !topics.includes('history') && !topics.includes('overview') ? monument.description : null,
    ].filter(Boolean);

    answerSections.push({
      heading: 'Architecture & Construction',
      content: parts.join(' '),
    });
    retrievedFacts.push({
      monumentId: monument.id,
      monumentName: monument.name,
      fieldLabel: 'Architectural Style',
      value: parts.join(' '),
      citationIds,
    });
  }

  if (topics.includes('culture')) {
    if (monument.historicalSignificance) {
      answerSections.push({
        heading: 'Cultural & Historical Significance',
        content: monument.historicalSignificance,
      });
      retrievedFacts.push({
        monumentId: monument.id,
        monumentName: monument.name,
        fieldLabel: 'Cultural & Historical Significance',
        value: monument.historicalSignificance,
        citationIds,
      });
    } else {
      unverifiedNotices.push(
        `Historical significance for ${monument.name} is currently unverified (null) in the knowledge base.`
      );
    }
  }

  if (topics.includes('personalities')) {
    const personalities = extractDocumentedPersonalities(monument);
    if (personalities.length > 0) {
      const contextDetail = [monument.description, monument.historicalSignificance]
        .filter(Boolean)
        .join(' ');
      const content = `Historical rulers, patrons, or dynasties documented for ${monument.name}: ${personalities.join('; ')}.${contextDetail ? ` Verified context: ${contextDetail}` : ''}`;
      answerSections.push({
        heading: 'Documented Historical Personalities & Patronage',
        content,
      });
      retrievedFacts.push({
        monumentId: monument.id,
        monumentName: monument.name,
        fieldLabel: 'Documented Personalities',
        value: content,
        citationIds,
      });
    } else {
      unverifiedNotices.push(
        `No named individual rulers, patrons, or architects are documented in the verified knowledge-base summary for ${monument.name} (historical period recorded as: ${monument.historicalPeriod ?? 'null'}).`
      );
    }
  }

  if (topics.includes('unesco')) {
    const unesco = formatUnescoFact(monument);
    answerSections.push({
      heading: 'UNESCO World Heritage Status',
      content: unesco.text,
    });
    retrievedFacts.push({
      monumentId: monument.id,
      monumentName: monument.name,
      fieldLabel: 'UNESCO Status',
      value: unesco.text,
      citationIds,
    });
    if (!unesco.isVerified) {
      unverifiedNotices.push(unesco.text);
    }
  }

  if (topics.includes('preservation')) {
    const presProfile = buildPreservationProfile(monument);
    const facetLines: string[] = [];

    if (presProfile.responsibleOrganisations.isVerified && presProfile.responsibleOrganisations.value) {
      facetLines.push(`Responsible Custodian: ${presProfile.responsibleOrganisations.value}.`);
    }
    if (presProfile.statutoryProtectionSummary) {
      facetLines.push(`Statutory Protection: ${presProfile.statutoryProtectionSummary}`);
    }
    if (presProfile.currentConservationStatus.isVerified && presProfile.currentConservationStatus.value) {
      facetLines.push(
        `Current Conservation Condition: ${presProfile.currentConservationStatus.value}`
      );
    }
    if (presProfile.environmentalThreats.isVerified && presProfile.environmentalThreats.value) {
      facetLines.push(`Environmental Threats: ${presProfile.environmentalThreats.value}`);
    }
    if (presProfile.structuralChallenges.isVerified && presProfile.structuralChallenges.value) {
      facetLines.push(`Structural Challenges: ${presProfile.structuralChallenges.value}`);
    }
    if (presProfile.historicalDeterioration.isVerified && presProfile.historicalDeterioration.value) {
      facetLines.push(`Historical Deterioration: ${presProfile.historicalDeterioration.value}`);
    }
    if (presProfile.restorationInitiatives.isVerified && presProfile.restorationInitiatives.value) {
      facetLines.push(
        `Restoration & Conservation Initiatives: ${presProfile.restorationInitiatives.value}`
      );
    }

    if (facetLines.length > 0) {
      const content = facetLines.join('\n');
      answerSections.push({
        heading: 'Preservation, Threats & Conservation Status',
        content,
      });
      retrievedFacts.push({
        monumentId: monument.id,
        monumentName: monument.name,
        fieldLabel: 'Preservation & Conservation Profile',
        value: content,
        citationIds,
      });

      if (presProfile.missingDetailedFacets.length > 0) {
        unverifiedNotices.push(
          `For ${monument.name}, the following preservation facets are not verified in the current knowledge base (stored as null): ${presProfile.missingDetailedFacets.join(', ')}.`
        );
      }
    } else {
      unverifiedNotices.push(
        `Preservation and custodian information for ${monument.name} currently requires authoritative ASI verification.`
      );
    }
  }

  const combinedAnswer =
    answerSections.length > 0
      ? answerSections.map((s) => `${s.heading}: ${s.content}`).join('\n\n')
      : null;

  const status =
    answerSections.length === 0
      ? 'insufficient_evidence'
      : unverifiedNotices.length > 0
        ? 'partial_grounded'
        : 'grounded_answer';

  return {
    status,
    monumentId: monument.id,
    monumentName: monument.name,
    matchedMonumentIds: [monument.id],
    matchedMonumentNames: [monument.name],
    detectedTopics: topics,
    question,
    answer: combinedAnswer,
    answerSections,
    unverifiedNotices: Array.from(new Set(unverifiedNotices)),
    retrievedFacts,
    message:
      status === 'grounded_answer'
        ? `Answered strictly from verified knowledge-base fields and ${verifiedSources.length} verified citation(s) for ${monument.name}.`
        : status === 'partial_grounded'
          ? `Provided verified facts from ${monument.name}; see verification notices for fields currently unverified (null).`
          : `Could not verify the requested information in the indexed knowledge base for ${monument.name}.`,
    citations,
    evidenceDocumentsChecked: verifiedSources.length,
    retrievalMode: 'verified_kb_field_retrieval',
    missingCapabilities: MISSING_RAG_CAPABILITIES,
    pipelineStatus: 'kb_retrieval_active_rag_pending',
  };
}

function answerForComparison(
  monuments: MonumentRecord[],
  question: string,
  topics: AssistantTopic[]
): DiscoveryResponse {
  const verifiedMonuments = monuments.filter((m) => getVerifiedSources(m).length > 0);
  if (verifiedMonuments.length === 0) {
    return {
      status: 'insufficient_evidence',
      monumentId: monuments[0].id,
      monumentName: monuments.map((m) => m.name).join(' vs '),
      matchedMonumentIds: monuments.map((m) => m.id),
      matchedMonumentNames: monuments.map((m) => m.name),
      detectedTopics: topics,
      question,
      answer: null,
      answerSections: [],
      unverifiedNotices: [
        'None of the referenced monuments currently have verified authoritative source records.',
      ],
      retrievedFacts: [],
      message: 'Insufficient verified citations to perform a grounded comparison.',
      citations: [],
      evidenceDocumentsChecked: 0,
      retrievalMode: 'verified_kb_field_retrieval',
      missingCapabilities: MISSING_RAG_CAPABILITIES,
      pipelineStatus: 'kb_retrieval_active_rag_pending',
    };
  }

  const { notices: unverifiedNotices } = detectUnverifiedSpecifics(question, verifiedMonuments);
  const allCitations: DiscoveryCitation[] = [];
  const retrievedFacts: RetrievedKnowledgeFact[] = [];
  const answerSections: Array<{ heading: string; content: string }> = [];

  for (const m of verifiedMonuments) {
    const vSrc = getVerifiedSources(m);
    const citationIds = vSrc.map((s) => s.id);
    allCitations.push(...toDiscoveryCitations(m, vSrc));

    const unesco = formatUnescoFact(m);
    if (!unesco.isVerified) {
      unverifiedNotices.push(`${m.name}: ${unesco.text}`);
    }
    if (m.constructionDateOrPeriod === null) {
      unverifiedNotices.push(
        `${m.name}: exact construction date/period is currently stored as null (requires verification).`
      );
    }

    const presProfile = buildPreservationProfile(m);
    if (topics.includes('preservation') && presProfile.missingDetailedFacets.length > 0) {
      unverifiedNotices.push(
        `${m.name}: the following preservation facets are currently unverified (null): ${presProfile.missingDetailedFacets.join(', ')}.`
      );
    }

    const preservationBits = topics.includes('preservation')
      ? [
          presProfile.currentConservationStatus.value
            ? `Current Conservation Status: ${presProfile.currentConservationStatus.value}`
            : null,
          presProfile.historicalDeterioration.value
            ? `Historical Deterioration: ${presProfile.historicalDeterioration.value}`
            : null,
          presProfile.environmentalThreats.value
            ? `Environmental Threats: ${presProfile.environmentalThreats.value}`
            : null,
          presProfile.structuralChallenges.value
            ? `Structural Challenges: ${presProfile.structuralChallenges.value}`
            : null,
          presProfile.restorationInitiatives.value
            ? `Restoration Initiatives: ${presProfile.restorationInitiatives.value}`
            : null,
        ].filter(Boolean)
      : [];

    const summary = [
      `Location: ${m.cityOrDistrict}, ${m.state}.`,
      `Category & Style: ${m.category}${m.architecturalStyle ? ` — ${m.architecturalStyle}` : ''}.`,
      `Period & Date: ${m.historicalPeriod ?? 'Unverified'}${m.constructionDateOrPeriod ? ` (${m.constructionDateOrPeriod})` : ' (construction date requires verification)'}.`,
      `UNESCO: ${unesco.text}`,
      m.preservationInformation.custodian
        ? `Custodian: ${m.preservationInformation.custodian}.`
        : null,
      m.historicalSignificance ? `Significance: ${m.historicalSignificance}` : null,
      ...preservationBits,
    ]
      .filter(Boolean)
      .join(' ');

    answerSections.push({
      heading: `${m.name} (${m.accessionCode})`,
      content: summary,
    });

    retrievedFacts.push({
      monumentId: m.id,
      monumentName: m.name,
      fieldLabel: 'Verified Comparison Profile',
      value: summary,
      citationIds,
    });
  }

  const combinedAnswer = answerSections.map((s) => `${s.heading}: ${s.content}`).join('\n\n');

  return {
    status: unverifiedNotices.length > 0 ? 'partial_grounded' : 'grounded_answer',
    monumentId: verifiedMonuments[0].id,
    monumentName: verifiedMonuments.map((m) => m.name).join(' vs '),
    matchedMonumentIds: verifiedMonuments.map((m) => m.id),
    matchedMonumentNames: verifiedMonuments.map((m) => m.name),
    detectedTopics: topics,
    question,
    answer: combinedAnswer,
    answerSections,
    unverifiedNotices: Array.from(new Set(unverifiedNotices)),
    retrievedFacts,
    message: `Compared ${verifiedMonuments.length} verified monument records with ${allCitations.length} cited primary source(s).`,
    citations: allCitations,
    evidenceDocumentsChecked: allCitations.length,
    retrievalMode: 'verified_kb_field_retrieval',
    missingCapabilities: MISSING_RAG_CAPABILITIES,
    pipelineStatus: 'kb_retrieval_active_rag_pending',
  };
}

export async function runHeritageAssistantQuery(params: {
  question: string;
  monumentId?: string | null;
  sessionMonumentIds?: string[];
}): Promise<DiscoveryResponse> {
  const allMonuments = loadMonuments();
  const byId = new Map(allMonuments.map((m) => [m.id, m]));
  const question = params.question.trim();

  // 1. Explicit monument name/alias matching
  const mentionedInQuery = matchMonumentsInQuestion(question, allMonuments);

  // 2. Pinned monument from UI selector
  const pinnedMonument =
    params.monumentId && params.monumentId !== 'auto'
      ? byId.get(params.monumentId) ?? null
      : null;

  let targetMonuments: MonumentRecord[] = [];
  if (mentionedInQuery.length > 0) {
    targetMonuments = [...mentionedInQuery];
    if (
      pinnedMonument &&
      !targetMonuments.some((m) => m.id === pinnedMonument.id) &&
      /\b(compare|versus|vs\.?|difference|with this|this monument)\b/i.test(question)
    ) {
      targetMonuments.unshift(pinnedMonument);
    }
  } else if (pinnedMonument) {
    targetMonuments = [pinnedMonument];
  } else {
    // 3. Anaphoric follow-up to active session monuments (e.g. "What about its architecture?")
    if (
      detectAnaphoricFollowUp(question) &&
      Array.isArray(params.sessionMonumentIds) &&
      params.sessionMonumentIds.length > 0
    ) {
      targetMonuments = params.sessionMonumentIds
        .map((id) => byId.get(id))
        .filter((m): m is MonumentRecord => Boolean(m));
    }

    // 4. Catalogue-wide filter queries (e.g., UNESCO list, monuments in Rajasthan/Maharashtra, category filters)
    if (targetMonuments.length === 0) {
      const catalogMatch = detectCatalogFilterQuery(question, allMonuments);
      if (catalogMatch) {
        const citations: DiscoveryCitation[] = [];
        const retrievedFacts: RetrievedKnowledgeFact[] = [];
        const lines: string[] = [];

        for (const m of catalogMatch.records) {
          const vSrc = getVerifiedSources(m);
          if (vSrc.length === 0) continue;
          citations.push(...toDiscoveryCitations(m, vSrc));
          const yearInfo =
            m.unescoStatus === 'world_heritage_site' && m.unescoInscriptionYear
              ? ` (UNESCO ${m.unescoInscriptionYear})`
              : '';
          lines.push(`${m.accessionCode} ${m.name} — ${m.cityOrDistrict}, ${m.state}${yearInfo}`);
          retrievedFacts.push({
            monumentId: m.id,
            monumentName: m.name,
            fieldLabel: 'Catalogue Record',
            value: `${m.name} (${m.state}, ${m.category})`,
            citationIds: vSrc.map((s) => s.id),
          });
        }

        const content = `${catalogMatch.label} (${lines.length} verified records):\n• ${lines.join('\n• ')}`;
        return {
          status: 'grounded_answer',
          monumentId: 'catalogue',
          monumentName: 'Verified Heritage Catalogue',
          matchedMonumentIds: catalogMatch.records.map((m) => m.id),
          matchedMonumentNames: catalogMatch.records.map((m) => m.name),
          detectedTopics: detectQuestionTopics(question, catalogMatch.records.length),
          question,
          answer: content,
          answerSections: [{ heading: catalogMatch.label, content }],
          unverifiedNotices: [],
          retrievedFacts,
          message: `Retrieved ${catalogMatch.records.length} matching monument records from the verified 20-site schema.`,
          citations,
          evidenceDocumentsChecked: citations.length,
          retrievalMode: 'verified_kb_field_retrieval',
          missingCapabilities: MISSING_RAG_CAPABILITIES,
          pipelineStatus: 'kb_retrieval_active_rag_pending',
        };
      }
    }

    // 5. IDF-weighted lexical passage retrieval over verified fields (architectural features, rulers, events, threats)
    if (targetMonuments.length === 0) {
      targetMonuments = retrieveMonumentsByContentSimilarity(question, allMonuments);
    }
  }

  // 6. Honest refusal if question falls outside the verified 20-site KB
  if (targetMonuments.length === 0) {
    const availableNames = allMonuments.map((m) => m.name).join(', ');
    return {
      status: 'insufficient_evidence',
      monumentId: 'unmatched',
      monumentName: 'Not Found in Verified Knowledge Base',
      matchedMonumentIds: [],
      matchedMonumentNames: [],
      detectedTopics: detectQuestionTopics(question, 0),
      question,
      answer: null,
      answerSections: [],
      unverifiedNotices: [
        'Your question did not match any verified fact or monument among the 20 Indian heritage sites indexed in the Heritage Vision knowledge base.',
        `Indexed monuments (${allMonuments.length}): ${availableNames}.`,
      ],
      retrievedFacts: [],
      message:
        'Could not verify this query against the Heritage Vision knowledge base because no matching verified monument record exists in the indexed 20-site schema.',
      citations: [],
      evidenceDocumentsChecked: 0,
      retrievalMode: 'verified_kb_field_retrieval',
      missingCapabilities: MISSING_RAG_CAPABILITIES,
      pipelineStatus: 'kb_retrieval_active_rag_pending',
    };
  }

  const topics = detectQuestionTopics(question, targetMonuments.length, targetMonuments);
  if (targetMonuments.length > 1) {
    return answerForComparison(targetMonuments, question, topics);
  }

  return answerForSingleMonument(targetMonuments[0], question, topics);
}
