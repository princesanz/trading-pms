import { admTailwind } from './src/design/tokens';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Admin redesign namespace (adm-*) — additive only; the public gold
      // tokens below are FROZEN (the public landing depends on them).
      fontSize: admTailwind.fontSize,
      borderRadius: admTailwind.borderRadius,
      fontFamily: {
        display: ['Fraunces', 'serif'],
        grotesk: ['"Hanken Grotesk"', 'sans-serif'],
        data: ['"JetBrains Mono"', 'monospace'],
        ...admTailwind.fontFamily,
      },
      colors: {
        ...admTailwind.colors,
        // SANZ CAPITAL public "precious metals" theme (gold direction)
        ink: "#0B0A08",
        "ink-2": "#14110C",
        "ink-3": "#1B1710",
        gold: "#E8D199",
        "gold-deep": "#C9A86A",
        "gold-bright": "#F0D58C",
        steel: "#7F95A8",
        bone: "#EDE8DD",
        "bone-dim": "#9A938A",
        positive: "#7FB89A",
        negative: "#C77B5A",
        hairline: "rgba(237,232,221,0.10)",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
    },
  },
  plugins: [],
}
