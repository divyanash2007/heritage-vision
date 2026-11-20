import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Compass,
  Landmark,
  Loader2,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react';
import { fetchMonuments, fetchProjectStats } from '../lib/api';
import { FEATURED_MONUMENT_IDS, HERO_PLATE_IMAGE } from '../lib/monumentMedia';
import {
  checkFastApiBackendStatus,
  SUPPORTED_MONUMENT_DISPLAY_NAMES,
  type FastApiBackendStatus,
} from '../services/recognitionApi';
import type { MonumentRecord, ProjectStatistics } from '../types/heritage';
import type { AppRoute } from '../components/Navbar';
import { MonumentPlate } from '../components/MonumentPlate';

interface HomePageProps {
  onNavigate: (route: AppRoute) => void;
}

const PLATFORM_PILLARS = [
  {
    index: '01.',
    title: 'Visual Monument Recognition',
    meta: 'OpenCLIP ViT-B-32 · 3 Supported Classes',
    description:
      'Upload JPEG, PNG, or WebP photographs to query the live OpenCLIP FastAPI backend and inspect ranked cosine similarity percentages for Taj Mahal, Red Fort, and Qutub Minar.',
    actionLabel: 'Open Recognition Workbench',
    route: { page: 'identify' } as AppRoute,
    icon: ScanSearch,
  },
  {
    index: '02.',
    title: 'AI Heritage Assistant',
    meta: '20 Verified Monuments · Direct Source Links',
    description:
      'Ask natural-language questions on history, architecture, dynasties, UNESCO status, or conservation. Answers retrieve grounded knowledge-base fields with primary UNESCO and ASI citations.',
    actionLabel: 'Ask Heritage Assistant',
    route: { page: 'discovery' } as AppRoute,
    icon: BookOpenCheck,
  },
  {
    index: '03.',
    title: 'Preservation & Conservation Explorer',
    meta: '6-Facet Assessment · Side-by-Side Comparison',
    description:
      'Compare conservation status, statutory AMASR protection, environmental threats, structural challenges, and restoration initiatives across up to four Indian heritage monuments.',
    actionLabel: 'Explore Conservation Profiles',
    route: { page: 'preservation' } as AppRoute,
    icon: Landmark,
  },
];

const PIPELINE_WORKFLOW = [
  {
    index: '01.',
    title: 'Photograph Validation & Upload',
    stageStatus: 'Active',
    description:
      'Client and server checks validate JPEG, PNG, and WebP format constraints up to 10 MB before sending multipart FormData directly to POST /recognize.',
  },
  {
    index: '02.',
    title: 'OpenCLIP ViT-B-32 Matching',
    stageStatus: 'FastAPI Service (3 Sites)',
    description:
      'The connected OpenCLIP vision model returns cosine similarity scores across Taj Mahal, Red Fort, and Qutub Minar—displayed transparently as similarity percentages, not calibrated probabilities.',
  },
  {
    index: '03.',
    title: '6-Facet Conservation Profiling',
    stageStatus: 'Active (20 Sites)',
    description:
      'Each monument record tracks responsible custodians, statutory protection, historical deterioration, environmental threats, structural risks, and documented restoration initiatives.',
  },
  {
    index: '04.',
    title: 'Citation-Grounded Cultural Discovery',
    stageStatus: 'Active (Verified KB)',
    description:
      'Entity resolution, IDF-weighted lexical matching, and session context answer user inquiries strictly from verified records while flagging null or out-of-scope claims honestly.',
  },
];

