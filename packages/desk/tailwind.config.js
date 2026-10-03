/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        obsidian: {
          950: '#07090E',
          900: '#0A0D14',
          850: '#0E121B',
          800: '#141824',
          700: '#1E2333',
        },
        canvas: {
          DEFAULT: '#F4F4F6',
          subtle: '#EBECEF',
        }
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.36)',
        'elevated': '0 20px 40px -15px rgba(0, 0, 0, 0.1)',
        'glow-emerald': '0 0 24px -4px rgba(16, 185, 129, 0.25)',
      },
    },
  },
  plugins: [],
};

