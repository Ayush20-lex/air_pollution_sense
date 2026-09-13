/**
 * Geospatial plume map.
 *
 * The view reads `?station=` for the overview's "Locate on map" links. The
 * Suspense boundary is kept from the Next route: GeoMapPanel lazy-loads the
 * Leaflet chunk, so without one the first paint lands on a blank frame.
 */
import * as React from 'react';
import { GeoMapView } from './geo/GeoMapView';

export default function TerminalGeoMap() {
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
