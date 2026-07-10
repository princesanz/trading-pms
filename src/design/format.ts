/**
 * Numeric formatters for the admin redesign. Two invariants:
 *
 * 1. P&L / delta values ALWAYS carry an explicit sign (+ / −), so color is
 *    never the sole carrier of gain-vs-loss meaning (colorblind safety).
 *    U+2212 MINUS SIGN is used instead of ASCII hyphen — in IBM Plex Mono it
 *    is full-width and mirrors '+' exactly, so signed columns stay aligned.
 * 2. Values render in the mono data face with tabular digits (the font is
 *    monospaced; these functions only produce strings).
 *
 * Display-only. Never used in any balance/P&L computation.
 */

const MINUS = '−';

const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtUsd(n: number): string {
  return `$${usdFmt.format(n)}`;
}

export function fmtIdr(n: number): string {
  return `Rp${Math.round(n).toLocaleString('en-US')}`;
}

/** Signed USD — sign is mandatory: +$120.00 / −$45.10. Zero renders +$0.00. */
export function fmtSignedUsd(n: number): string {
  return `${n < 0 ? MINUS : '+'}$${usdFmt.format(Math.abs(n))}`;
}

/** Signed IDR — sign is mandatory. */
export function fmtSignedIdr(n: number): string {
  return `${n < 0 ? MINUS : '+'}Rp${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

/** Signed percent — sign is mandatory: +1.25% / −0.80%. */
export function fmtSignedPct(n: number, digits = 2): string {
  return `${n < 0 ? MINUS : '+'}${Math.abs(n).toFixed(digits)}%`;
}

/** Unsigned percent for neutral ratios (win rate, allocation share). */
export function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/** Price with sensible precision: 5 dp under 100 (FX pairs), else 2 dp. */
export function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 5 : 2 });
}

export function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
