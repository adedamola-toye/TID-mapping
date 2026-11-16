import type { Config } from "tailwindcss";

/**
 * Design tokens are CSS variables (see src/app/globals.css) so the bank's exact brand palette
 * can be dropped in without touching components.
 */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: v("brand-50"),
          100: v("brand-100"),
          200: v("brand-200"),
          500: v("brand-500"),
          600: v("brand-600"),
          700: v("brand-700"),
          800: v("brand-800"),
          900: v("brand-900"),
        },
        accent: { 100: v("accent-100"), 500: v("accent-500"), 600: v("accent-600"), 700: v("accent-700") },
        ink: { DEFAULT: v("ink"), muted: v("ink-muted"), subtle: v("ink-subtle") },
        surface: { DEFAULT: v("surface"), raised: v("surface-raised"), sunken: v("surface-sunken") },
        line: { DEFAULT: v("line"), strong: v("line-strong") },
        ok: { 50: v("ok-50"), 700: v("ok-700") },
        warn: { 50: v("warn-50"), 700: v("warn-700") },
        bad: { 50: v("bad-50"), 600: v("bad-600"), 700: v("bad-700") },
        info: { 50: v("info-50"), 700: v("info-700") },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: { "2xs": ["0.6875rem", { lineHeight: "1rem" }] },
      borderRadius: { DEFAULT: "6px" },
      boxShadow: {
        card: "0 1px 2px rgb(16 24 20 / 0.04), 0 1px 1px rgb(16 24 20 / 0.03)",
        pop: "0 12px 32px -8px rgb(16 24 20 / 0.18), 0 2px 6px rgb(16 24 20 / 0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
