import { useState } from 'react';
import { Menu, X } from 'lucide-react';

export type AppRoute =
  | { page: 'home' }
  | { page: 'identify' }
  | { page: 'explorer' }
  | { page: 'monument-detail'; monumentId: string }
  | { page: 'preservation'; compareIds?: string[] }
  | { page: 'discovery'; monumentId?: string }
  | { page: 'dataset' }
  | { page: 'about' };

interface NavbarProps {
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

const NAV_ITEMS: Array<{
  label: string;
  page: 'home' | 'identify' | 'explorer' | 'preservation' | 'discovery' | 'dataset' | 'about';
}> = [
  { label: 'Home', page: 'home' },
  { label: 'Identify', page: 'identify' },
  { label: 'Explorer', page: 'explorer' },
  { label: 'Preservation', page: 'preservation' },
  { label: 'Discovery', page: 'discovery' },
  { label: 'Dataset', page: 'dataset' },
  { label: 'About', page: 'about' },
];

export function Navbar({ currentRoute, onNavigate }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isNavActive = (page: string) => {
    if (page === 'explorer' && currentRoute.page === 'monument-detail') return true;
    return currentRoute.page === page;
  };

  const handleLinkClick = (
    page: 'home' | 'identify' | 'explorer' | 'preservation' | 'discovery' | 'dataset' | 'about'
  ) => {
    setMobileMenuOpen(false);
    onNavigate({ page });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#E2D9C8] bg-[#FAF7F0]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleLinkClick('home')}
          className="whitespace-nowrap shrink-0 cursor-pointer font-serif text-xl font-semibold tracking-tight text-[#2B1E16] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8B6624]"
        >
          Heritage Vision
        </button>

        {/* Zone 2: Single-line Navigation Links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-5 lg:gap-7 text-sm font-medium text-[#695547]"
        >
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(item.page);
            return (
              <button
                key={item.page}
                type="button"
                onClick={() => handleLinkClick(item.page)}
                className={`relative whitespace-nowrap shrink-0 cursor-pointer py-1 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8B6624] ${
                  active
                    ? 'text-[#2B1E16]'
                    : 'text-[#695547] hover:text-[#2B1E16]'
                }`}
              >
                {item.label}
                <span
                  className={`absolute inset-x-0 -bottom-0.5 h-[1.5px] bg-[#8B6624] transition-opacity duration-150 ${
                    active ? 'opacity-100' : 'opacity-0'
                  }`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary CTA + Mobile Drawer Trigger */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleLinkClick('identify')}
            className="hidden sm:inline-flex items-center justify-center whitespace-nowrap shrink-0 cursor-pointer rounded-md bg-[#7D5A1C] px-4 py-2 text-xs font-medium text-[#FAF7F0] transition-colors duration-150 hover:bg-[#654714] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B6624]"
          >
            Identify Monument
          </button>

          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#E2D9C8] text-[#2B1E16] md:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B6624]"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="border-t border-[#E2D9C8] bg-[#FAF7F0] px-4 py-4 md:hidden">
          <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isNavActive(item.page);
              return (
                <button
                  key={item.page}
                  type="button"
                  onClick={() => handleLinkClick(item.page)}
                  className={`flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[#F3EDE1] text-[#2B1E16]'
                      : 'text-[#695547] hover:bg-[#F3EDE1]/60 hover:text-[#2B1E16]'
                  }`}
                >
                  <span>{item.label}</span>
                  {active && <span className="text-xs text-[#7D5A1C]">Active</span>}
                </button>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
