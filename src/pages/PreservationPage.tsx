import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  ExternalLink,
  GitCompareArrows,
  History,
  Landmark,
  Layers,
  MessageSquareQuote,
  RotateCcw,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { fetchPreservationProfiles } from '../lib/api';
import type {
  ArchitecturalCategory,
  ConservationAvailabilityFilter,
  PreservationCoverageStats,
  PreservationFacet,
  PreservationProfile,
  UnescoStatus,
} from '../types/heritage';
import type { AppRoute } from '../components/Navbar';
import { MonumentPlate } from '../components/MonumentPlate';

interface PreservationPageProps {
  initialCompareIds?: string[];
  onNavigate: (route: AppRoute) => void;
}

const CONSERVATION_FILTER_OPTIONS: Array<{
  value: ConservationAvailabilityFilter;
  label: string;
}> = [
  { value: 'all', label: 'All Conservation Coverage Levels' },
  { value: 'has_current_condition', label: 'Has Explicit Current Condition Report (2)' },
  { value: 'has_historical_deterioration', label: 'Has Historical Deterioration Record (3)' },
  { value: 'has_environmental_threats', label: 'Has Documented Environmental Threats (8)' },
  { value: 'has_structural_challenges', label: 'Has Structural Preservation Challenges (5)' },
  { value: 'has_restoration_initiatives', label: 'Has Restoration / Management Plan (8)' },
  { value: 'has_detailed_conservation_notes', label: '2+ Conservation Facets Verified' },
  { value: 'pending_current_condition', label: 'Current Physical Condition Pending (18)' },
];

function formatUnescoLabel(status: UnescoStatus, year: number | null): string {
  switch (status) {
    case 'world_heritage_site':
      return year ? `UNESCO World Heritage Site (${year})` : 'UNESCO World Heritage Site';
    case 'tentative_list':
      return 'UNESCO Tentative List';
    case 'not_listed':
      return 'Not Listed by UNESCO';
    case 'unverified':
    default:
      return 'UNESCO Status Unverified';
  }
}

function formatTimeframeTag(facet: PreservationFacet): string {
  if (!facet.isVerified || facet.value === null) {
    return 'Not Verified (null)';
  }
  switch (facet.timeframe) {
    case 'current':
      return 'Current / Active Record';
    case 'historical':
      return 'Historical Record';
    case 'statutory':
      return 'Statutory Authority';
    default:
      return 'Verified';
  }
}

