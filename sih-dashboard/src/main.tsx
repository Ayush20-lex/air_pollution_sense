import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// leaflet's stylesheet ships with NCRMap, which is lazy-loaded with the map chunk.
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
