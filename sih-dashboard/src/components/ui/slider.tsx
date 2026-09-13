
import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { accentColor?: string }
>((
  { className, accentColor, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, ...props },
  ref,
) => (
  // The name is pulled out of props on purpose. Radix puts role="slider" on the
  // Thumb, not the Root, so an aria-label spread onto the Root lands on a
  // generic div and the control a screen reader actually focuses ends up with
  // no accessible name at all. Both call sites were passing one and neither was
  // reaching anything.
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none select-none items-center py-2', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-elevated ring-1 ring-inset ring-hairline/70">
      <SliderPrimitive.Range
        className="absolute h-full rounded-full"
        style={{
          background: accentColor
            ? `linear-gradient(90deg, ${accentColor}55, ${accentColor})`
            : 'linear-gradient(90deg, rgb(var(--as-accent) / 0.4), rgb(var(--as-accent)))',
        }}
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className="block h-4 w-4 rounded-full border-2 bg-surface shadow-glass ring-offset-base transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 active:scale-95 disabled:pointer-events-none"
      style={{ borderColor: accentColor ?? 'rgb(var(--as-accent))' }}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
