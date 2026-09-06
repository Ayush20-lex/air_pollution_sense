import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
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
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
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
