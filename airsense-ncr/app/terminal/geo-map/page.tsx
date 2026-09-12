import * as React from 'react';
import { GeoMapView } from '@/components/terminal/geo/GeoMapView';

/**
 * Geospatial plume map.
 *
 * The view reads `?station=` for the overview's "Locate on map" links, so it
 * needs a Suspense boundary — `useSearchParams` opts a route out of static
 * rendering without one.
 */
export default function GeoMapPage() {
  return (
    <React.Suspense fallback={<MapSkeleton />}>
      <GeoMapView />
    </React.Suspense>
  );
}

function MapSkeleton() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-2 border-term-outline-variant border-t-term-primary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-term-primary">
          Interpolating sensor mesh
        </span>
      </div>
    </div>
  );
}
