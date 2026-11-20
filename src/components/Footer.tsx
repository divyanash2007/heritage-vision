import type { AppRoute } from './Navbar';

interface FooterProps {
  onNavigate: (route: AppRoute) => void;
}

export function Footer({ onNavigate }: FooterProps) {
  return (
    <footer className="mt-20 border-t border-[#E2D9C8] bg-[#F3EDE1]/60">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-6">
            <p className="font-serif text-lg font-semibold text-[#2B1E16]">
              HERITAGE VISION
            </p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-[#695547]">
              Visual Heritage Recognition and Grounded Cultural Discovery Platform. A university
              AI/ML research foundation designed for transparent OpenCLIP monument matching,
              unknown-image rejection, and citation-backed cultural exploration.
            </p>
          </div>

          <div className="md:col-span-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#695547]">
              Platform Sections
            </p>
            <ul className="mt-3 space-y-2 text-sm text-[#2B1E16]">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'identify' })}
                  className="cursor-pointer hover:text-[#7D5A1C] transition-colors"
                >
                  Image Identification
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'explorer' })}
                  className="cursor-pointer hover:text-[#7D5A1C] transition-colors"
                >
                  Heritage Explorer
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'preservation' })}
                  className="cursor-pointer hover:text-[#7D5A1C] transition-colors"
                >
                  Preservation &amp; Conservation
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'discovery' })}
                  className="cursor-pointer hover:text-[#7D5A1C] transition-colors"
                >
                  Cultural Discovery
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'dataset' })}
                  className="cursor-pointer hover:text-[#7D5A1C] transition-colors"
                >
                  Dataset Manager
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate({ page: 'about' })}
                  className="cursor-pointer hover:text-[#7D5A1C] transition-colors"
                >
                  About Project
                </button>
              </li>
            </ul>
          </div>

          <div className="md:col-span-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#695547]">
              Research Integrity
            </p>
            <p className="mt-3 text-xs leading-relaxed text-[#695547]">
              Milestone 1 builds the frontend architecture, Express API scaffolding, and 20-site
              structured JSON schema. No simulated predictions or unverified historical claims are
              displayed.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-[#E2D9C8] pt-6 text-xs text-[#695547] sm:flex-row sm:items-center sm:justify-between">
          <p>HERITAGE VISION — Academic AI/ML Foundation</p>
          <p>Structured Knowledge Base Schema · 20 Indian Heritage Sites</p>
        </div>
      </div>
    </footer>
  );
}
