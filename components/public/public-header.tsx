import Link from 'next/link';

const NAV_LINKS = [
  { label: 'Capabilities', href: '/#capabilities' },
  { label: 'Mobile Apps', href: '/#mobile-access' },
  { label: 'Register School', href: '/register' },
  { label: 'Application Status', href: '/status' },
];

const LINK_CLASS =
  'hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0';

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/"
          className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0"
        >
          TaleemOS
        </Link>

        <nav
          aria-label="Main navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={LINK_CLASS}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            href="/login"
            className="rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 px-4 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
          >
            School Login
          </Link>

          {/* Mobile Menu - bina 'use client' ke, isliye halka hai */}
          <details className="relative md:hidden">
            <summary className="cursor-pointer list-none rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
              Menu
            </summary>
            <nav
              aria-label="Mobile navigation"
              className="absolute right-0 top-full mt-2 flex w-48 flex-col gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-lg"
            >
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}