import { useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '../lib/utils';
import { exportCSV, exportXLSX, type ExportSection } from '../lib/exportUtils';

export type ExportChoice = { key: string; label: string; section: ExportSection };

type Props = {
  title: string;
  description: string;
  /** Used in the filename: 'forex' | 'crypto' | 'saham'. */
  desk: string;
  /** Tailwind classes for the download button (per-desk accent). */
  buttonClass: string;
  /** Tailwind ring/accent class for the format radios. */
  accentText: string;
  choices: ExportChoice[];
};

export function ExportPanel({ title, description, desk, buttonClass, accentText, choices }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    () => Object.fromEntries(choices.map(c => [c.key, true]))
  );
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');

  const selectedChoices = choices.filter(c => selected[c.key]);
  const nothingSelected = selectedChoices.length === 0;

  const handleDownload = () => {
    if (nothingSelected) return;
    const sections = selectedChoices.map(c => c.section);
    if (format === 'csv') exportCSV(desk, sections);
    else exportXLSX(desk, sections);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-slate-400 text-sm mt-1">{description}</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        {/* Dataset checkboxes */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-slate-300">Data to include</label>
          <div className="space-y-2">
            {choices.map(c => (
              <label key={c.key} className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!selected[c.key]}
                  onChange={e => setSelected(prev => ({ ...prev, [c.key]: e.target.checked }))}
                  className="w-4 h-4 accent-current bg-slate-950 border-slate-700 rounded"
                />
                <span className="text-sm text-slate-200">{c.label}</span>
                <span className="text-xs text-slate-500">({c.section.rows.length} row{c.section.rows.length !== 1 ? 's' : ''})</span>
              </label>
            ))}
          </div>
        </div>

        {/* Format selector */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-slate-300">Format</label>
          <div className="flex gap-4">
            {(['csv', 'xlsx'] as const).map(f => (
              <label key={f} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="export-format"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="w-4 h-4"
                />
                <span className={cn('text-sm', format === f ? accentText : 'text-slate-300')}>
                  {f === 'csv' ? 'CSV (.csv)' : 'Excel (.xlsx)'}
                </span>
              </label>
            ))}
          </div>
          {format === 'xlsx' && selectedChoices.length > 1 && (
            <p className="text-xs text-slate-500">Each dataset becomes its own sheet in the workbook.</p>
          )}
        </div>

        <button
          onClick={handleDownload}
          disabled={nothingSelected}
          className={cn('w-full flex items-center justify-center gap-2 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50', buttonClass)}
        >
          <Download className="w-4 h-4" />
          {nothingSelected ? 'Select at least one dataset' : 'Download'}
        </button>
      </div>
    </div>
  );
}
