/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './mobile/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        page: 'var(--bg-page)',
        surface: {
          DEFAULT: 'var(--bg-surface)',
          hover: 'var(--bg-surface-hover)',
          subtle: 'var(--bg-surface-subtle)',
        },
        line: {
          DEFAULT: 'var(--border-main)',
          subtle: 'var(--border-subtle)',
        },
        txt: {
          heading: 'var(--text-heading)',
          body: 'var(--text-body)',
          muted: 'var(--text-muted)',
          dim: 'var(--text-dim)',
        },
        primary: {
          DEFAULT: '#15803D',
          dark: '#166534',
          light: '#DCFCE7',
          50: '#F0FDF4',
          100: '#DCFCE7',
          200: '#BBF7D0',
          300: '#86EFAC',
          400: '#4ADE80',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
          800: '#166534',
          900: '#14532D',
        },
        brand: {
          emerald: '#10B981',
          dark: '#064E3B',
          glow: 'rgba(16, 185, 129, 0.15)',
        },
        gold: {
          DEFAULT: '#D4A017',
          light: '#FEF3C7',
          dark: '#A16207',
        },
        status: {
          success: '#16A34A',
          'success-bg': '#DCFCE7',
          warning: '#D97706',
          'warning-bg': '#FEF3C7',
          error: '#DC2626',
          'error-bg': '#FEE2E2',
          info: '#2563EB',
          'info-bg': '#DBEAFE',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      borderRadius: {
        none: '0px',
        sm: '0.25rem',
        DEFAULT: '0.5rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
        full: '9999px',
        btn: '0.5rem',
        input: '0.5rem',
        card: '0.75rem',
        panel: '1rem',
        pill: '9999px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0, 0, 0, 0.08)',
        'card-dark': '0 2px 8px rgba(0, 0, 0, 0.4)',
        glow: '0 0 16px rgba(16, 185, 129, 0.2)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out forwards',
        'slide-up': 'slideUp 0.2s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
