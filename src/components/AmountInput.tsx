import { useState, useEffect } from 'react';
import { formatAmountInput, parseAmountInput, amountToDisplay } from '../lib/numberFormat';

type AmountInputProps = {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

/**
 * Controlled text input that shows live thousand separators (period grouping,
 * comma decimals) while keeping the form value a plain number. Drop-in for the
 * Cash Flow "Amount" field; pair with an RHF <Controller>.
 */
export function AmountInput({ value, onChange, ...rest }: AmountInputProps) {
  const toDisplay = (v: number | undefined) =>
    v == null || v === 0 || Number.isNaN(v) ? '' : amountToDisplay(v);

  const [display, setDisplay] = useState(() => toDisplay(value));

  // Re-sync the visible string when the value changes from outside (e.g. form reset).
  useEffect(() => {
    if (parseAmountInput(display) !== value) {
      setDisplay(toDisplay(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const formatted = formatAmountInput(e.target.value);
        setDisplay(formatted);
        onChange(parseAmountInput(formatted));
      }}
      {...rest}
    />
  );
}
