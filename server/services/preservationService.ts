import type {
  ConservationAvailabilityFilter,
  MonumentRecord,
  PreservationCoverageStats,
  PreservationFacet,
  PreservationListResponse,
  PreservationProfile,
  PreservationSourceCitation,
  UnescoStatus,
} from '../../src/types/heritage.ts';
import { findMonumentById, loadMonuments } from './knowledgeBaseService.ts';

interface FacetSeed {
  value: string;
  timeframe: 'current' | 'historical' | 'statutory';
  citationIds: string[];
}

interface SitePreservationFacts {
  currentConservationStatus?: FacetSeed;
  historicalDeterioration?: FacetSeed;
  environmentalThreats?: FacetSeed;
  structuralChallenges?: FacetSeed;
  restorationInitiatives?: FacetSeed;
}

const VERIFIED_SITE_FACETS: Record<string, SitePreservationFacts> = {
  'taj-mahal': {
    environmentalThreats: {
      value:
        'Air pollution risk regulated through an on-site air quality monitoring station and pollution controls across the 10,400 sq km Taj Trapezium Zone (TTZ).',
      timeframe: 'current',
      citationIds: ['src-unesco-252'],
    },
    restorationInitiatives: {
      value:
        'On-site air quality monitoring station, ASI Agra Circle supervision under the AMASR Act (1958/1959/2010), and pollution regulation across the 10,400 sq km Taj Trapezium Zone (TTZ).',
      timeframe: 'current',
      citationIds: ['src-unesco-252'],
    },
  },
  'agra-fort': {
    environmentalThreats: {
      value:
        'Included within the 10,400 sq km Taj Trapezium Zone (TTZ) established for regional air pollution regulation.',
      timeframe: 'current',
      citationIds: ['src-unesco-251', 'src-asi-agra-circle-fort'],
    },
  },
  'fatehpur-sikri': {
    environmentalThreats: {
      value:
        'Subject to pollution-protection rulings across the 10,400 sq km Taj Trapezium Zone (TTZ) in addition to AMASR buffer governance.',
      timeframe: 'current',
      citationIds: ['src-unesco-255'],
    },
  },
  'red-fort': {
    currentConservationStatus: {
      value:
        'Conservation has improved, with continued work noted to stabilize structural condition and manage visitor impact.',
      timeframe: 'current',
      citationIds: ['src-unesco-231'],
    },
    structuralChallenges: {
      value:
        'Continued work is noted to stabilize structural condition and manage visitor impact across the palace fort complex.',
      timeframe: 'current',
      citationIds: ['src-unesco-231'],
    },
  },
  'humayuns-tomb': {
    restorationInitiatives: {
      value:
        'Conserved by the Archaeological Survey of India in partnership with the Aga Khan Trust for Culture (AKTC) since 1997, including enclosed garden waterworks restoration (1997–2003) and tomb conservation works (since 2007).',
      timeframe: 'current',
      citationIds: ['src-unesco-232'],
    },
  },
  'ajanta-caves': {
    environmentalThreats: {
      value:
        'Visitor pressure on the cave complex and surrounding forest buffer areas are co-managed with the Forest Department and Government of Maharashtra.',
      timeframe: 'current',
      citationIds: ['src-unesco-242'],
    },
    structuralChallenges: {
      value:
        'Rock stability and visitor pressure are specifically addressed under an active Comprehensive Conservation Management Plan.',
      timeframe: 'current',
      citationIds: ['src-unesco-242'],
    },
    restorationInitiatives: {
      value:
        'Active Comprehensive Conservation Management Plan alongside 100 m prohibited and 200 m regulated AMASR Act buffer controls.',
      timeframe: 'current',
      citationIds: ['src-unesco-242'],
    },
  },
  'ellora-caves': {
    structuralChallenges: {
      value:
        'Detailed condition survey of all basalt rock-cut caves forms part of an active Comprehensive Conservation Management Plan.',
      timeframe: 'current',
      citationIds: ['src-unesco-243'],
    },
    restorationInitiatives: {
      value:
        'Comprehensive Conservation Management Plan incorporating a detailed condition survey of all caves and joint ASI/Forest Department/Government of Maharashtra buffer management.',
      timeframe: 'current',
      citationIds: ['src-unesco-243'],
    },
  },
  'sanchi-stupa': {
    historicalDeterioration: {
      value:
        'UNESCO inscription documentation notes the hilltop Buddhist monuments (monolithic pillars, palaces, temples, and monasteries) as standing in varying states of conservation.',
      timeframe: 'historical',
      citationIds: ['src-unesco-524'],
    },
    structuralChallenges: {
      value:
        'Hilltop monument group documented across multiple structures in varying states of conservation.',
      timeframe: 'historical',
      citationIds: ['src-unesco-524'],
    },
  },
  hampi: {
    historicalDeterioration: {
      value:
        'Conquered by the Deccan Muslim confederacy in 1565 CE and pillaged prior to abandonment as the Vijayanagara capital.',
      timeframe: 'historical',
      citationIds: ['src-unesco-241'],
    },
  },
  'konark-sun-temple': {
    environmentalThreats: {
      value:
        'Situated on the shores of the Bay of Bengal; site planning incorporates dedicated environment and environmental development plans alongside coastal forest protection.',
      timeframe: 'current',
      citationIds: ['src-unesco-246'],
    },
    restorationInitiatives: {
      value:
        'All conservation programmes are undertaken by the Archaeological Survey of India across five management plans covering safety, environment, master planning, environmental development, and tourism.',
      timeframe: 'current',
      citationIds: ['src-unesco-246'],
    },
  },
  mahabalipuram: {
    currentConservationStatus: {
      value:
        'Maintained in a good state of conservation through continuous buffer-zone monitoring under a regular Archaeological Survey of India conservation schedule.',
      timeframe: 'current',
      citationIds: ['src-unesco-249'],
    },
    restorationInitiatives: {
      value:
        'Continuous monitoring of 100 m prohibited and 200 m regulated zones under a regular Archaeological Survey of India conservation schedule.',
      timeframe: 'current',
      citationIds: ['src-unesco-249'],
    },
  },
  'chittorgarh-fort': {
    environmentalThreats: {
      value:
        'UNESCO notes surrounding quarry activity, industrial air pollution, and urban pressures requiring strict buffer-zone planning.',
      timeframe: 'current',
      citationIds: ['src-unesco-247-chittor'],
    },
  },
  charminar: {
    historicalDeterioration: {
      value:
        'Historically experienced lightning damage to the south-western minaret and surface lime-plaster aging prior to complete re-plastering in 1824 CE.',
      timeframe: 'historical',
      citationIds: ['src-asi-hyderabad-charminar'],
    },
    structuralChallenges: {
      value:
        'Recorded structural and fabric repairs cover rebuilding the south-western minaret after lightning damage, complete lime re-plastering, and maintaining the 1889 facade clocks.',
      timeframe: 'historical',
      citationIds: ['src-asi-hyderabad-charminar'],
    },
    restorationInitiatives: {
      value:
        'Documented restorations in ASI Hyderabad Circle records include rebuilding the south-western minaret after lightning damage, complete lime re-plastering in 1824 CE under Asaf Jah III, and 1962 repair of the 1889 facade clocks.',
      timeframe: 'historical',
      citationIds: ['src-asi-hyderabad-charminar'],
    },
  },
  'rani-ki-vav': {
    environmentalThreats: {
      value:
        'UNESCO advises enhanced seismic risk preparedness for the subterranean stepwell site.',
      timeframe: 'current',
      citationIds: ['src-unesco-922'],
    },
    restorationInitiatives: {
      value:
        'Active Archaeological Survey of India management plan (commenced 2013) administered by a Superintending Archaeologist and on-site team within a 100 m non-development zone.',
      timeframe: 'current',
      citationIds: ['src-unesco-922'],
    },
  },
  'jantar-mantar-jaipur': {
    environmentalThreats: {
      value:
        'UNESCO identifies tourism growth and nearby urban and traffic upgrades as key buffer-zone threats requiring Master Plan integration.',
      timeframe: 'current',
      citationIds: ['src-unesco-1338'],
    },
  },
};

