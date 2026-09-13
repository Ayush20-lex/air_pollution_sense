import * as React from 'react';
import { motion } from 'framer-motion';

/**
 * Arrival animation for the terminal.
 *
 * The intro's hand-off curtain settles on this surface's own background, so
 * the content lifting in is the only visible cut between the two routes.
 * `MotionConfig reducedMotion="user"` in the root providers already neutralises
 * this for anyone who asks for reduced motion.
 */
export function TerminalEnter({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
