import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Harness Agents',
  description: 'Local-first multi-agent workspace MVP',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-black/10 dark:border-white/10">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4 text-sm">
            <Link href="/" className="font-semibold tracking-tight">
              Harness Agents
            </Link>
            <Link href="/settings" className="opacity-70 hover:opacity-100">
              Settings
            </Link>
            <span className="ml-auto rounded-full border border-current/20 px-2 py-0.5 text-xs opacity-60">
              Phase 2
            </span>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