export function HomePage({ onNavigate }: HomePageProps) {
  const [stats, setStats] = useState<ProjectStatistics | null>(null);
  const [featuredMonuments, setFeaturedMonuments] = useState<MonumentRecord[]>([]);
  const [backendStatus, setBackendStatus] = useState<FastApiBackendStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadHomeData() {
      const [statsResult, monumentsResult, clipResult] = await Promise.allSettled([
        fetchProjectStats(),
        fetchMonuments(),
        checkFastApiBackendStatus(6000),
      ]);

      if (!active) return;

      if (statsResult.status === 'fulfilled') {
        setStats(statsResult.value);
      }

      if (monumentsResult.status === 'fulfilled') {
        const featuredSet = new Set<string>(FEATURED_MONUMENT_IDS);
        setFeaturedMonuments(
          monumentsResult.value.monuments.filter((m) => featuredSet.has(m.id))
        );
      }

      if (clipResult.status === 'fulfilled') {
        setBackendStatus(clipResult.value);
      } else {
        setBackendStatus({
          reachable: false,
          project: null,
          status: null,
          recognitionEngine: null,
          supportedLabels: [],
          error: 'Recognition backend status check failed.',
        });
      }

      setLoading(false);
    }

    void loadHomeData();
    return () => {
      active = false;
    };
  }, []);

  const recognizedSites = [
    { id: 'taj-mahal', label: 'Taj Mahal' },
    { id: 'red-fort', label: 'Red Fort' },
    { id: 'qutub-minar', label: 'Qutub Minar' },
  ];

  return (
    <div>
      {/* Hero Section */}
      <section className="border-b border-[#E2D9C8] bg-[#FAF7F0]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="grid items-stretch gap-10 lg:grid-cols-12 lg:gap-12">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col justify-between lg:col-span-6"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7D5A1C]">
                  Visual Heritage Recognition · Grounded Cultural Archive
                </p>
                <h1 className="mt-4 font-serif text-4xl font-semibold leading-[1.08] tracking-tight text-[#2B1E16] sm:text-5xl lg:text-[3.35rem]">
                  Discover India&apos;s Heritage Through Verified AI
                </h1>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-[#695547]">
                  HERITAGE VISION unites visual monument recognition powered by OpenCLIP ViT-B-32
                  with a curated 20-monument archival knowledge base, conservation explorer, and
                  citation-grounded AI Heritage Assistant—presenting verified primary sources without
                  fabricated claims.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3.5">
                  <button
                    type="button"
                    onClick={() => onNavigate({ page: 'identify' })}
                    className="inline-flex min-h-[44px] cursor-pointer items-center gap-2.5 whitespace-nowrap shrink-0 rounded-md bg-[#7D5A1C] px-6 py-3 text-sm font-medium text-[#FAF7F0] transition-colors duration-150 hover:bg-[#654714] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B6624]"
                  >
                    <ScanSearch className="h-4 w-4" aria-hidden="true" />
                    <span>Identify Monument</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigate({ page: 'explorer' })}
                    className="inline-flex min-h-[44px] cursor-pointer items-center gap-2.5 whitespace-nowrap shrink-0 rounded-md border border-[#C8A55B] bg-[#FDFBF7] px-6 py-3 text-sm font-medium text-[#2B1E16] transition-colors duration-150 hover:bg-[#F3EDE1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B6624]"
                  >
                    <Compass className="h-4 w-4 text-[#7D5A1C]" aria-hidden="true" />
                    <span>Explore 20 Monuments</span>
                  </button>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#695547]">
                  <span>Experimental OpenCLIP Scope:</span>
                  {recognizedSites.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      onClick={() =>
                        onNavigate({ page: 'monument-detail', monumentId: site.id })
                      }
                      className="cursor-pointer font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 transition-colors hover:text-[#2B1E16]"
                    >
                      {site.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-10 grid gap-5 border-t border-[#E2D9C8] pt-5 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-[#2B1E16]">OpenCLIP Inference Service</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#695547]">
                    FastAPI <span className="font-mono">ViT-B-32</span> endpoint integrated for{' '}
                    {SUPPORTED_MONUMENT_DISPLAY_NAMES.join(', ')} using live cosine similarity.
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#2B1E16]">Grounded Research Suite</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#695547]">
                    20 curated monument dossiers with Wikimedia photographic galleries, 6-facet
                    conservation tracking, and cited Q&amp;A.
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col lg:col-span-6"
            >
              <figure className="flex h-full flex-col overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#FDFBF7]">
                <div className="relative min-h-[290px] flex-1 bg-[#EFE9DC] sm:min-h-[360px]">
                  <img
                    src={HERO_PLATE_IMAGE}
                    alt="Archival architectural study of an Indian sandstone and marble heritage colonnade courtyard"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>
                <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E2D9C8] px-4 py-3 font-serif text-xs italic text-[#695547]">
                  <span>
                    Fig. 1 — Architectural Courtyard Study · Reference Plate for Visual Heritage
                    Research
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate({ page: 'identify' })}
                    className="not-italic font-sans text-xs font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16] cursor-pointer"
                  >
                    Try Image Recognition
                  </button>
                </figcaption>
              </figure>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Operational Verification Ledger (Live Backend Health + Verified KB Counts) */}
      <section
        aria-label="Platform verification ledger"
        className="border-b border-[#E2D9C8] bg-[#F3EDE1]/65"
      >
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            <div className="border-[#E2D9C8] sm:border-r sm:pr-4">
              <p className="text-xs font-medium text-[#695547]">Monument Schemas Indexed</p>
              <p className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {loading ? '20' : (stats?.totalMonumentsInSchema ?? 20)}
              </p>
              <p className="mt-0.5 text-xs text-[#695547]">
                Verified historical &amp; conservation records
              </p>
            </div>

            <div className="border-[#E2D9C8] lg:border-r lg:pr-4">
              <p className="text-xs font-medium text-[#695547]">Regions Represented</p>
              <p className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {loading ? '10' : (stats?.statesAndTerritoriesCovered ?? 10)}
              </p>
              <p className="mt-0.5 text-xs text-[#695547]">Indian states &amp; territories</p>
            </div>

            <div className="border-[#E2D9C8] sm:border-r sm:pr-4">
              <p className="text-xs font-medium text-[#695547]">Verified Source Citations</p>
              <p className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16] tabular-nums">
                {loading ? '21' : (stats?.verifiedSourceCitationsCount ?? 21)}
              </p>
              <p className="mt-0.5 text-xs text-[#695547]">UNESCO, ASI &amp; govt sources</p>
            </div>

            <div>
              <p className="text-xs font-medium text-[#695547]">OpenCLIP Model Status</p>
              {backendStatus === null ? (
                <>
                  <div className="mt-1 flex items-center gap-2 text-[#7D5A1C]">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
                    <p className="font-serif text-xl font-semibold">Checking Service</p>
                  </div>
                  <p className="mt-0.5 text-xs text-[#695547]">
                    Verifying FastAPI OpenCLIP backend
                  </p>
                </>
              ) : backendStatus.reachable ? (
                <>
                  <div className="mt-1 flex items-center gap-2 text-[#166534]">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <p className="font-serif text-xl font-semibold">
                      Connected · {backendStatus.recognitionEngine ?? 'OpenCLIP ViT-B-32'}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs text-[#695547]">
                    Live inference (3 sites) · Real cosine scores
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-1 flex items-center gap-2 text-[#7D5A1C]">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <p className="font-serif text-xl font-semibold">Backend Unreachable</p>
                  </div>
                  <p className="mt-0.5 text-xs text-[#695547]">
                    FastAPI tunnel offline · Zero simulated scores
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Core Platform Modules */}
      <section className="border-b border-[#E2D9C8] bg-[#FAF7F0]">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7D5A1C]">
              Integrated Research Suite
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-[#2B1E16]">
              Three Core Capabilities
            </h2>
            <p className="mt-2.5 text-sm leading-relaxed text-[#695547]">
              Move seamlessly from image-based monument identification to verified archival
              research, side-by-side conservation analysis, and cited natural-language discovery.
            </p>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {PLATFORM_PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div
                  key={pillar.index}
                  className="flex flex-col justify-between rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6 transition-colors hover:border-[#C8A55B]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-[#695547]">
                      <span className="font-serif text-lg font-semibold text-[#8B6624] tabular-nums">
                        {pillar.index}
                      </span>
                      <Icon className="h-4 w-4 text-[#7D5A1C]" aria-hidden="true" />
                    </div>
                    <h3 className="mt-3 font-serif text-xl font-semibold text-[#2B1E16]">
                      {pillar.title}
                    </h3>
                    <p className="mt-1 font-mono text-[11px] text-[#7D5A1C]">{pillar.meta}</p>
                    <p className="mt-3 text-sm leading-relaxed text-[#695547]">
                      {pillar.description}
                    </p>
                  </div>

                  <div className="mt-6 border-t border-[#E2D9C8] pt-4">
                    <button
                      type="button"
                      onClick={() => onNavigate(pillar.route)}
                      className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-[#7D5A1C] transition-colors hover:text-[#2B1E16]"
                    >
                      <span>{pillar.actionLabel}</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Featured Indian Monuments */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 border-b border-[#E2D9C8] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7D5A1C]">
              Curated Archival Dossiers
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-[#2B1E16]">
              Featured Indian Monuments
            </h2>
          </div>

          <button
            type="button"
            onClick={() => onNavigate({ page: 'explorer' })}
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-[#7D5A1C] transition-colors hover:text-[#2B1E16]"
          >
            <span>View all 20 heritage records</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {featuredMonuments.map((monument) => (
            <article
              key={monument.id}
              className="group overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] transition-colors duration-150 hover:border-[#C8A55B]"
            >
              <button
                type="button"
                onClick={() => onNavigate({ page: 'monument-detail', monumentId: monument.id })}
                className="block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B6624]"
              >
                <MonumentPlate
                  monumentId={monument.id}
                  monumentName={monument.name}
                  accessionCode={monument.accessionCode}
                  category={monument.category}
                  className="aspect-[4/3] w-full border-b border-[#E2D9C8]"
                />
                <div className="p-5">
                  <p className="font-mono text-[11px] text-[#695547] tabular-nums">
                    {monument.accessionCode} · {monument.state}
                  </p>
                  <h3 className="mt-1.5 font-serif text-xl font-semibold text-[#2B1E16] transition-colors group-hover:text-[#7D5A1C]">
                    {monument.name}
                  </h3>
                  <p className="mt-1 text-xs text-[#695547]">
                    {monument.cityOrDistrict} · {monument.category}
                  </p>
                  <p className="mt-4 border-t border-[#E2D9C8] pt-3 text-xs text-[#7D5A1C]">
                    {
                      monument.sourceReferences.filter(
                        (s) => s.verificationStatus === 'verified'
                      ).length
                    }{' '}
                    Verified Source · Inspect Dossier
                  </p>
                </div>
              </button>
            </article>
          ))}
        </div>
      </section>

      {/* System Architecture & Scientific Integrity */}
      <section className="border-t border-[#E2D9C8] bg-[#F3EDE1]/45">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7D5A1C]">
              End-to-End Verification Pipeline
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-[#2B1E16]">
              How Heritage Vision Works
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#695547]">
              Visual inference, conservation profiling, and cited question answering operate across
              distinct verified layers so ungrounded claims are never presented as fact.
            </p>
          </div>

          <div className="mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {PIPELINE_WORKFLOW.map((step) => (
              <div
                key={step.index}
                className="flex flex-col justify-between rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6"
              >
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-serif text-2xl font-semibold text-[#8B6624] tabular-nums">
                      {step.index}
                    </span>
                    <span className="font-mono text-[11px] font-medium text-[#7D5A1C]">
                      {step.stageStatus}
                    </span>
                  </div>
                  <h3 className="mt-4 font-serif text-lg font-semibold text-[#2B1E16]">
                    {step.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-[#695547]">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col gap-4 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#7D5A1C]" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-[#2B1E16]">
                  Academic Integrity &amp; Model Transparency Charter
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[#695547]">
                  The active FastAPI OpenCLIP backend indexes Taj Mahal, Red Fort, and Qutub Minar
                  and never invents predictions when offline. Historical, UNESCO, and preservation
                  answers remain strictly bound to verified sources and explicitly disclose
                  unverified schema fields.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate({ page: 'dataset' })}
                className="cursor-pointer whitespace-nowrap rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-4 py-2 text-xs font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1]"
              >
                View Dataset Curation
              </button>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'about' })}
                className="cursor-pointer whitespace-nowrap rounded-md border border-[#C8A55B] px-4 py-2 text-xs font-medium text-[#2B1E16] transition-colors hover:bg-[#F3EDE1]"
              >
                Read Methodology
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
