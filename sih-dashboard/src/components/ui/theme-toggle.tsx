
import * as React from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  // next-themes reports resolvedTheme as undefined until it has read storage,
  // so the icon is held back for one frame rather than rendering the wrong one
  // and correcting it.
  // oxlint-disable-next-line react/set-state-in-effect
  React.useEffect(() => setMounted(true), []);

  const dark = resolvedTheme !== 'light';

  return (
    <Hint label={dark ? 'Switch to light' : 'Switch to dark'}>
      <button
        type="button"
        aria-label="Toggle colour theme"
        onClick={() => setTheme(dark ? 'light' : 'dark')}
        className={cn(
          'relative flex h-7 w-[52px] items-center rounded-full border border-hairline bg-elevated/70 px-1 transition-colors hover:border-accent/50',
          className,
        )}
      >
        {mounted && (
          <motion.span
            layout
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-accent ring-1 ring-accent/40"
            style={{ marginLeft: dark ? 22 : 0 }}
          >
            {dark ? <Moon className="size-3" /> : <Sun className="size-3" />}
          </motion.span>
        )}
      </button>
    </Hint>
  );
}