function FacetDetailCell({
  title,
  facet,
  sources,
}: {
  title: string;
  facet: PreservationFacet;
  sources: PreservationProfile['verifiedSources'];
}) {
  const matchedSources = sources.filter((src) => facet.citationIds.includes(src.id));

  return (
    <div className="rounded-md border border-[#E2D9C8] bg-[#FAF7F0]/70 p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-serif text-sm font-semibold text-[#2B1E16]">{title}</h4>
        <span
          className={`font-mono text-[10px] uppercase tracking-wider ${
            facet.isVerified
              ? facet.timeframe === 'historical'
                ? 'text-[#695547]'
                : 'text-[#7D5A1C]'
              : 'text-[#8C6D46]'
          }`}
        >
          [{formatTimeframeTag(facet)}]
        </span>
      </div>

      {facet.isVerified && facet.value ? (
        <p className="mt-2 text-xs leading-relaxed text-[#2B1E16]">{facet.value}</p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed italic text-[#695547]">
          <span className="font-mono not-italic text-[#7D5A1C]">null</span> —{' '}
          {facet.unverifiedNote ?? 'Information not yet verified in the current knowledge base.'}
        </p>
      )}

      {matchedSources.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#E2D9C8]/80 pt-2">
          {matchedSources.map((src) => (
            <a
              key={src.id}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-2 hover:text-[#2B1E16]"
            >
              <span>{src.publisher}</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function PreservationPage({ initialCompareIds, onNavigate }: PreservationPageProps) {
  const [profiles, setProfiles] = useState<PreservationProfile[]>([]);
  const [allProfilesCatalog, setAllProfilesCatalog] = useState<PreservationProfile[]>([]);
  const [stats, setStats] = useState<PreservationCoverageStats | null>(null);
  const [availableLocations, setAvailableLocations] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [availableUnescoStatuses, setAvailableUnescoStatuses] = useState<UnescoStatus[]>([]);

  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('All');
  const [category, setCategory] = useState('All');
  const [unescoStatus, setUnescoStatus] = useState('All');
  const [conservationFilter, setConservationFilter] =
    useState<ConservationAvailabilityFilter>('all');

  const [selectedCompareIds, setSelectedCompareIds] = useState<string[]>(() =>
    initialCompareIds && initialCompareIds.length > 0
      ? initialCompareIds.slice(0, 4)
      : ['taj-mahal', 'red-fort', 'charminar']
  );
  const [compareSelectionNotice, setCompareSelectionNotice] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync URL compare params if user navigates directly from Monument Detail page
  useEffect(() => {
    if (initialCompareIds && initialCompareIds.length > 0) {
      setSelectedCompareIds(initialCompareIds.slice(0, 4));
    }
  }, [initialCompareIds]);

  // Load unfiltered catalog once for the Comparison Tray selectors
  useEffect(() => {
    let active = true;
    fetchPreservationProfiles()
      .then((res) => {
        if (active) {
          setAllProfilesCatalog(res.profiles);
        }
      })
      .catch(() => {
        // Primary filtered fetch handles user-facing errors
      });
    return () => {
      active = false;
    };
  }, []);

  // Filtered query
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchPreservationProfiles({
          search: search.trim() || undefined,
          location,
          category,
          unescoStatus,
          conservationFilter,
        });
        if (!active) return;
        setProfiles(data.profiles);
        setStats(data.stats);
        setAvailableLocations(data.availableLocations);
        setAvailableCategories(data.availableCategories);
        setAvailableUnescoStatuses(data.availableUnescoStatuses);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : 'Unable to load heritage preservation records.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 150);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, location, category, unescoStatus, conservationFilter]);

  const compareProfiles = useMemo(() => {
    const sourcePool = allProfilesCatalog.length > 0 ? allProfilesCatalog : profiles;
    const byId = new Map(sourcePool.map((p) => [p.siteId, p]));
    return selectedCompareIds
      .map((id) => byId.get(id))
      .filter((item): item is PreservationProfile => Boolean(item));
  }, [allProfilesCatalog, profiles, selectedCompareIds]);

  const toggleCompareMonument = (siteId: string) => {
    setCompareSelectionNotice(null);
    setSelectedCompareIds((prev) => {
      if (prev.includes(siteId)) {
        return prev.filter((id) => id !== siteId);
      }
      if (prev.length >= 4) {
        setCompareSelectionNotice(
          'A maximum of 4 monuments can be compared side by side. Remove one site to add another.'
        );
        return prev;
      }
      return [...prev, siteId];
    });
  };

  const resetFilters = () => {
    setSearch('');
    setLocation('All');
    setCategory('All');
    setUnescoStatus('All');
    setConservationFilter('all');
  };

  const hasActiveFilters =
    Boolean(search.trim()) ||
    location !== 'All' ||
    category !== 'All' ||
    unescoStatus !== 'All' ||
    conservationFilter !== 'all';

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="border-b border-[#E2D9C8] pb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7D5A1C]">
          Conservation &amp; Stewardship Archive · 20-Site Knowledge Base
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-[#2B1E16] sm:text-4xl">
          Heritage Preservation &amp; Conservation Explorer
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#695547]">
          Inspect verified statutory custodians, UNESCO World Heritage inscriptions, documented
          environmental pressures, historical deterioration records, and active management
          initiatives across all 20 Indian heritage monuments. Historical records and statutory
          protection laws are separated from current physical conservation assessments, and
          unverified fields remain explicitly marked as <code className="font-mono text-[#7D5A1C]">null</code>.
        </p>
      </div>

      {/* Honest Knowledge-Base Coverage Ledger */}
      {stats && (
        <section aria-label="Verified preservation data coverage" className="mt-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-4">
              <p className="font-mono text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {stats.withVerifiedCustodian}/{stats.totalMonuments}
              </p>
              <p className="mt-1 text-xs text-[#695547]">Verified Custodian Authorities</p>
            </div>
            <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-4">
              <p className="font-mono text-2xl font-semibold text-[#7D5A1C] tabular-nums">
                {stats.withExplicitCurrentCondition}/{stats.totalMonuments}
              </p>
              <p className="mt-1 text-xs text-[#695547]">Explicit Current Condition Report</p>
            </div>
            <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-4">
              <p className="font-mono text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {stats.withHistoricalDeterioration}/{stats.totalMonuments}
              </p>
              <p className="mt-1 text-xs text-[#695547]">Historical Deterioration Records</p>
            </div>
            <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-4">
              <p className="font-mono text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {stats.withEnvironmentalThreats}/{stats.totalMonuments}
              </p>
              <p className="mt-1 text-xs text-[#695547]">Environmental Threat Notes</p>
            </div>
            <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-4">
              <p className="font-mono text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {stats.withRestorationInitiatives}/{stats.totalMonuments}
              </p>
              <p className="mt-1 text-xs text-[#695547]">Restoration / Management Plans</p>
            </div>
            <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-4">
              <p className="font-mono text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {stats.withVerifiedUnescoListing}/{stats.totalMonuments}
              </p>
              <p className="mt-1 text-xs text-[#695547]">Inscribed UNESCO World Heritage</p>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-[#C8A55B]/70 bg-[#FBF3E4] px-4 py-3 text-xs leading-relaxed text-[#695547]">
            <strong className="font-semibold text-[#2B1E16]">Audit Transparency:</strong> All 20
            monuments have verified custodian and statutory governance citations (spanning ASI
            Circles, State Archaeology Directorates, AKTC partnerships, and regional development
            authorities). However, only{' '}
            <strong className="text-[#2B1E16]">2 monuments</strong> (Red Fort and Mahabalipuram)
            carry an explicit current physical condition statement in the indexed UNESCO/ASI
            summaries; the remaining{' '}
            <strong className="text-[#2B1E16]">
              {stats.pendingCurrentConditionInspection} monuments
            </strong>{' '}
            mark current physical condition as unverified (<code className="font-mono">null</code>)
            rather than fabricating live inspection grades.
          </div>
        </section>
      )}

      {/* Multi-Monument Preservation Comparison Interface */}
      <section
        aria-label="Multi-monument preservation comparison"
        className="mt-10 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6"
      >
        <div className="flex flex-col gap-4 border-b border-[#E2D9C8] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#7D5A1C]">
              <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-widest">
                Side-by-Side Comparison Matrix
              </span>
            </div>
            <h2 className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16]">
              Compare Monument Conservation Profiles
            </h2>
            <p className="mt-1 text-xs text-[#695547]">
              Select 2 to 4 monuments below or via the &ldquo;Compare&rdquo; buttons on any archive
              card to contrast custodians, threats, restoration initiatives, and verification gaps.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Add monument to comparison"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  toggleCompareMonument(e.target.value);
                }
              }}
              className="min-h-[40px] rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
            >
              <option value="">+ Add monument to compare...</option>
              {(allProfilesCatalog.length > 0 ? allProfilesCatalog : profiles)
                .filter((p) => !selectedCompareIds.includes(p.siteId))
                .map((p) => (
                  <option key={p.siteId} value={p.siteId}>
                    {p.accessionCode} — {p.name} ({p.state})
                  </option>
                ))}
            </select>

            <button
              type="button"
              onClick={() => {
                setCompareSelectionNotice(null);
                setSelectedCompareIds(['taj-mahal', 'red-fort', 'charminar']);
              }}
              className="min-h-[40px] cursor-pointer rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs font-medium text-[#695547] hover:border-[#C8A55B] hover:text-[#2B1E16]"
            >
              Load Sample Trio
            </button>

            {selectedCompareIds.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCompareSelectionNotice(null);
                  setSelectedCompareIds([]);
                }}
                className="min-h-[40px] cursor-pointer rounded-md border border-[#E2D9C8] px-3 py-1.5 text-xs font-medium text-[#695547] hover:text-[#2B1E16]"
              >
                Clear ({selectedCompareIds.length})
              </button>
            )}
          </div>
        </div>

        {/* Selected Monument Chips (Strictly rectangular tokens, no pills) */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[#695547]">
            Selected ({compareProfiles.length}/4):
          </span>
          {compareProfiles.length === 0 ? (
            <span className="text-xs italic text-[#695547]">
              No monuments selected. Choose monuments from the dropdown or archive cards below.
            </span>
          ) : (
            compareProfiles.map((p) => (
              <span
                key={p.siteId}
                className="inline-flex items-center gap-2 rounded border border-[#C8A55B] bg-[#FBF3E4] px-2.5 py-1 text-xs font-medium text-[#2B1E16]"
              >
                <span className="font-mono text-[11px] text-[#7D5A1C]">{p.accessionCode}</span>
                <span>{p.name}</span>
                <button
                  type="button"
                  onClick={() => toggleCompareMonument(p.siteId)}
                  aria-label={`Remove ${p.name} from comparison`}
                  className="cursor-pointer text-[#695547] hover:text-[#2B1E16]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            ))
          )}
        </div>

        {compareSelectionNotice && (
          <p className="mt-2 text-xs text-[#7D5A1C]">{compareSelectionNotice}</p>
        )}

        {/* Comparison Table */}
        {compareProfiles.length >= 2 ? (
          <div className="mt-5 overflow-x-auto rounded-md border border-[#E2D9C8]">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#E2D9C8] bg-[#F3EDE1]/80">
                  <th className="w-44 p-3.5 font-serif text-sm font-semibold text-[#2B1E16]">
                    Preservation Dimension
                  </th>
                  {compareProfiles.map((p) => (
                    <th key={p.siteId} className="border-l border-[#E2D9C8] p-3.5 align-top">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-[#7D5A1C]">
                        {p.accessionCode} · {p.state}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate({ page: 'monument-detail', monumentId: p.siteId })
                        }
                        className="mt-0.5 cursor-pointer text-left font-serif text-base font-semibold text-[#2B1E16] hover:text-[#7D5A1C]"
                      >
                        {p.name}
                      </button>
                      <div className="mt-0.5 font-normal text-[#695547]">{p.category}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2D9C8] bg-[#FAF7F0]/50">
                <tr>
                  <th className="bg-[#FDFBF7] p-3.5 align-top font-semibold text-[#2B1E16]">
                    UNESCO Status
                  </th>
                  {compareProfiles.map((p) => (
                    <td
                      key={p.siteId}
                      className="border-l border-[#E2D9C8] p-3.5 align-top leading-relaxed text-[#2B1E16]"
                    >
                      {p.unescoSummary}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="bg-[#FDFBF7] p-3.5 align-top font-semibold text-[#2B1E16]">
                    Responsible Heritage Organisations
                  </th>
                  {compareProfiles.map((p) => (
                    <td
                      key={p.siteId}
                      className="border-l border-[#E2D9C8] p-3.5 align-top leading-relaxed text-[#2B1E16]"
                    >
                      {p.responsibleOrganisations.value ?? (
                        <span className="italic text-[#695547]">null (Requires verification)</span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="bg-[#FDFBF7] p-3.5 align-top font-semibold text-[#2B1E16]">
                    Current Conservation Condition
                    <span className="mt-0.5 block text-[10px] font-normal text-[#695547]">
                      Physical inspection state
                    </span>
                  </th>
                  {compareProfiles.map((p) => (
                    <td
                      key={p.siteId}
                      className="border-l border-[#E2D9C8] p-3.5 align-top leading-relaxed"
                    >
                      {p.currentConservationStatus.isVerified &&
                      p.currentConservationStatus.value ? (
                        <span className="text-[#2B1E16]">
                          {p.currentConservationStatus.value}
                        </span>
                      ) : (
                        <span className="italic text-[#695547]">
                          <code className="font-mono not-italic text-[#7D5A1C]">null</code> — Live
                          physical condition not yet verified in KB
                        </span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="bg-[#FDFBF7] p-3.5 align-top font-semibold text-[#2B1E16]">
                    Historical Deterioration
                    <span className="mt-0.5 block text-[10px] font-normal text-[#695547]">
                      Past damage &amp; events
                    </span>
                  </th>
                  {compareProfiles.map((p) => (
                    <td
                      key={p.siteId}
                      className="border-l border-[#E2D9C8] p-3.5 align-top leading-relaxed"
                    >
                      {p.historicalDeterioration.isVerified && p.historicalDeterioration.value ? (
                        <span className="text-[#2B1E16]">{p.historicalDeterioration.value}</span>
                      ) : (
                        <span className="italic text-[#695547]">
                          <code className="font-mono not-italic text-[#7D5A1C]">null</code> — None
                          indexed
                        </span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="bg-[#FDFBF7] p-3.5 align-top font-semibold text-[#2B1E16]">
                    Environmental Threats
                  </th>
                  {compareProfiles.map((p) => (
                    <td
                      key={p.siteId}
                      className="border-l border-[#E2D9C8] p-3.5 align-top leading-relaxed"
                    >
                      {p.environmentalThreats.isVerified && p.environmentalThreats.value ? (
                        <span className="text-[#2B1E16]">{p.environmentalThreats.value}</span>
                      ) : (
                        <span className="italic text-[#695547]">
                          <code className="font-mono not-italic text-[#7D5A1C]">null</code> — Not
                          yet verified
                        </span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="bg-[#FDFBF7] p-3.5 align-top font-semibold text-[#2B1E16]">
                    Structural Preservation Challenges
                  </th>
                  {compareProfiles.map((p) => (
                    <td
                      key={p.siteId}
                      className="border-l border-[#E2D9C8] p-3.5 align-top leading-relaxed"
                    >
                      {p.structuralChallenges.isVerified && p.structuralChallenges.value ? (
                        <span className="text-[#2B1E16]">{p.structuralChallenges.value}</span>
                      ) : (
                        <span className="italic text-[#695547]">
                          <code className="font-mono not-italic text-[#7D5A1C]">null</code> — Not
                          yet verified
                        </span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="bg-[#FDFBF7] p-3.5 align-top font-semibold text-[#2B1E16]">
                    Restoration &amp; Conservation Initiatives
                  </th>
                  {compareProfiles.map((p) => (
                    <td
                      key={p.siteId}
                      className="border-l border-[#E2D9C8] p-3.5 align-top leading-relaxed"
                    >
                      {p.restorationInitiatives.isVerified && p.restorationInitiatives.value ? (
                        <span className="text-[#2B1E16]">{p.restorationInitiatives.value}</span>
                      ) : (
                        <span className="italic text-[#695547]">
                          <code className="font-mono not-italic text-[#7D5A1C]">null</code> —
                          Project records not yet verified
                        </span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="bg-[#FDFBF7] p-3.5 align-top font-semibold text-[#2B1E16]">
                    Verified Source Links
                  </th>
                  {compareProfiles.map((p) => (
                    <td key={p.siteId} className="border-l border-[#E2D9C8] p-3.5 align-top">
                      <ul className="space-y-1.5">
                        {p.verifiedSources.map((src) => (
                          <li key={src.id}>
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-2 hover:text-[#2B1E16]"
                            >
                              <span>{src.publisher}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-dashed border-[#C8A55B] bg-[#FAF7F0] p-5 text-center text-xs text-[#695547]">
            Select at least <strong className="text-[#2B1E16]">2 monuments</strong> to display the
            side-by-side preservation comparison table.
          </div>
        )}
      </section>

      {/* Filters Toolbar */}
      <section aria-label="Filter preservation records" className="mt-10">
        <div className="grid gap-3 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-4 sm:grid-cols-2 lg:grid-cols-12">
          <div className="relative lg:col-span-4">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#695547]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search monument, custodian, AMASR Act, or threat..."
              aria-label="Search preservation profiles"
              className="h-11 w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] pr-3 pl-9 text-sm text-[#2B1E16] placeholder:text-[#695547]/70 focus:border-[#8B6624] focus:outline-none"
            />
          </div>

          <div className="lg:col-span-2">
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              aria-label="Filter by location"
              className="h-11 w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 text-sm text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
            >
              <option value="All">All Locations (States)</option>
              {availableLocations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by heritage category"
              className="h-11 w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 text-sm text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
            >
              <option value="All">All Heritage Categories</option>
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              value={unescoStatus}
              onChange={(e) => setUnescoStatus(e.target.value)}
              aria-label="Filter by UNESCO World Heritage status"
              className="h-11 w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 text-sm text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
            >
              <option value="All">All UNESCO Statuses</option>
              {availableUnescoStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatUnescoLabel(status, null)}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              value={conservationFilter}
              onChange={(e) =>
                setConservationFilter(e.target.value as ConservationAvailabilityFilter)
              }
              aria-label="Filter by available conservation information"
              className="h-11 w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 text-sm text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
            >
              {CONSERVATION_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[#695547]">
            Showing{' '}
            <span className="font-mono font-semibold text-[#2B1E16] tabular-nums">
              {profiles.length}
            </span>{' '}
            preservation profile(s)
            {hasActiveFilters ? ' matching active filters' : ' across the 20-site archive'}
          </p>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-[#7D5A1C] underline underline-offset-4 hover:text-[#2B1E16]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset All Filters</span>
            </button>
          )}
        </div>
      </section>

      {/* Main Content */}
      {error && (
        <div className="mt-8 rounded-lg border border-[#7F1D1D]/30 bg-[#FEF2F2] p-4 text-sm text-[#7F1D1D]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-8 space-y-6">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-64 animate-pulse rounded-lg border border-[#E2D9C8] bg-[#F3EDE1]/60"
            />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <div className="mt-10 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-12 text-center">
          <Layers className="mx-auto h-8 w-8 text-[#7D5A1C]" aria-hidden="true" />
          <h3 className="mt-3 font-serif text-xl font-semibold text-[#2B1E16]">
            No Matching Preservation Profiles
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-[#695547]">
            No heritage records match your current location, category, UNESCO status, and
            conservation coverage filters.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-5 cursor-pointer rounded-md bg-[#7D5A1C] px-4 py-2 text-xs font-medium text-[#FAF7F0] hover:bg-[#654714]"
          >
            Reset Preservation Filters
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {profiles.map((profile) => {
            const isSelectedForCompare = selectedCompareIds.includes(profile.siteId);
            return (
              <article
                key={profile.siteId}
                className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6"
              >
                {/* Top Card Bar */}
                <div className="flex flex-col gap-4 border-b border-[#E2D9C8] pb-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({ page: 'monument-detail', monumentId: profile.siteId })
                      }
                      className="group w-36 shrink-0 cursor-pointer overflow-hidden rounded border border-[#E2D9C8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B6624]"
                    >
                      <MonumentPlate
                        monumentId={profile.siteId}
                        monumentName={profile.name}
                        accessionCode={profile.accessionCode}
                        category={profile.category as ArchitecturalCategory}
                        className="aspect-[4/3] w-full"
                      />
                    </button>

                    <div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-[#7D5A1C] tabular-nums">
                        <span>{profile.accessionCode}</span>
                        <span>·</span>
                        <span>{profile.category}</span>
                        <span>·</span>
                        <span>
                          {profile.cityOrDistrict}, {profile.state}
                        </span>
                      </div>

                      <h2 className="mt-1.5 font-serif text-2xl font-semibold text-[#2B1E16]">
                        {profile.name}
                      </h2>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-medium ${
                            profile.unescoStatus === 'world_heritage_site'
                              ? 'border-[#C8A55B] bg-[#FBF3E4] text-[#7D5A1C]'
                              : profile.unescoStatus === 'not_listed'
                                ? 'border-[#E2D9C8] bg-[#FAF7F0] text-[#695547]'
                                : 'border-[#7F1D1D]/40 bg-[#FEF2F2] text-[#7F1D1D]'
                          }`}
                        >
                          <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {formatUnescoLabel(profile.unescoStatus, profile.unescoInscriptionYear)}
                          </span>
                        </span>

                        <span className="inline-flex items-center gap-1.5 rounded border border-[#E2D9C8] bg-[#FAF7F0] px-2 py-0.5 font-mono text-[11px] text-[#695547] tabular-nums">
                          {profile.verifiedDetailedFacetCount}/6 Preservation Facets Verified
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleCompareMonument(profile.siteId)}
                      className={`inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        isSelectedForCompare
                          ? 'border-[#7D5A1C] bg-[#7D5A1C] text-[#FAF7F0]'
                          : 'border-[#E2D9C8] bg-[#FAF7F0] text-[#2B1E16] hover:border-[#C8A55B]'
                      }`}
                    >
                      {isSelectedForCompare ? (
                        <>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>In Comparison</span>
                        </>
                      ) : (
                        <>
                          <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Add to Compare</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({ page: 'monument-detail', monumentId: profile.siteId })
                      }
                      className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3.5 py-1.5 text-xs font-medium text-[#2B1E16] hover:border-[#C8A55B] hover:text-[#7D5A1C]"
                    >
                      <span>Monograph</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({ page: 'discovery', monumentId: profile.siteId })
                      }
                      className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3.5 py-1.5 text-xs font-medium text-[#7D5A1C] hover:border-[#C8A55B]"
                    >
                      <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Ask Assistant</span>
                    </button>
                  </div>
                </div>

                {/* Statutory & UNESCO Framing Strip */}
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-md border border-[#E2D9C8] bg-[#F3EDE1]/50 p-3.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#2B1E16]">
                      <Building2 className="h-4 w-4 text-[#7D5A1C]" aria-hidden="true" />
                      <span>Statutory &amp; Legal Governance Framework</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#695547]">
                      {profile.statutoryProtectionSummary ??
                        'Statutory protection summary requires verification.'}
                    </p>
                  </div>

                  <div className="rounded-md border border-[#E2D9C8] bg-[#F3EDE1]/50 p-3.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#2B1E16]">
                      <ShieldCheck className="h-4 w-4 text-[#7D5A1C]" aria-hidden="true" />
                      <span>UNESCO World Heritage Verification Context</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#695547]">
                      {profile.unescoSummary}
                    </p>
                  </div>
                </div>

                {/* 6 Core Preservation Facets */}
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <FacetDetailCell
                    title="01. Current Conservation Status"
                    facet={profile.currentConservationStatus}
                    sources={profile.verifiedSources}
                  />
                  <FacetDetailCell
                    title="02. Historical Deterioration"
                    facet={profile.historicalDeterioration}
                    sources={profile.verifiedSources}
                  />
                  <FacetDetailCell
                    title="03. Environmental Threats"
                    facet={profile.environmentalThreats}
                    sources={profile.verifiedSources}
                  />
                  <FacetDetailCell
                    title="04. Structural Preservation Challenges"
                    facet={profile.structuralChallenges}
                    sources={profile.verifiedSources}
                  />
                  <FacetDetailCell
                    title="05. Restoration & Conservation Initiatives"
                    facet={profile.restorationInitiatives}
                    sources={profile.verifiedSources}
                  />
                  <FacetDetailCell
                    title="06. Responsible Heritage Organisations"
                    facet={profile.responsibleOrganisations}
                    sources={profile.verifiedSources}
                  />
                </div>

                {/* Verified Citations Footer */}
                <div className="mt-4 flex flex-col gap-2 border-t border-[#E2D9C8] pt-3.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 font-medium text-[#2B1E16]">
                      <Wrench className="h-3.5 w-3.5 text-[#7D5A1C]" aria-hidden="true" />
                      <span>Verified Sources ({profile.verifiedSources.length}):</span>
                    </span>
                    {profile.verifiedSources.map((src) => (
                      <span key={src.id} className="inline-flex items-center gap-2">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-2 hover:text-[#2B1E16]"
                        >
                          <span>{src.sourceTitle}</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                        {src.apiVerificationUrl && (
                          <a
                            href={src.apiVerificationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-[11px] text-[#695547] underline hover:text-[#2B1E16]"
                          >
                            <span>[Data API]</span>
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                      </span>
                    ))}
                  </div>

                  {profile.unverifiedSources.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#7F1D1D]">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        {profile.unverifiedSources.length} unverified reference excluded from
                        claims
                      </span>
                    </span>
                  )}
                </div>

                {profile.missingDetailedFacets.length > 0 && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[#695547]">
                    <History className="h-3.5 w-3.5 shrink-0 text-[#7D5A1C]" aria-hidden="true" />
                    <span>
                      Fields awaiting primary verification ({profile.missingDetailedFacets.length}
                      ): {profile.missingDetailedFacets.join(', ')}.
                    </span>
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
