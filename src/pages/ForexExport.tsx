import { usePortfolioData } from '../hooks/useSupabase';
import { ExportPanel, type ExportChoice } from '../components/ExportPanel';
import { cashFlowSection } from '../lib/exportUtils';
import { PageHeader } from '../components/adm/PageHeader';

export function ForexExport() {
  const { trades, cashFlows } = usePortfolioData();

  const choices: ExportChoice[] = [
    {
      key: 'trades',
      label: 'Trades (journal)',
      section: {
        sheetName: 'Trades',
        slug: 'trades',
        headers: ['Date', 'Instrument', 'Position', 'Lot', 'Entry', 'SL', 'TP', 'Commission/Swap', 'Net PnL', '% P/L', 'Saldo Akun', 'Status', 'Setup', 'Psychology', 'Notes'],
        rows: trades.map(t => ({
          Date: t.tanggal,
          Instrument: t.instrumen,
          Position: t.posisi,
          Lot: t.lot,
          Entry: t.harga_entry,
          SL: t.sl ?? '',
          TP: t.tp ?? '',
          'Commission/Swap': t.komisi_swap,
          'Net PnL': t.net_pnl ?? '',
          '% P/L': t.persen_profit_loss ?? '',
          'Saldo Akun': t.saldo_akun ?? '',
          Status: t.status,
          Setup: t.setup_tag?.name ?? '',
          Psychology: t.psychology_tag?.name ?? '',
          Notes: t.catatan ?? '',
        })),
      },
    },
    {
      key: 'cashflows',
      label: 'Cash Flows',
      section: cashFlowSection(cashFlows, 'Forex'),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader desk="forex" title="Export" sub="trades & cash flows · CSV / Excel" />
      <ExportPanel
        title="Export — Forex"
        description="Download your Forex trades and cash flows as CSV or Excel."
        desk="forex"
        buttonClass="bg-emerald-600 hover:bg-emerald-500"
        accentText="text-emerald-400"
        choices={choices}
      />
    </div>
  );
}
