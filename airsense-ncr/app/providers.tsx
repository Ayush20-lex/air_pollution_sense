'use client';

import { MotionConfig } from 'framer-motion';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {/* reducedMotion="user" makes every framer animation honour the OS setting */}
      <MotionConfig reducedMotion="user">
        {/* gate 17: hover waits ~800ms, keyboard focus opens instantly (Radix default) */}
        <TooltipProvider delayDuration={800} skipDelayDuration={300}>
          {children}
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
