import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppNav } from '@/components/navigation/AppNav';

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
          <AppNav />
        </header>
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