function makeUnverifiedFacet(note: string): PreservationFacet {
  return {
    value: null,
    isVerified: false,
    timeframe: 'unverified',
    unverifiedNote: note,
    citationIds: [],
  };
}

function makeVerifiedFacet(seed: FacetSeed, validSourceIds: Set<string>): PreservationFacet {
  const validCitations = seed.citationIds.filter((id) => validSourceIds.has(id));
  return {
    value: seed.value,
    isVerified: true,
    timeframe: seed.timeframe,
    unverifiedNote: null,
    citationIds: validCitations,
  };
}

function formatUnescoSummary(monument: MonumentRecord): string {
  switch (monument.unescoStatus) {
    case 'world_heritage_site':
      return monument.unescoInscriptionYear
        ? `Inscribed as a UNESCO World Heritage Site (${monument.unescoInscriptionYear}).`
        : 'Inscribed as a UNESCO World Heritage Site.';
    case 'tentative_list':
      return 'Listed on the UNESCO World Heritage Tentative List.';
    case 'not_listed':
      return 'Not inscribed on the UNESCO World Heritage List (protected under Indian state heritage legislation).';
    case 'unverified':
    default:
      return 'UNESCO World Heritage or Tentative List status is currently marked as unverified (null) in the knowledge base pending direct primary-source verification.';
  }
}

