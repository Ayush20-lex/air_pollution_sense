import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './terminal.css';
import { TerminalShell } from '@/components/terminal/TerminalShell';

/**
 * The public terminal carries its own typography: Plus Jakarta Sans for
 * headings and large readouts, Inter for the little body copy there is. The
 * mono face (JetBrains) is inherited from the root layout, so numbers read the
 * same on both surfaces.
 */
const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AIR AQI Sense — Public Open Environmental Intelligence Terminal',
  description:
    'Read-only public terminal for the Delhi NCR air quality sensor mesh: live telemetry, pollutant spectrometry and geospatial plume tracking.',
};

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${display.variable} ${body.variable}`}>
      <TerminalShell>{children}</TerminalShell>
    </div>
  );
}
