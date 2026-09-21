import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// leaflet's stylesheet ships with NCRMap, which is lazy-loaded with the map chunk.
import App from './App';
import { applyDeviceTier } from './lib/device-tier';

// Before first paint, so the stylesheet's cheap mode applies to the initial
// render rather than flashing the expensive version and then dropping it.
applyDeviceTier();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