export function buildPreservationProfile(monument: MonumentRecord): PreservationProfile {
  const verifiedSources: PreservationSourceCitation[] = monument.sourceReferences
    .filter((src) => src.verificationStatus === 'verified')
    .map((src) => ({
      id: src.id,
      sourceTitle: src.sourceTitle,
      publisher: src.publisher,
      url: src.url,
      apiVerificationUrl: src.apiVerificationUrl ?? null,
      accessDate: src.accessDate,
      verificationStatus: 'verified',
    }));

  const unverifiedSources: PreservationSourceCitation[] = monument.sourceReferences
    .filter((src) => src.verificationStatus !== 'verified')
    .map((src) => ({
      id: src.id,
      sourceTitle: src.sourceTitle,
      publisher: src.publisher,
      url: src.url,
      apiVerificationUrl: src.apiVerificationUrl ?? null,
      accessDate: src.accessDate,
      verificationStatus: 'unverified',
    }));

  const verifiedIds = new Set(verifiedSources.map((s) => s.id));
  const verifiedCitationList = Array.from(verifiedIds);
  const siteFacets = VERIFIED_SITE_FACETS[monument.id] ?? {};

  const currentConservationStatus = siteFacets.currentConservationStatus
    ? makeVerifiedFacet(siteFacets.currentConservationStatus, verifiedIds)
    : makeUnverifiedFacet(
        'Current physical conservation condition has not been verified from a live inspection or State of Conservation report in the knowledge base. Statutory custodian and legal protection details remain documented separately.'
      );

  const historicalDeterioration = siteFacets.historicalDeterioration
    ? makeVerifiedFacet(siteFacets.historicalDeterioration, verifiedIds)
    : makeUnverifiedFacet(
        'No verified record of historical deterioration events is indexed for this monument in the current knowledge base.'
      );

  const environmentalThreats = siteFacets.environmentalThreats
    ? makeVerifiedFacet(siteFacets.environmentalThreats, verifiedIds)
    : makeUnverifiedFacet(
        'Specific environmental threat assessments have not been verified for this monument in the current knowledge base.'
      );

  const structuralChallenges = siteFacets.structuralChallenges
    ? makeVerifiedFacet(siteFacets.structuralChallenges, verifiedIds)
    : makeUnverifiedFacet(
        'Specific structural preservation challenges have not been verified in the current knowledge base.'
      );

  const restorationInitiatives = siteFacets.restorationInitiatives
    ? makeVerifiedFacet(siteFacets.restorationInitiatives, verifiedIds)
    : makeUnverifiedFacet(
        'Named restoration or conservation project timelines have not been verified beyond statutory custodian protection in the current knowledge base.'
      );

  const custodianText = monument.preservationInformation.custodian;
  const responsibleOrganisations: PreservationFacet =
    custodianText && !monument.preservationInformation.requiresVerification
      ? {
          value: custodianText,
          isVerified: true,
          timeframe: 'statutory',
          unverifiedNote: null,
          citationIds: verifiedCitationList,
        }
      : makeUnverifiedFacet(
          'Responsible conservation custodian requires verification from primary ASI or State Archaeology records.'
        );

  const facetEntries: Array<[string, PreservationFacet]> = [
    ['Current Conservation Status', currentConservationStatus],
    ['Historical Deterioration', historicalDeterioration],
    ['Environmental Threats', environmentalThreats],
    ['Structural Challenges', structuralChallenges],
    ['Restoration & Conservation Initiatives', restorationInitiatives],
    ['Responsible Heritage Organisations', responsibleOrganisations],
  ];

  const verifiedDetailedFacetCount = facetEntries.filter(([, facet]) => facet.isVerified).length;
  const missingDetailedFacets = facetEntries
    .filter(([, facet]) => !facet.isVerified)
    .map(([label]) => label);

  return {
    siteId: monument.id,
    accessionCode: monument.accessionCode,
    name: monument.name,
    alternativeNames: monument.alternativeNames,
    state: monument.state,
    cityOrDistrict: monument.cityOrDistrict,
    country: monument.country,
    category: monument.category,
    historicalPeriod: monument.historicalPeriod,
    unescoStatus: monument.unescoStatus,
    unescoInscriptionYear: monument.unescoInscriptionYear,
    unescoSummary: formatUnescoSummary(monument),
    statutoryProtectionSummary: monument.preservationInformation.statusSummary,
    currentConservationStatus,
    historicalDeterioration,
    environmentalThreats,
    structuralChallenges,
    restorationInitiatives,
    responsibleOrganisations,
    verifiedDetailedFacetCount,
    missingDetailedFacets,
    verifiedSources,
    unverifiedSources,
  };
}

