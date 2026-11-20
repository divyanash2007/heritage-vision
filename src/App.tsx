import { useEffect, useState } from 'react';
import { Navbar, type AppRoute } from './components/Navbar';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';
import { IdentifyPage } from './pages/IdentifyPage';
import { ExplorerPage } from './pages/ExplorerPage';
import { MonumentDetailPage } from './pages/MonumentDetailPage';
import { PreservationPage } from './pages/PreservationPage';
import { DiscoveryPage } from './pages/DiscoveryPage';
import { DatasetManagerPage } from './pages/DatasetManagerPage';
import { AboutPage } from './pages/AboutPage';

function parseHashToRoute(): AppRoute {
  const rawHash = window.location.hash.replace(/^#/, '');
  if (!rawHash || rawHash === '/' || rawHash === '/home') {
    return { page: 'home' };
  }
  if (rawHash === '/identify') {
    return { page: 'identify' };
  }
  if (rawHash === '/explorer') {
    return { page: 'explorer' };
  }
  if (rawHash.startsWith('/explorer/')) {
    const monumentId = rawHash.slice('/explorer/'.length).trim();
    if (monumentId) {
      return { page: 'monument-detail', monumentId };
    }
    return { page: 'explorer' };
  }
  if (rawHash.startsWith('/preservation')) {
    const queryIdx = rawHash.indexOf('?');
    if (queryIdx !== -1) {
      const params = new URLSearchParams(rawHash.slice(queryIdx + 1));
      const compareParam = params.get('compare');
      const compareIds = compareParam
        ? compareParam
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
            .slice(0, 4)
        : undefined;
      return { page: 'preservation', compareIds };
    }
    return { page: 'preservation' };
  }
  if (rawHash.startsWith('/discovery')) {
    const queryIdx = rawHash.indexOf('?');
    if (queryIdx !== -1) {
      const params = new URLSearchParams(rawHash.slice(queryIdx + 1));
      const monumentId = params.get('monument') ?? undefined;
      return { page: 'discovery', monumentId };
    }
    return { page: 'discovery' };
  }
  if (rawHash === '/dataset') {
    return { page: 'dataset' };
  }
  if (rawHash === '/about') {
    return { page: 'about' };
  }
  return { page: 'home' };
}

function routeToHash(route: AppRoute): string {
  switch (route.page) {
    case 'home':
      return '#/home';
    case 'identify':
      return '#/identify';
    case 'explorer':
      return '#/explorer';
    case 'monument-detail':
      return `#/explorer/${encodeURIComponent(route.monumentId)}`;
    case 'preservation':
      return route.compareIds && route.compareIds.length > 0
        ? `#/preservation?compare=${route.compareIds.map((id) => encodeURIComponent(id)).join(',')}`
        : '#/preservation';
    case 'discovery':
      return route.monumentId
        ? `#/discovery?monument=${encodeURIComponent(route.monumentId)}`
        : '#/discovery';
    case 'dataset':
      return '#/dataset';
    case 'about':
      return '#/about';
  }
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseHashToRoute());

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHashToRoute());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (nextRoute: AppRoute) => {
    const nextHash = routeToHash(nextRoute);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    } else {
      setRoute(nextRoute);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF7F0] text-[#2B1E16]">
      <Navbar currentRoute={route} onNavigate={navigate} />

      <main className="flex-1">
        {route.page === 'home' && <HomePage onNavigate={navigate} />}
        {route.page === 'identify' && <IdentifyPage onNavigate={navigate} />}
        {route.page === 'explorer' && <ExplorerPage onNavigate={navigate} />}
        {route.page === 'monument-detail' && (
          <MonumentDetailPage monumentId={route.monumentId} onNavigate={navigate} />
        )}
        {route.page === 'preservation' && (
          <PreservationPage initialCompareIds={route.compareIds} onNavigate={navigate} />
        )}
        {route.page === 'discovery' && (
          <DiscoveryPage initialMonumentId={route.monumentId} onNavigate={navigate} />
        )}
        {route.page === 'dataset' && <DatasetManagerPage onNavigate={navigate} />}
        {route.page === 'about' && <AboutPage onNavigate={navigate} />}
      </main>

      <Footer onNavigate={navigate} />
    </div>
  );
}
