'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavLink {
  href: '/' | '/runs/new' | '/settings';
  label: string;
  isActive: (pathname: string) => boolean;
}

const NAV_LINKS: readonly NavLink[] = [
  { href: '/', label: 'Harness Agents', isActive: (p) => p === '/' },
  { href: '/runs/new', label: 'New run', isActive: (p) => p.startsWith('/runs') },
  { href: '/settings', label: 'Settings', isActive: (p) => p.startsWith('/settings') },
];

export function AppNav() {
  const pathname = usePathname() ?? '/';
  return (
    <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4 text-sm">
      {NAV_LINKS.map((link, i) => {
        const active = link.isActive(pathname);
        const className = [
          // The first link doubles as the brand — slightly heavier weight.
          i === 0 ? 'tracking-tight' : '',
          active ? 'font-semibold opacity-100' : 'opacity-70 hover:opacity-100',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <Link key={link.href} href={link.href} className={className}>
            {link.label}
          </Link>
        );
      })}
      <span className="ml-auto rounded-full border border-current/20 px-2 py-0.5 text-xs opacity-60">
        Phase 5
      </span>
    </nav>
  );
}
