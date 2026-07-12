/**
 * Admin design tokens — the ONLY source of visual constants for the admin
 * dashboard redesign. Every shared component derives its colors, type, radii,
 * and motion from here; no page defines its own.
 *
 * NAMESPACING: everything lands under the Tailwind `adm-` namespace
 * (bg-adm-bg0, text-adm-up, font-adm-data, …). The public gold landing's
 * tokens (ink/gold/bone/positive/negative/hairline + display/grotesk/data)
 * are FROZEN — this file only ever adds, never touches them.
 *
 * Palette provenance (2026-07-10): P&L pair luminance-equalized to ~8:1 on
 * bg0 (up 8.02:1, down 7.99:1, chroma-matched at OKLCH C≈0.151) and validated
 * with the dataviz palette validator on surface #0A0C0E — CVD separation
 * worst adjacent pair (up↔down) ΔE 12.8 under deuteranopia (protan higher,
 * tritan 36), chroma floor and contrast PASS. Color is never the sole
 * carrier of P&L meaning: formatters in ./format.ts always emit an explicit
 * +/− prefix.
 */

export const color = {
  // Surfaces — neutral graphite (deliberately not slate-blue, not public ink).
  bg0: '#0A0C0E', // app background
  bg1: '#101317', // panel / strip
  bg2: '#161A1F', // hover / raised rows
  // Hairlines — separation is borders, never shadows.
  line: 'rgba(232,234,237,0.08)',
  line2: 'rgba(232,234,237,0.14)', // stronger divider / focused border
  // Ink.
  ink: {
    hi: '#E8EAED', //  16.3:1 on bg0
    mid: '#A9B1B8', //  9.0:1 on bg0
    dim: '#7A828B', //  5.0:1 on bg0, 4.8:1 on bg1 — floor for micro-labels
  },
  // P&L pair — the only saturated colors allowed on data.
  up: '#2FBC7B', //  8.02:1 on bg0
  down: '#FC817A', //  7.99:1 on bg0
  upFill: 'rgba(47,188,123,0.12)', // chip / bar fills
  downFill: 'rgba(252,129,122,0.12)',
  // Desk identity — PageHeader label + tick ONLY, never on data values.
  desk: {
    overview: '#E8EAED',
    forex: '#E8C266', // gold — 11.5:1, OKLCH C 0.119 (above 0.10 gray floor)
    crypto: '#5FC6E4', // cyan — 10.0:1
    saham: '#A78BFA', // violet — 7.2:1
  },
  // Status (badges only, always paired with a text label).
  status: {
    live: '#2FBC7B',
    stale: '#E8C266',
    error: '#FC817A',
    neutral: '#7A828B',
  },
} as const;

export const font = {
  ui: "'IBM Plex Sans', system-ui, sans-serif",
  data: "'IBM Plex Mono', ui-monospace, monospace", // every numeral, timestamp, ticker
} as const;

/** [size, { lineHeight, letterSpacing? }] — dense terminal scale, px-locked. */
export const fontSize = {
  'adm-micro': ['11px', { lineHeight: '16px', letterSpacing: '0.08em' }], // uppercase labels
  'adm-xs': ['12px', { lineHeight: '18px' }],
  'adm-sm': ['13px', { lineHeight: '20px' }], // body
  'adm-base': ['14px', { lineHeight: '20px' }],
  'adm-lg': ['16px', { lineHeight: '24px' }],
  'adm-xl': ['20px', { lineHeight: '28px' }], // page title
  'adm-metric': ['22px', { lineHeight: '28px' }],
  'adm-metric-lg': ['28px', { lineHeight: '34px' }],
} as const;

export const radius = {
  'adm-sm': '4px', // inputs, badges
  adm: '6px', // panels
  'adm-lg': '8px', // hard maximum (CommandBar)
} as const;

export const motion = {
  /** The only transition duration allowed, and never on a live-tick path. */
  fast: '120ms',
} as const;

export const table = {
  rowHeight: 32, // px, dense default
  rowHeightCompact: 28,
  virtualizeOver: 100, // rows
} as const;

/** Tailwind `theme.extend` fragment — spread into tailwind.config.js. */
export const admTailwind = {
  colors: {
    adm: {
      bg0: color.bg0,
      bg1: color.bg1,
      bg2: color.bg2,
      line: color.line,
      line2: color.line2,
      'ink-hi': color.ink.hi,
      'ink-mid': color.ink.mid,
      'ink-dim': color.ink.dim,
      up: color.up,
      down: color.down,
      'up-fill': color.upFill,
      'down-fill': color.downFill,
      'desk-overview': color.desk.overview,
      'desk-forex': color.desk.forex,
      'desk-crypto': color.desk.crypto,
      'desk-saham': color.desk.saham,
    },
  },
  fontFamily: {
    'adm-ui': ['IBM Plex Sans', 'system-ui', 'sans-serif'],
    'adm-data': ['IBM Plex Mono', 'ui-monospace', 'monospace'],
  },
  fontSize,
  borderRadius: radius,
} as const;
