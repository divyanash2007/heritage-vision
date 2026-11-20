import { useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import { fetchKnowledgeBaseValidation, fetchMonuments } from '../lib/api';
import type {
  KnowledgeBaseValidationReport,
  MonumentRecord,
  UnescoStatus,
} from '../types/heritage';
import type { AppRoute } from '../components/Navbar';
import { MonumentPlate } from '../components/MonumentPlate';

interface ExplorerPageProps {
  onNavigate: (route: AppRoute) => void;
}

function formatUnescoStatusLabel(status: UnescoStatus): string {
  switch (status) {
    case 'world_heritage_site':
      return 'UNESCO World Heritage';
    case 'tentative_list':
      return 'UNESCO Tentative List';
    case 'not_listed':
      return 'Not UNESCO Listed';
    case 'unverified':
    default:
      return 'Status Unverified';
  }
}

export function ExplorerPage({ onNavigate }: ExplorerPageProps) {
  const [monuments, setMonuments] = useState<MonumentRecord[]>([]);
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [availableUnescoStatuses, setAvailableUnescoStatuses] = useState<string[]>([]);
  const [validationReport, setValidationReport] =
    useState<KnowledgeBaseValidationReport | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedState, setSelectedState] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedUnescoStatus, setSelectedUnescoStatus] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchKnowledgeBaseValidation()
      .then((report) => {
        if (active) setValidationReport(report);
      })
      .catch(() => {
        // Non-blocking integrity metadata
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetchMonuments({
          search: searchTerm,
          state: selectedState,
          category: selectedCategory,
          unescoStatus: selectedUnescoStatus,
        });
        if (!active) return;
        setMonuments(res.monuments);
        setAvailableStates(res.availableStates);
        setAvailableCategories(res.availableCategories);
        setAvailableUnescoStatuses(res.availableUnescoStatuses);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load heritage catalogue.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 140);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchTerm, selectedState, selectedCategory, selectedUnescoStatus]);

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedState('All');
    setSelectedCategory('All');
    setSelectedUnescoStatus('All');
  };

  const hasActiveFilters =
    searchTerm.trim() !== '' ||
    selectedState !== 'All' ||
    selectedCategory !== 'All' ||
    selectedUnescoStatus !== 'All';

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="border-b border-[#E2D9C8] pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7D5A1C]">
          Verified Heritage Knowledge Base
        </p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-[#2B1E16] sm:text-4xl">
              Heritage Explorer
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#695547]">
              Search and filter the 20 Indian heritage monument records. Verified historical and
              architectural details are linked directly to UNESCO World Heritage records, while
              unverified fields remain transparently flagged.
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="font-mono text-xs text-[#695547] tabular-nums">
              Showing {monuments.length} {monuments.length === 1 ? 'record' : 'records'}
            </p>
            {validationReport && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[#695547] tabular-nums">
                {validationReport.isValid ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#7D5A1C]" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5 text-[#7F1D1D]" aria-hidden="true" />
                )}
                <span>
                  {validationReport.validRecordsCount}/{validationReport.totalRecords} Validated ·{' '}
                  {validationReport.verifiedSourcesCount} Verified Sources
                  {validationReport.unverifiedSourcesCount > 0
                    ? ` · ${validationReport.unverifiedSourcesCount} Unverified`
                    : ''}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="mt-8 space-y-5 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-5">
        <div className="grid gap-4 md:grid-cols-12">
          <div className="md:col-span-5">
            <label htmlFor="monument-search" className="block text-xs font-medium text-[#695547]">
              Search by monument name, alternative name, city, or site ID
            </label>
            <div className="relative mt-1.5">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#695547]"
                aria-hidden="true"
              />
              <input
                id="monument-search"
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="e.g. Taj Mahal, Lal Qila, Hampi..."
                className="min-h-[42px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] py-2 pl-9 pr-3 text-sm text-[#2B1E16] placeholder:text-[#695547]/60 focus:border-[#8B6624] focus:outline-none"
              />
            </div>
          </div>

          <div className="md:col-span-3">
            <label htmlFor="state-filter" className="block text-xs font-medium text-[#695547]">
              Indian State / Territory
            </label>
            <select
              id="state-filter"
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-2 text-sm text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
            >
              <option value="All">All States &amp; Territories</option>
              {availableStates.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="unesco-filter" className="block text-xs font-medium text-[#695547]">
              UNESCO Status
            </label>
            <select
              id="unesco-filter"
              value={selectedUnescoStatus}
              onChange={(e) => setSelectedUnescoStatus(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-2 text-sm text-[#2B1E16] focus:border-[#8B6624] focus:outline-none"
            >
              <option value="All">All Statuses</option>
              {availableUnescoStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatUnescoStatusLabel(status as UnescoStatus)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end md:col-span-2">
            <button
              type="button"
              disabled={!hasActiveFilters}
              onClick={handleResetFilters}
              className="inline-flex min-h-[42px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-2 text-xs font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Category Segmented Controls */}
        <div className="border-t border-[#E2D9C8] pt-4">
          <p className="mb-2.5 text-xs font-medium text-[#695547]">Architectural Category</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedCategory('All')}
              className={`whitespace-nowrap shrink-0 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedCategory === 'All'
                  ? 'bg-[#7D5A1C] text-[#FAF7F0]'
                  : 'bg-[#F3EDE1] text-[#695547] hover:text-[#2B1E16]'
              }`}
            >
              All Categories
            </button>
            {availableCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`whitespace-nowrap shrink-0 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedCategory === cat
                    ? 'bg-[#7D5A1C] text-[#FAF7F0]'
                    : 'bg-[#F3EDE1] text-[#695547] hover:text-[#2B1E16]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="mt-8 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] p-5 text-sm text-[#7F1D1D]"
        >
          {error}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="h-80 animate-pulse rounded-lg border border-[#E2D9C8] bg-[#F3EDE1]/60"
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && monuments.length === 0 && (
        <div className="mt-10 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] px-6 py-14 text-center">
          <p className="font-serif text-xl font-semibold text-[#2B1E16]">
            No matching monument records found
          </p>
          <p className="mt-2 text-sm text-[#695547]">
            Try clearing your search term or selecting a broader state or architectural category.
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="mt-5 cursor-pointer rounded-md bg-[#7D5A1C] px-4 py-2 text-xs font-medium text-[#FAF7F0] hover:bg-[#654714]"
          >
            Clear All Filters
          </button>
        </div>
      )}

      {/* Catalogue Grid */}
      {!loading && !error && monuments.length > 0 && (
        <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {monuments.map((monument) => (
            <article
              key={monument.id}
              className="group flex flex-col overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] transition-colors duration-150 hover:border-[#C8A55B]"
            >
              <button
                type="button"
                onClick={() => onNavigate({ page: 'monument-detail', monumentId: monument.id })}
                className="flex flex-1 cursor-pointer flex-col text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B6624]"
              >
                <MonumentPlate
                  monumentId={monument.id}
                  monumentName={monument.name}
                  accessionCode={monument.accessionCode}
                  category={monument.category}
                  className="aspect-[4/3] w-full border-b border-[#E2D9C8]"
                />
                <div className="flex flex-1 flex-col justify-between p-5">
                  <div>
                    <p className="font-mono text-[11px] text-[#695547] tabular-nums">
                      {monument.accessionCode} · {monument.state}
                    </p>
                    <h2 className="mt-1.5 font-serif text-xl font-semibold text-[#2B1E16] group-hover:text-[#7D5A1C] transition-colors">
                      {monument.name}
                    </h2>
                    <p className="mt-1 text-xs text-[#695547]">
                      {monument.cityOrDistrict} · {monument.category}
                    </p>
                    {monument.description ? (
                      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-[#695547]">
                        {monument.description}
                      </p>
                    ) : (
                      <p className="mt-3 text-xs italic text-[#7D5A1C]">
                        Authoritative historical verification required.
                      </p>
                    )}
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-[#E2D9C8] pt-3 text-xs">
                    <span className="text-[#695547]">
                      {formatUnescoStatusLabel(monument.unescoStatus)}
                      {monument.unescoInscriptionYear ? ` (${monument.unescoInscriptionYear})` : ''}
                    </span>
                    <span className="font-medium text-[#7D5A1C]">
                      {(() => {
                        const verifiedCount = monument.sourceReferences.filter(
                          (s) => s.verificationStatus === 'verified'
                        ).length;
                        if (verifiedCount > 0) {
                          return `${verifiedCount} verified ${verifiedCount === 1 ? 'source' : 'sources'} →`;
                        }
                        if (monument.sourceReferences.length > 0) {
                          return `${monument.sourceReferences.length} unverified ref →`;
                        }
                        return '0 sources →';
                      })()}
                    </span>
                  </div>
                </div>
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
