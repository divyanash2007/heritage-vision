import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  GitCompareArrows,
  ImageIcon,
  MessageSquareQuote,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { fetchMonumentById, fetchPreservationProfileById } from '../lib/api';
import type {
  MonumentRecord,
  PreservationFacet,
  PreservationProfile,
  UnescoStatus,
} from '../types/heritage';
import type { AppRoute } from '../components/Navbar';
import { MonumentGallery } from '../components/MonumentGallery';

interface MonumentDetailPageProps {
  monumentId: string;
  onNavigate: (route: AppRoute) => void;
}

function formatUnescoBadgeText(status: UnescoStatus, year: number | null): string {
  switch (status) {
    case 'world_heritage_site':
      return year ? `UNESCO World Heritage Site (Inscribed ${year})` : 'UNESCO World Heritage Site';
    case 'tentative_list':
      return 'UNESCO World Heritage Tentative List';
    case 'not_listed':
      return 'Not Inscribed on UNESCO World Heritage List';
    case 'unverified':
    default:
      return 'UNESCO Status Requires Verification';
  }
}

function formatFacetTimeframeLabel(facet: PreservationFacet): string {
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

export function MonumentDetailPage({ monumentId, onNavigate }: MonumentDetailPageProps) {
  const [monument, setMonument] = useState<MonumentRecord | null>(null);
  const [preservationProfile, setPreservationProfile] = useState<PreservationProfile | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadRecord() {
      try {
        setLoading(true);
        setError(null);
        const [record, preservation] = await Promise.all([
          fetchMonumentById(monumentId),
          fetchPreservationProfileById(monumentId).catch(() => null),
        ]);
        if (active) {
          setMonument(record);
          setPreservationProfile(preservation);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load monument record.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadRecord();
    return () => {
      active = false;
    };
  }, [monumentId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="h-8 w-40 animate-pulse rounded bg-[#F3EDE1]" />
        <div className="mt-6 h-96 animate-pulse rounded-lg border border-[#E2D9C8] bg-[#F3EDE1]/60" />
      </div>
    );
  }

  if (error || !monument) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="font-serif text-3xl font-semibold text-[#2B1E16]">
          Monument Record Not Found
        </h1>
        <p className="mt-3 text-sm text-[#695547]">
          {error ?? 'The requested heritage monument record could not be located.'}
        </p>
        <button
          type="button"
          onClick={() => onNavigate({ page: 'explorer' })}
          className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#7D5A1C] px-5 py-2.5 text-sm font-medium text-[#FAF7F0] hover:bg-[#654714]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Return to Heritage Explorer</span>
        </button>
      </div>
    );
  }

  const structuredSections = [
    {
      number: '01.',
      title: 'Description',
      value: monument.description,
      requiresVerification: monument.description === null,
      placeholderNote:
        'Stored as null — authoritative description requires verification from UNESCO or ASI primary documentation.',
    },
    {
      number: '02.',
      title: 'Historical Period & Significance',
      value:
        monument.historicalSignificance || monument.historicalPeriod
          ? [
              monument.historicalPeriod ? `Period: ${monument.historicalPeriod}.` : null,
              monument.constructionDateOrPeriod
                ? `Construction: ${monument.constructionDateOrPeriod}.`
                : null,
              monument.historicalSignificance,
            ]
              .filter(Boolean)
              .join(' ')
          : null,
      requiresVerification:
        monument.historicalSignificance === null && monument.historicalPeriod === null,
      placeholderNote:
        'Stored as null — historical chronology and significance await verified primary citations.',
    },
    {
      number: '03.',
      title: 'Architectural Style',
      value: monument.architecturalStyle,
      requiresVerification: monument.architecturalStyle === null,
      placeholderNote:
        'Stored as null — architectural typology requires authoritative ASI or UNESCO dossier verification.',
    },
    {
      number: '04.',
      title: 'Preservation Information',
      value:
        monument.preservationInformation.custodian || monument.preservationInformation.statusSummary
          ? [
              monument.preservationInformation.custodian
                ? `Custodian: ${monument.preservationInformation.custodian}.`
                : null,
              monument.preservationInformation.statusSummary,
            ]
              .filter(Boolean)
              .join(' ')
          : null,
      requiresVerification: monument.preservationInformation.requiresVerification,
      placeholderNote:
        'Stored as null — conservation condition and custodian reports require direct verification from Archaeological Survey of India (ASI) preservation records.',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <button
        type="button"
        onClick={() => onNavigate({ page: 'explorer' })}
        className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[#695547] transition-colors hover:text-[#2B1E16]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Back to Heritage Explorer</span>
      </button>

      {/* Title & Accession Header */}
      <div className="mt-6 border-b border-[#E2D9C8] pb-8">
        <p className="font-mono text-xs tracking-wider text-[#7D5A1C] uppercase tabular-nums">
          {monument.accessionCode} · Site ID: {monument.id} ·{' '}
          {formatUnescoBadgeText(monument.unescoStatus, monument.unescoInscriptionYear)}
        </p>
        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-[#2B1E16] sm:text-5xl">
              {monument.name}
            </h1>
            <p className="mt-2 text-sm text-[#695547]">
              {monument.cityOrDistrict}, {monument.state}, {monument.country}
              {monument.alternativeNames.length > 0 && (
                <span> · Also known as: {monument.alternativeNames.join(', ')}</span>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate({ page: 'discovery', monumentId: monument.id })}
            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-md bg-[#7D5A1C] px-5 py-2.5 text-sm font-medium text-[#FAF7F0] transition-colors hover:bg-[#654714]"
          >
            <MessageSquareQuote className="h-4 w-4" aria-hidden="true" />
            <span>Ask Questions in Cultural Discovery</span>
          </button>
        </div>
      </div>

      {/* Artwork Plate + Accession Metadata Grid */}
      <div className="mt-10 grid items-stretch gap-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <MonumentGallery
            monumentId={monument.id}
            monumentName={monument.name}
            accessionCode={monument.accessionCode}
            category={monument.category}
            images={monument.imageReferences}
            layout="feature"
          />
        </div>

        <div className="flex flex-col justify-between rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6 lg:col-span-5">
          <div>
            <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
              Knowledge Base Record Metadata
            </h2>
            <dl className="mt-5 divide-y divide-[#E2D9C8] border-y border-[#E2D9C8] text-sm">
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-[#695547]">Unique Site ID</dt>
                <dd className="font-mono text-xs font-medium text-[#2B1E16]">{monument.id}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-[#695547]">Country &amp; State</dt>
                <dd className="text-right font-medium text-[#2B1E16]">
                  {monument.state}, {monument.country}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-[#695547]">City / District</dt>
                <dd className="text-right font-medium text-[#2B1E16]">
                  {monument.cityOrDistrict}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-[#695547]">Historical Period</dt>
                <dd className="text-right font-medium text-[#2B1E16]">
                  {monument.historicalPeriod ?? (
                    <span className="italic text-[#7D5A1C]">Verification required (null)</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-[#695547]">Construction Date</dt>
                <dd className="text-right font-medium text-[#2B1E16]">
                  {monument.constructionDateOrPeriod ?? (
                    <span className="italic text-[#7D5A1C]">Verification required (null)</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-[#695547]">UNESCO Status</dt>
                <dd className="text-right font-medium text-[#2B1E16]">
                  {formatUnescoBadgeText(monument.unescoStatus, monument.unescoInscriptionYear)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-[#695547]">Verified Sources</dt>
                <dd className="font-mono font-medium text-[#2B1E16] tabular-nums">
                  {monument.sourceReferences.filter((s) => s.verificationStatus === 'verified').length}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-5 rounded-md border border-[#C8A55B]/70 bg-[#FBF3E4] p-4">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#7D5A1C]" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-[#695547]">
                {monument.requiresVerificationFields.length > 0
                  ? `Fields requiring authoritative verification (${monument.requiresVerificationFields.length}): ${monument.requiresVerificationFields.join(', ')}. Unverified values are stored as null.`
                  : 'All fields in this record are backed by verified sources.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Structured Historical & Architectural Sections */}
      <div className="mt-14 space-y-6">
        <div className="border-b border-[#E2D9C8] pb-4">
          <h2 className="font-serif text-2xl font-semibold text-[#2B1E16]">
            Historical, Architectural &amp; Preservation Profile
          </h2>
          <p className="mt-1 text-xs text-[#695547]">
            Verified summaries are cited below; unverified fields remain explicitly marked as null
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {structuredSections.map((entry) => (
            <section
              key={entry.number}
              className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-serif text-lg font-semibold text-[#2B1E16]">
                  <span className="mr-2 font-serif text-[#8B6624] tabular-nums">
                    {entry.number}
                  </span>
                  {entry.title}
                </h3>
                <span className="text-[11px] font-medium text-[#7D5A1C]">
                  {entry.requiresVerification ? 'Requires Verification' : 'Source-Backed'}
                </span>
              </div>

              {entry.value ? (
                <p className="mt-3 text-sm leading-relaxed text-[#2B1E16]">{entry.value}</p>
              ) : (
                <p className="mt-3 text-sm italic text-[#695547]">null (Not yet verified)</p>
              )}

              {entry.requiresVerification && (
                <p className="mt-3 border-t border-[#E2D9C8] pt-3 text-xs leading-relaxed text-[#695547]">
                  {entry.placeholderNote}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>

      {/* Dedicated Preservation & Conservation Section */}
      {preservationProfile && (
        <section
          aria-label="Detailed preservation and conservation assessment"
          className="mt-12 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6"
        >
          <div className="flex flex-col gap-4 border-b border-[#E2D9C8] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#7D5A1C]" aria-hidden="true" />
                <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
                  Conservation Conditions, Threats &amp; Restoration Profile
                </h2>
              </div>
              <p className="mt-1 text-xs text-[#695547]">
                Distinguishes statutory governance and historical records from verified current
                conservation conditions. Unverified facets remain stored as{' '}
                <code className="font-mono text-[#7D5A1C]">null</code>.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                onNavigate({
                  page: 'preservation',
                  compareIds: [
                    monument.id,
                    monument.id === 'taj-mahal' ? 'red-fort' : 'taj-mahal',
                  ],
                })
              }
              className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center gap-2 rounded-md border border-[#C8A55B] bg-[#FBF3E4] px-4 py-2 text-xs font-medium text-[#7D5A1C] transition-colors hover:bg-[#F3EDE1] hover:text-[#2B1E16]"
            >
              <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
              <span>Compare in Preservation Explorer</span>
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                label: 'Current Conservation Status',
                facet: preservationProfile.currentConservationStatus,
              },
              {
                label: 'Historical Deterioration',
                facet: preservationProfile.historicalDeterioration,
              },
              {
                label: 'Environmental Threats',
                facet: preservationProfile.environmentalThreats,
              },
              {
                label: 'Structural Preservation Challenges',
                facet: preservationProfile.structuralChallenges,
              },
              {
                label: 'Restoration & Conservation Initiatives',
                facet: preservationProfile.restorationInitiatives,
              },
              {
                label: 'Responsible Heritage Organisations',
                facet: preservationProfile.responsibleOrganisations,
              },
            ].map((item) => {
              const cited = preservationProfile.verifiedSources.filter((src) =>
                item.facet.citationIds.includes(src.id)
              );
              return (
                <div
                  key={item.label}
                  className="rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-serif text-base font-semibold text-[#2B1E16]">
                      {item.label}
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#7D5A1C]">
                      [{formatFacetTimeframeLabel(item.facet)}]
                    </span>
                  </div>
                  {item.facet.isVerified && item.facet.value ? (
                    <p className="mt-2 text-xs leading-relaxed text-[#2B1E16]">
                      {item.facet.value}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs leading-relaxed italic text-[#695547]">
                      <code className="font-mono not-italic text-[#7D5A1C]">null</code> —{' '}
                      {item.facet.unverifiedNote}
                    </p>
                  )}
                  {cited.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#E2D9C8]/80 pt-2">
                      {cited.map((src) => (
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
            })}
          </div>
        </section>
      )}

      {/* Image References */}
      <section className="mt-12 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
        <div className="flex items-center justify-between gap-4 border-b border-[#E2D9C8] pb-4">
          <div className="flex items-center gap-2.5">
            <ImageIcon className="h-5 w-5 text-[#7D5A1C]" aria-hidden="true" />
            <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
              Image Metadata &amp; Provenance
            </h2>
          </div>
          <span className="font-mono text-xs text-[#695547] tabular-nums">
            {monument.imageReferences.filter((img) => img.is_recognition_dataset_image).length} dataset photo(s) ·{' '}
            {monument.imageReferences.length} asset(s)
          </span>
        </div>

        <ul className="mt-4 divide-y divide-[#E2D9C8] text-xs">
          {monument.imageReferences.map((img) => (
            <li
              key={img.image_id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="space-y-1">
                <p className="font-medium text-[#2B1E16]">{img.caption}</p>
                <p className="text-[#695547]">
                  Type: <span className="font-mono text-[#2B1E16]">{img.image_type}</span> ·
                  Status: <span className="font-mono text-[#2B1E16]">{img.verification_status}</span> ·
                  Dataset Eligible:{' '}
                  <span className="font-medium text-[#7D5A1C]">
                    {img.is_recognition_dataset_image ? 'Yes' : 'No (Excluded from OpenCLIP dataset)'}
                  </span>
                </p>
                <p className="text-[#695547]">
                  File: <span className="font-mono">{img.filename ?? 'null'}</span> · Creator:{' '}
                  {img.creator ?? 'null'} · Licence: {img.licence ?? 'null'}
                </p>
                {img.attribution && (
                  <p className="text-[#695547]">Attribution: {img.attribution}</p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[#695547]">{img.image_id}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Source References & Tracking */}
      <section className="mt-8 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
        <div className="flex items-center justify-between gap-4 border-b border-[#E2D9C8] pb-4">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-[#7D5A1C]" aria-hidden="true" />
            <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
              Source References &amp; Audit Status
            </h2>
          </div>
          <span className="font-mono text-xs text-[#695547] tabular-nums">
            {monument.sourceReferences.filter((s) => s.verificationStatus === 'verified').length} verified ·{' '}
            {monument.sourceReferences.filter((s) => s.verificationStatus === 'unverified').length} unverified
          </span>
        </div>

        {monument.sourceReferences.length === 0 ? (
          <p className="mt-4 text-sm text-[#695547]">
            No authoritative source URLs have been verified for this monument record yet. All
            factual historical and architectural fields remain stored as <code>null</code> and
            marked as requiring verification.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {monument.sourceReferences.map((src) => (
              <div
                key={src.id}
                className="rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-4 text-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="font-serif text-base font-semibold text-[#2B1E16]">
                        {src.sourceTitle}
                      </h3>
                      <span
                        className={`font-mono text-[11px] uppercase tracking-wide ${
                          src.verificationStatus === 'verified'
                            ? 'text-[#7D5A1C]'
                            : 'text-[#7F1D1D]'
                        }`}
                      >
                        [{src.verificationStatus === 'verified' ? 'Verified' : 'Unverified Reference'}]
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[#695547]">
                      Publisher: {src.publisher} · Authoritative:{' '}
                      {src.authoritativeSource ? 'Yes' : 'No'} · Checked: {src.accessDate}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-4">
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16]"
                    >
                      <span>Primary URL</span>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                    {src.apiVerificationUrl && (
                      <a
                        href={src.apiVerificationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16]"
                      >
                        <span>UNESCO API Record</span>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>

                {src.verificationNote && (
                  <p className="mt-2.5 text-xs leading-relaxed text-[#695547]">
                    Audit Note: {src.verificationNote}
                  </p>
                )}

                <div className="mt-3 border-t border-[#E2D9C8] pt-3">
                  <p className="text-xs font-medium text-[#2B1E16]">
                    {src.verificationStatus === 'verified'
                      ? 'Facts Verified Against This Source:'
                      : 'Claimed Scope (Pending Verification):'}
                  </p>
                  <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-[#695547]">
                    {src.supportedInformation.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