export function getPreservationProfileById(id: string): PreservationProfile | null {
  const monument = findMonumentById(id);
  if (!monument) return null;
  return buildPreservationProfile(monument);
}

export interface PreservationQueryFilters {
  search?: string;
  location?: string;
  category?: string;
  unescoStatus?: string;
  conservationFilter?: ConservationAvailabilityFilter;
}

function matchesConservationAvailability(
  profile: PreservationProfile,
  filter: ConservationAvailabilityFilter
): boolean {
  switch (filter) {
    case 'has_current_condition':
      return profile.currentConservationStatus.isVerified;
    case 'has_historical_deterioration':
      return profile.historicalDeterioration.isVerified;
    case 'has_environmental_threats':
      return profile.environmentalThreats.isVerified;
    case 'has_structural_challenges':
      return profile.structuralChallenges.isVerified;
    case 'has_restoration_initiatives':
      return profile.restorationInitiatives.isVerified;
    case 'has_detailed_conservation_notes':
      return profile.verifiedDetailedFacetCount >= 2;
    case 'pending_current_condition':
      return !profile.currentConservationStatus.isVerified;
    case 'all':
    default:
      return true;
  }
}

export function queryPreservationProfiles(
  filters: PreservationQueryFilters = {}
): PreservationListResponse {
  const allMonuments = loadMonuments();
  const allProfiles = allMonuments.map(buildPreservationProfile);

  const stats: PreservationCoverageStats = {
    totalMonuments: allProfiles.length,
    withVerifiedCustodian: allProfiles.filter((p) => p.responsibleOrganisations.isVerified)
      .length,
    withExplicitCurrentCondition: allProfiles.filter(
      (p) => p.currentConservationStatus.isVerified
    ).length,
    withHistoricalDeterioration: allProfiles.filter((p) => p.historicalDeterioration.isVerified)
      .length,
    withEnvironmentalThreats: allProfiles.filter((p) => p.environmentalThreats.isVerified)
      .length,
    withStructuralChallenges: allProfiles.filter((p) => p.structuralChallenges.isVerified).length,
    withRestorationInitiatives: allProfiles.filter((p) => p.restorationInitiatives.isVerified)
      .length,
    withVerifiedUnescoListing: allProfiles.filter(
      (p) => p.unescoStatus === 'world_heritage_site'
    ).length,
    pendingCurrentConditionInspection: allProfiles.filter(
      (p) => !p.currentConservationStatus.isVerified
    ).length,
  };

  const availableLocations = Array.from(new Set(allProfiles.map((p) => p.state))).sort();
  const availableCategories = Array.from(new Set(allProfiles.map((p) => p.category))).sort();
  const availableUnescoStatuses = Array.from(
    new Set(allProfiles.map((p) => p.unescoStatus))
  ) as UnescoStatus[];

  const searchNormalized = filters.search?.trim().toLowerCase() ?? '';
  const locationFilter = filters.location?.trim() ?? '';
  const categoryFilter = filters.category?.trim() ?? '';
  const unescoFilter = filters.unescoStatus?.trim() ?? '';
  const conservationFilter = filters.conservationFilter ?? 'all';

  const filtered = allProfiles.filter((profile) => {
    const matchesSearch =
      !searchNormalized ||
      profile.name.toLowerCase().includes(searchNormalized) ||
      profile.alternativeNames.some((alt) => alt.toLowerCase().includes(searchNormalized)) ||
      profile.state.toLowerCase().includes(searchNormalized) ||
      profile.cityOrDistrict.toLowerCase().includes(searchNormalized) ||
      (profile.responsibleOrganisations.value?.toLowerCase().includes(searchNormalized) ??
        false) ||
      (profile.statutoryProtectionSummary?.toLowerCase().includes(searchNormalized) ?? false) ||
      profile.accessionCode.toLowerCase().includes(searchNormalized);

    const matchesLocation =
      !locationFilter ||
      locationFilter === 'All' ||
      profile.state.toLowerCase() === locationFilter.toLowerCase() ||
      profile.cityOrDistrict.toLowerCase() === locationFilter.toLowerCase();

    const matchesCategory =
      !categoryFilter || categoryFilter === 'All' || profile.category === categoryFilter;

    const matchesUnesco =
      !unescoFilter || unescoFilter === 'All' || profile.unescoStatus === unescoFilter;

    const matchesConservation = matchesConservationAvailability(profile, conservationFilter);

    return (
      matchesSearch &&
      matchesLocation &&
      matchesCategory &&
      matchesUnesco &&
      matchesConservation
    );
  });

  return {
    profiles: filtered,
    stats,
    availableLocations,
    availableCategories,
    availableUnescoStatuses,
  };
}
