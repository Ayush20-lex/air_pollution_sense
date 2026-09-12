/**
 * A `next/dynamic` stand-in for this Vite app.
 *
 * The AirSense components were written for Next.js and lazy-load three things
 * that must not run during SSR: the r3f particle canvas, the Leaflet map, and
 * the dashboard itself. Vite has no SSR pass here, so `ssr: false` is a no-op —
 * but keeping the same signature means the call sites port over untouched
 * instead of each growing its own <Suspense> wrapper.
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

type DynamicOptions = {
  /** Accepted and ignored — this is a client-only bundle. */
  ssr?: boolean;
  loading?: () => ReactNode;
};

export default function dynamic<P extends object>(
  loader: () => Promise<ComponentType<P>>,
  options: DynamicOptions = {},
): ComponentType<P> {
  const Lazy = lazy(async () => ({ default: await loader() }));
  const renderLoading = options.loading;

  return function DynamicComponent(props: P) {
    return (
      <Suspense fallback={renderLoading ? <>{renderLoading()}</> : null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
