'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Header } from './Header';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { InterventionDrawer } from './InterventionDrawer';
import { MapPanel } from '@/components/map/MapPanel';
import { Button } from '@/components/ui/button';
import { BarChart3, Map as MapIcon, PanelRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type MobileTab = 'telemetry' | 'map' | 'analysis';

/**
 * Desktop: three-column console (telemetry | spatial | coupling analysis).
 * Tablet: two columns with the analysis rail folded under.
 * Mobile: one column with a segmented switcher.
 */
export function Dashboard() {
  const [tab, setTab] = React.useState<MobileTab>('map');

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-dvh w-full flex-col bg-base"
    >
      <div className="pointer-events-none fixed inset-0 grid-bg opacity-40" />

      <Header />

      {/* mobile segmented control */}
      <div className="z-20 flex shrink-0 gap-1 border-b border-hairline/70 bg-surface/60 px-3 py-1.5 backdrop-blur-xl lg:hidden">
        <SegButton active={tab === 'telemetry'} onClick={() => setTab('telemetry')} icon={<BarChart3 className="size-3.5" />}>
          Telemetry
        </SegButton>
        <SegButton active={tab === 'map'} onClick={() => setTab('map')} icon={<MapIcon className="size-3.5" />}>
          Spatial
        </SegButton>
        <SegButton active={tab === 'analysis'} onClick={() => setTab('analysis')} icon={<PanelRight className="size-3.5" />}>
          Coupling
        </SegButton>
      </div>

      <div className="relative z-10 grid min-h-0 flex-1 gap-2 p-2 lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_minmax(300px,360px)]">
        {/* left rail */}
        <motion.section
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className={cn('min-h-0', tab !== 'telemetry' && 'hidden lg:block')}
        >
          <LeftPanel />
        </motion.section>

        {/* centre map */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.04 }}
          className={cn('min-h-0', tab !== 'map' && 'hidden lg:block')}
        >
          <MapPanel />
        </motion.section>

        {/* right rail */}
        <motion.section
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className={cn('min-h-0', tab !== 'analysis' && 'hidden lg:block')}
        >
          <RightPanel />
        </motion.section>
      </div>

      <InterventionDrawer />
    </motion.div>
  );
}

function SegButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? 'default' : 'ghost'}
      size="sm"
      onClick={onClick}
      className="flex-1 gap-1.5 font-mono text-2xs uppercase tracking-[0.16em]"
    >
      {icon}
      {children}
    </Button>
  );
}
