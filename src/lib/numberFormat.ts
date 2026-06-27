/**
 * Amount-input formatting helpers for the Cash Flow forms.
 *
 * Display style is Indonesian/European, consistent with how the app renders
 * Rupiah elsewhere ("Rp1.000.000"):
 *   - "." groups thousands
 *   - "," is the decimal separator (for USD cents, e.g. "1.234.567,89")
 *
 * The stored/submitted value is always a plain JS number — these helpers only
 * govern what the user sees in the text input.
 */

/**
 * Format a raw, possibly partial, user-typed string into grouped display.
 * Keeps digits and the first comma (decimal sep); ignores any other character
 * (including periods the user types, since those are auto-inserted grouping).
 */
export function formatAmountInput(raw: string): string {
  const s = String(raw).replace(/[^\d,]/g, '');
  const firstComma = s.indexOf(',');

  // No decimal part yet — just group the integer digits.
  if (firstComma === -1) {
    return groupThousands(s);
  }

  const intPart = s.slice(0, firstComma);
  const decPart = s.slice(firstComma + 1).replace(/,/g, ''); // drop any extra commas
  const groupedInt = groupThousands(intPart);
  return `${groupedInt === '' ? '0' : groupedInt},${decPart}`;
}

/** Group an integer-digit string with "." every 3 digits, stripping leading zeros. */
function groupThousands(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Parse a formatted display string back to a number (or undefined if empty/invalid). */
export function parseAmountInput(display: string): number | undefined {
  const normalized = String(display)
    .replace(/\./g, '')   // remove thousand separators
    .replace(',', '.')    // decimal comma -> JS decimal point
    .replace(/[^\d.]/g, '');
  if (normalized === '' || normalized === '.') return undefined;
  const n = parseFloat(normalized);
  return Number.isNaN(n) ? undefined : n;
}

/** Seed the input's display string from a stored number. */
export function amountToDisplay(value: number): string {
  // JS numbers stringify with a "." decimal; route through the comma-style formatter.
  return formatAmountInput(String(value).replace('.', ','));
}
