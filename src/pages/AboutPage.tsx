import { ArrowDown, ArrowRight } from 'lucide-react';
import type { AppRoute } from '../components/Navbar';

interface AboutPageProps {
  onNavigate: (route: AppRoute) => void;
}

const TECH_STACK = [
  {
    layer: 'Frontend Interface',
    tools: 'React 19, TypeScript, Tailwind CSS, Lucide Icons, Motion',
    purpose: 'Responsive museum-grade catalogue, upload workbench, and transparent state display.',
  },
  {
    layer: 'Application Backend',
    tools: 'Node.js, Express, Multer, TypeScript',
    purpose: 'REST API gateway, binary image header validation, and clean separation from ML inference.',
  },
  {
    layer: 'Knowledge Base (Initial)',
    tools: 'Structured JSON Schema (20 Indian Heritage Sites)',
    purpose: 'Version-controlled schema enforcing placeholder transparency and citation attachment.',
  },
  {
    layer: 'Planned Visual Recognition',
    tools: 'OpenCLIP (ViT-B/32 or ViT-L/14) via independent inference service',
    purpose: 'Zero-paid-API cosine similarity matching with calibrated unknown-image rejection.',
  },
  {
    layer: 'Planned Grounded QA',
    tools: 'Source-grounded retrieval (RAG) over verified ASI / UNESCO documents',
    purpose: 'Strict citation-backed answers with deterministic refusal when evidence is insufficient.',
  },
];

