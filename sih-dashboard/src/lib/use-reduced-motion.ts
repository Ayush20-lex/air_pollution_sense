import * as React from 'react';

/**
 * Whether the OS asks for reduced motion.
 *
 * Three components had grown their own copy of this, each a useState seeded to
 * `false` and corrected from an effect. That pattern has two costs: the first
 * paint always claims motion is wanted and is then corrected, and every copy
 * trips the set-state-in-effect rule for a subscription React can already
 * express directly.
 *
 * useSyncExternalStore reads the query during render, so there is no wrong
 * first frame and no effect to lint. Framer's own useReducedMotion is
 * deliberately not used here: it honours MotionConfig, which this app sets to
 * `reducedMotion="user"`, and these callers need the raw OS preference for
 * non-framer work — a WebGL frame loop, a CSS transition duration.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  // matchMedia is absent in non-DOM environments; nothing to subscribe to.
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/** Server snapshot: assume motion is fine, matching the CSS default. */
function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
