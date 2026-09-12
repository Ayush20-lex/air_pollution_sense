import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './store/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surface tokens are driven by CSS variables so light/dark swap cleanly.
        base: 'rgb(var(--as-base) / <alpha-value>)',
        surface: 'rgb(var(--as-surface) / <alpha-value>)',
        elevated: 'rgb(var(--as-elevated) / <alpha-value>)',
        hairline: 'rgb(var(--as-hairline) / <alpha-value>)',
        ink: 'rgb(var(--as-ink) / <alpha-value>)',
        muted: 'rgb(var(--as-muted) / <alpha-value>)',
        faint: 'rgb(var(--as-faint) / <alpha-value>)',
        accent: 'rgb(var(--as-accent) / <alpha-value>)',
        // Fixed AQI semantics — identical in both themes so severity never lies.
        good: '#34C759',
        moderate: '#A3E635',
        warning: '#FFCC00',
        poor: '#FF9500',
        emergency: '#FF3B30',
        severe: '#A855F7',

        /**
         * AIR AQI Sense public terminal (`/terminal`). A self-contained,
         * dark-only Material-3 style ramp — literal values, not `--as-*`
         * variables, because this surface never follows the light/dark swap.
         */
        term: {
          primary: '#4edea3',
          'primary-container': '#10b981',
          'on-primary': '#003824',
          secondary: '#7bd0ff',
          'secondary-container': '#00a6e0',
          tertiary: '#d0bcff',
          bg: '#040e1a',
          surface: '#051424',
          'surface-lowest': '#010f1f',
          'surface-low': '#0d1c2d',
          'surface-c': '#122131',
          'surface-high': '#1c2b3c',
          'surface-highest': '#273647',
          ink: '#f1f5f9',
          'ink-variant': '#94a3b8',
          outline: '#64748b',
          'outline-variant': '#233549',
          error: '#ffb4ab',
          'error-container': '#93000a',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        // Terminal surface: display headings + body copy.
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        glass: '0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 18px 50px -20px rgb(0 0 0 / 0.55)',
        'glass-light': '0 1px 0 0 rgb(255 255 255 / 0.9) inset, 0 12px 32px -18px rgb(15 23 42 / 0.25)',
        glow: '0 0 0 1px rgb(var(--as-accent) / 0.35), 0 0 32px -6px rgb(var(--as-accent) / 0.55)',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(var(--as-accent) / 0.45)' },
          '50%': { boxShadow: '0 0 0 14px rgb(var(--as-accent) / 0)' },
        },
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        ticker: 'ticker 40s linear infinite',
        'fade-up': 'fade-up 0.4s ease-out both',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
