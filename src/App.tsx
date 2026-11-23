import React, { useEffect, useState } from 'react';
import { Menu, Moon, Sun, Monitor, X } from 'lucide-react';
import { FortyEightCenter } from './components/FortyEightCenter';
import { GameCenter } from './components/GameCenter';
import { OwnerDashboard } from './components/OwnerDashboard';
import { PublicPortal, PublicSection } from './components/PublicPortal';
import { TRANSLATIONS } from './core/i18n';
import { LanguageCode, ThemeMode } from './core/types';

type ActiveRoute =
  | { view: 'public'; section: PublicSection }
  | { view: '48group' }
  | { view: 'games' }
  | { view: 'dashboard' };

export default function App() {
  const [route, setRoute] = useState<ActiveRoute>({ view: 'public', section: 'home' });
  const [language, setLanguage] = useState<LanguageCode>('id');
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const t = TRANSLATIONS[language];

  // Apply System / Light / Dark theme cleanly on <html>
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const shouldDark = theme === 'dark' || (theme === 'system' && prefersDark);
      root.classList.toggle('dark', shouldDark);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const navigate = (next: ActiveRoute) => {
    setRoute(next);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text wordmark */}
          <button
            type="button"
            onClick={() => navigate({ view: 'public', section: 'home' })}
            className="text-lg font-extrabold tracking-tight text-blue-700 dark:text-blue-400 whitespace-nowrap shrink-0"
          >
            Freya-san Hub
          </button>

          {/* Zone 2: 5 concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <button
              type="button"
              onClick={() => navigate({ view: 'public', section: 'features' })}
              className={`hover:text-blue-700 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'public' && route.section === 'features' ? 'text-blue-700 dark:text-blue-400 font-semibold' : ''
              }`}
            >
              {t.navFeatures}
            </button>
            <button
              type="button"
              onClick={() => navigate({ view: 'public', section: 'commands' })}
              className={`hover:text-blue-700 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'public' && route.section === 'commands' ? 'text-blue-700 dark:text-blue-400 font-semibold' : ''
              }`}
            >
              {t.navCommands}
            </button>
            <button
              type="button"
              onClick={() => navigate({ view: '48group' })}
              className={`hover:text-pink-600 dark:hover:text-pink-400 transition-colors whitespace-nowrap shrink-0 ${
                route.view === '48group' ? 'text-pink-600 dark:text-pink-400 font-semibold' : ''
              }`}
            >
              {t.nav48Group}
            </button>
            <button
              type="button"
              onClick={() => navigate({ view: 'games' })}
              className={`hover:text-blue-700 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'games' ? 'text-blue-700 dark:text-blue-400 font-semibold' : ''
              }`}
            >
              {t.navGames}
            </button>
            <button
              type="button"
              onClick={() => navigate({ view: 'public', section: 'docs' })}
              className={`hover:text-blue-700 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'public' && (route.section === 'docs' || route.section === 'status') ? 'text-blue-700 dark:text-blue-400 font-semibold' : ''
              }`}
            >
              {t.navDocs}
            </button>
          </nav>

          {/* Zone 3: 1 primary CTA + mobile menu toggle */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigate({ view: 'dashboard' })}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 hover:bg-blue-800 text-white transition-colors whitespace-nowrap shrink-0"
            >
              {t.navDashboard}
            </button>
            <button
              type="button"
              aria-label="Menu navigasi mobile"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4 flex flex-col gap-3 text-sm font-medium">
            <button type="button" onClick={() => navigate({ view: 'public', section: 'features' })} className="text-left py-1">{t.navFeatures}</button>
            <button type="button" onClick={() => navigate({ view: 'public', section: 'commands' })} className="text-left py-1">{t.navCommands}</button>
            <button type="button" onClick={() => navigate({ view: '48group' })} className="text-left py-1 text-pink-600 dark:text-pink-400">{t.nav48Group}</button>
            <button type="button" onClick={() => navigate({ view: 'games' })} className="text-left py-1">{t.navGames}</button>
            <button type="button" onClick={() => navigate({ view: 'public', section: 'docs' })} className="text-left py-1">{t.navDocs}</button>
            <button type="button" onClick={() => navigate({ view: 'public', section: 'status' })} className="text-left py-1">Status Layanan</button>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {route.view === 'public' && (
          <PublicPortal
            section={route.section}
            language={language}
            onNavigateSection={(section) => navigate({ view: 'public', section })}
            onOpen48Group={() => navigate({ view: '48group' })}
            onOpenGames={() => navigate({ view: 'games' })}
            onOpenDashboard={() => navigate({ view: 'dashboard' })}
          />
        )}
        {route.view === '48group' && <FortyEightCenter />}
        {route.view === 'games' && <GameCenter />}
        {route.view === 'dashboard' && (
          <OwnerDashboard token={ownerToken} onTokenChange={setOwnerToken} />
        )}
      </main>

      {/* Quiet Footer with Language & Theme Switchers */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="text-sm font-bold text-slate-900 dark:text-white">{t.footerRights}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Freya-san bot by Pak Ujan · Privasi terlindungi (nomor owner tidak dipublikasikan)
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => navigate({ view: 'public', section: 'status' })}
              className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-blue-700"
            >
              Status Layanan
            </button>

            {/* Language Selector */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(['id', 'en', 'ja'] as LanguageCode[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                    language === lang
                      ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Theme Selector (System, Light, Dark) */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                aria-label="Tema Sistem"
                onClick={() => setTheme('system')}
                className={`px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1 ${
                  theme === 'system' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" /> System
              </button>
              <button
                type="button"
                aria-label="Tema Terang"
                onClick={() => setTheme('light')}
                className={`px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1 ${
                  theme === 'light' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Sun className="w-3.5 h-3.5" /> Light
              </button>
              <button
                type="button"
                aria-label="Tema Gelap"
                onClick={() => setTheme('dark')}
                className={`px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1 ${
                  theme === 'dark' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Moon className="w-3.5 h-3.5" /> Dark
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