export function AboutPage({ onNavigate }: AboutPageProps) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Page Title */}
      <div className="border-b border-[#E2D9C8] pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7D5A1C]">
          University AI / ML Project Documentation
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-[#2B1E16] sm:text-5xl">
          About HERITAGE VISION
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#695547]">
          Visual Heritage Recognition and Grounded Cultural Discovery Platform — engineered with
          strict separation between frontend presentation, backend validation, visual similarity
          inference, and verified cultural scholarship.
        </p>
      </div>

      {/* 01 & 02: Problem Statement and Objectives */}
      <div className="mt-12 grid gap-10 border-b border-[#E2D9C8] pb-12 md:grid-cols-2">
        <section>
          <p className="font-serif text-2xl font-semibold text-[#8B6624]">01.</p>
          <h2 className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16]">
            Problem Statement
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-[#695547]">
            General-purpose vision classifiers and unconstrained generative models frequently
            exhibit two critical failures in cultural heritage contexts: overconfident
            misclassification of out-of-distribution photographs (forcing a guess when presented
            with an unknown monument or non-heritage scene) and plausible-sounding historical
            hallucinations lacking verifiable citations.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[#695547]">
            Users, students, and researchers exploring India&apos;s architectural heritage require
            a platform that measures visual similarity transparently, declines uncertain inputs, and
            grounds cultural answers strictly in documented archival records.
          </p>
        </section>

        <section>
          <p className="font-serif text-2xl font-semibold text-[#8B6624]">02.</p>
          <h2 className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16]">
            Project Objectives
          </h2>
          <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-[#695547]">
            <li>
              <strong className="font-medium text-[#2B1E16]">1. Visual Recognition:</strong>{' '}
              Identify Indian heritage monuments from user-uploaded photographs using OpenCLIP
              embeddings and top-five cosine similarity ranking.
            </li>
            <li>
              <strong className="font-medium text-[#2B1E16]">2. Unknown Rejection:</strong>{' '}
              Implement calibrated similarity thresholds and top-2 margin checks to explicitly reject
              uncertain or non-monument images.
            </li>
            <li>
              <strong className="font-medium text-[#2B1E16]">3. Verified Knowledge Base:</strong>{' '}
              Maintain a structured repository covering history, architecture, cultural
              significance, geography, and preservation with explicit source attribution.
            </li>
            <li>
              <strong className="font-medium text-[#2B1E16]">4. Grounded QA &amp; Evaluation:</strong>{' '}
              Provide citation-backed cultural discovery that refuses unsupported claims, alongside
              measurable accuracy and rejection benchmarks.
            </li>
          </ul>
        </section>
      </div>

      {/* 03: Proposed Methodology */}
      <section className="mt-12 border-b border-[#E2D9C8] pb-12">
        <p className="font-serif text-2xl font-semibold text-[#8B6624]">03.</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16]">
          Proposed Methodology
        </h2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-5">
            <h3 className="font-serif text-lg font-semibold text-[#2B1E16]">
              Stage A: OpenCLIP Embedding Index
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[#695547]">
              Curate multi-angle, multi-lighting reference imagery for the 20 target Indian
              monuments. Extract L2-normalized OpenCLIP embeddings offline without paid external
              APIs and compute cosine similarity against uploaded user queries.
            </p>
          </div>
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-5">
            <h3 className="font-serif text-lg font-semibold text-[#2B1E16]">
              Stage B: Confidence &amp; Rejection Calibration
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[#695547]">
              Label outputs strictly as cosine similarity scores rather than calibrated
              probabilities. Categorize confidence tiers and reject inputs below threshold τ or
              with ambiguous top-1 vs. top-2 margins.
            </p>
          </div>
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-5">
            <h3 className="font-serif text-lg font-semibold text-[#2B1E16]">
              Stage C: Source-Grounded Discovery
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[#695547]">
              Restrict cultural question answering to verified excerpts from Archaeological Survey
              of India (ASI), UNESCO World Heritage dossiers, and scholarly texts, returning
              &ldquo;Insufficient Evidence&rdquo; whenever support is absent.
            </p>
          </div>
        </div>
      </section>

      {/* 04: Technology Stack */}
      <section className="mt-12 border-b border-[#E2D9C8] pb-12">
        <p className="font-serif text-2xl font-semibold text-[#8B6624]">04.</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16]">
          Technology Stack
        </h2>
        <div className="mt-6 overflow-x-auto rounded-lg border border-[#E2D9C8] bg-[#FDFBF7]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#E2D9C8] bg-[#F3EDE1]/60 text-xs font-medium text-[#695547]">
                <th className="px-5 py-3">Architectural Layer</th>
                <th className="px-5 py-3">Technologies</th>
                <th className="px-5 py-3">Role in System</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2D9C8]">
              {TECH_STACK.map((row) => (
                <tr key={row.layer}>
                  <td className="px-5 py-3.5 font-medium text-[#2B1E16]">{row.layer}</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-[#7D5A1C]">{row.tools}</td>
                  <td className="px-5 py-3.5 text-xs leading-relaxed text-[#695547]">
                    {row.purpose}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 05: System Architecture Overview */}
      <section className="mt-12 border-b border-[#E2D9C8] pb-12">
        <p className="font-serif text-2xl font-semibold text-[#8B6624]">05.</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16]">
          System Architecture Overview
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[#695547]">
          AI inference and knowledge verification remain decoupled from the React frontend behind
          typed Express REST endpoints.
        </p>

        <div className="mt-6 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
          <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex-1 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-4">
              <p className="font-mono text-[11px] uppercase text-[#7D5A1C]">Client Tier</p>
              <p className="mt-1 font-serif text-base font-semibold text-[#2B1E16]">
                React + TypeScript SPA
              </p>
              <p className="mt-1 text-xs text-[#695547]">
                Upload UI, Explorer Catalogue, Discovery Inquiry, Detail Views
              </p>
            </div>

            <ArrowRight className="hidden h-5 w-5 shrink-0 text-[#8B6624] md:block" aria-hidden="true" />
            <ArrowDown className="mx-auto h-5 w-5 shrink-0 text-[#8B6624] md:hidden" aria-hidden="true" />

            <div className="flex-1 rounded-md border border-[#C8A55B] bg-[#F3EDE1]/60 p-4">
              <p className="font-mono text-[11px] uppercase text-[#7D5A1C]">API Gateway</p>
              <p className="mt-1 font-serif text-base font-semibold text-[#2B1E16]">
                Node.js + Express Server
              </p>
              <p className="mt-1 text-xs text-[#695547]">
                Input &amp; Magic-Byte Validation, Error Handling, Service Adapters
              </p>
            </div>

            <ArrowRight className="hidden h-5 w-5 shrink-0 text-[#8B6624] md:block" aria-hidden="true" />
            <ArrowDown className="mx-auto h-5 w-5 shrink-0 text-[#8B6624] md:hidden" aria-hidden="true" />

            <div className="flex-1 space-y-3">
              <div className="rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-3.5">
                <p className="font-mono text-[11px] text-[#7D5A1C]">Knowledge Service</p>
                <p className="mt-0.5 text-xs font-medium text-[#2B1E16]">
                  JSON Knowledge Base (20 Sites)
                </p>
              </div>
              <div className="rounded-md border border-dashed border-[#C8A55B] bg-[#FAF7F0] p-3.5">
                <p className="font-mono text-[11px] text-[#7D5A1C]">Future ML Adapter</p>
                <p className="mt-0.5 text-xs font-medium text-[#2B1E16]">
                  OpenCLIP + Grounded RAG Service
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 06: Limitations and Future Scope */}
      <section className="mt-12">
        <p className="font-serif text-2xl font-semibold text-[#8B6624]">06.</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold text-[#2B1E16]">
          Current Limitations &amp; Future Scope
        </h2>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <h3 className="font-serif text-lg font-semibold text-[#2B1E16]">
              Milestone 1 Limitations (Honest Scope)
            </h3>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-[#695547]">
              <li>
                • Visual recognition inference (OpenCLIP) is not yet connected; the API validates
                uploads and returns a structured unconfigured state.
              </li>
              <li>
                • Monument knowledge records currently hold structured placeholders without
                ingested historical narratives or GIS coordinates.
              </li>
              <li>
                • Cultural Discovery intentionally returns an insufficient-evidence notice until
                verified documents are indexed.
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <h3 className="font-serif text-lg font-semibold text-[#2B1E16]">
              Milestone 2 &amp; Evaluation Roadmap
            </h3>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-[#695547]">
              <li>
                • Connect an OpenCLIP inference service over a curated, multi-view image benchmark
                for all 20 heritage sites.
              </li>
              <li>
                • Calibrate unknown-image rejection thresholds using an out-of-distribution test
                split and measure precision-recall trade-offs.
              </li>
              <li>
                • Ingest verified ASI / UNESCO source documents and evaluate citation precision in
                Cultural Discovery.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => onNavigate({ page: 'identify' })}
            className="cursor-pointer rounded-md bg-[#7D5A1C] px-5 py-2.5 text-sm font-medium text-[#FAF7F0] hover:bg-[#654714]"
          >
            Test Upload Workbench
          </button>
          <button
            type="button"
            onClick={() => onNavigate({ page: 'explorer' })}
            className="cursor-pointer rounded-md border border-[#C8A55B] bg-[#FDFBF7] px-5 py-2.5 text-sm font-medium text-[#2B1E16] hover:bg-[#F3EDE1]"
          >
            Browse 20 Monument Schemas
          </button>
        </div>
      </section>
    </div>
  );
}
