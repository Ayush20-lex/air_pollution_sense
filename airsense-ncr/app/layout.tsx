import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AirSense NCR — Coupled Forecasting System',
  description:
    'Two-way coupled meteorology-chemistry air quality forecasting console for the Delhi NCR region. Problem Statement ID26082 — NCMRWF / Ministry of Earth Sciences.',
  applicationName: 'AirSense NCR',
  keywords: ['AQI', 'PM2.5', 'WRF-Chem', 'NCMRWF', 'Delhi NCR', 'forecasting'],
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8FAFC' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0F17' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-base font-sans text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
