import { useEquitiesData } from '../../hooks/useEquitiesData';
import { ExportPanel, type ExportChoice } from '../../components/ExportPanel';
import { cashFlowSection } from '../../lib/exportUtils';

export function SahamExport() {
  const { transactions, holdings, dividends, cashFlows } = useEquitiesData();

  const choices: ExportChoice[] = [
    {
      key: 'transactions',
      label: 'Transactions (buy/sell history)',
      section: {
        sheetName: 'Transactions',
        slug: 'transactions',
        headers: ['Date', 'Emiten', 'Type', 'Lot', 'Price', 'Commission', 'Value', 'Net Value', 'Analysis Tag', 'Notes'],
        rows: transactions.map(tx => {
          const value = tx.lot * 100 * tx.harga;
          const komisi = tx.komisi || 0;
          const netValue = tx.tipe === 'Buy' ? value + komisi : value - komisi;
          return {
            Date: tx.tanggal,
            Emiten: tx.emiten,
            Type: tx.tipe,
            Lot: tx.lot,
            Price: tx.harga,
            Commission: komisi,
            Value: value,
            'Net Value': netValue,
            'Analysis Tag': tx.analysis_tag_obj?.name ?? '',
            Notes: tx.catatan ?? '',
          };
        }),
      },
    },
    {
      key: 'holdings',
      label: 'Holdings (current portfolio snapshot)',
      section: {
        sheetName: 'Holdings',
        slug: 'holdings',
        headers: ['Emiten', 'Total Lot', 'Total Shares', 'Average Price', 'Total Cost Basis'],
        rows: holdings.map(h => ({
          Emiten: h.emiten,
          'Total Lot': h.total_lot,
          'Total Shares': h.total_lot * 100,
          'Average Price': h.average_price,
          'Total Cost Basis': h.total_cost_basis,
        })),
      },
    },
    {
      key: 'dividends',
      label: 'Dividends',
      section: {
        sheetName: 'Dividends',
        slug: 'dividends',
        headers: ['Cum Date', 'Payment Date', 'Emiten', 'Shares', 'Dividend/Share', 'Total Dividend', 'Tax', 'Net Dividend'],
        rows: dividends.map(d => ({
          'Cum Date': d.tanggal_cum_date,
          'Payment Date': d.tanggal_pembayaran,
          Emiten: d.emiten,
          Shares: d.jumlah_lembar,
          'Dividend/Share': d.dividend_per_lembar,
          'Total Dividend': d.total_dividend,
          Tax: d.pajak,
          'Net Dividend': d.net_dividend,
        })),
      },
    },
    {
      key: 'cashflows',
      label: 'Cash Flows',
      section: cashFlowSection(cashFlows, 'Saham'),
    },
  ];

  return (
    <ExportPanel
      title="Export — Saham"
      description="Download your transactions, holdings, dividends, and cash flows as CSV or Excel."
      desk="saham"
      buttonClass="bg-amber-600 hover:bg-amber-500"
      accentText="text-amber-400"
      choices={choices}
    />
  );
}
