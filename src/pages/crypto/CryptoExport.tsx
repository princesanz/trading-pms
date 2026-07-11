import { useCryptoData } from '../../hooks/useCryptoData';
import { ExportPanel, type ExportChoice } from '../../components/ExportPanel';
import { cashFlowSection } from '../../lib/exportUtils';
import { PageHeader } from '../../components/adm/PageHeader';

export function CryptoExport() {
  const { futuresTrades, spotHoldings, spotSales, cashFlows } = useCryptoData();

  const choices: ExportChoice[] = [
    {
      key: 'futures',
      label: 'Futures Trades',
      section: {
        sheetName: 'Futures Trades',
        slug: 'futures-trades',
        headers: ['Date', 'Coin', 'Position', 'Notional USD', 'Leverage', 'Margin Mode', 'Entry', 'SL', 'TP', 'Liquidation', 'Funding Rate Paid', 'Net PnL', '% P/L', 'Saldo Akun', 'Status', 'Setup', 'Psychology', 'Notes'],
        rows: futuresTrades.map(t => ({
          Date: t.tanggal,
          Coin: t.coin,
          Position: t.posisi,
          'Notional USD': t.notional_usd,
          Leverage: t.leverage,
          'Margin Mode': t.margin_mode,
          Entry: t.harga_entry,
          SL: t.sl ?? '',
          TP: t.tp ?? '',
          Liquidation: t.liquidation_price ?? '',
          'Funding Rate Paid': t.funding_rate_paid ?? '',
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
      key: 'spot',
      label: 'Spot Holdings',
      section: {
        sheetName: 'Spot Holdings',
        slug: 'spot-holdings',
        headers: ['Purchase Date', 'Coin', 'Quantity', 'Avg Buy Price', 'Exchange/Wallet', 'Cost Basis', 'Notes'],
        rows: spotHoldings.map(h => ({
          'Purchase Date': h.tanggal_beli,
          Coin: h.coin,
          Quantity: h.jumlah_koin,
          'Avg Buy Price': h.harga_beli_rata,
          'Exchange/Wallet': h.exchange_wallet,
          'Cost Basis': h.jumlah_koin * h.harga_beli_rata,
          Notes: h.catatan ?? '',
        })),
      },
    },
    {
      key: 'spot-sales',
      label: 'Spot Sales (realized)',
      section: {
        sheetName: 'Spot Sales',
        slug: 'spot-sales',
        headers: ['Date', 'Coin', 'Qty Sold', 'Sell Price', 'Avg Cost @ Sell', 'Proceeds', 'Realized PnL', 'Notes'],
        rows: spotSales.map(s => ({
          Date: s.tanggal,
          Coin: s.coin,
          'Qty Sold': s.jumlah_koin_sold,
          'Sell Price': s.harga_jual,
          'Avg Cost @ Sell': s.harga_beli_rata_at_sell,
          Proceeds: s.jumlah_koin_sold * s.harga_jual,
          'Realized PnL': s.realized_pnl,
          Notes: s.catatan ?? '',
        })),
      },
    },
    {
      key: 'cashflows',
      label: 'Cash Flows',
      section: cashFlowSection(cashFlows, 'Crypto'),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader desk="crypto" title="Export" sub="futures · spot · cash flows · CSV / Excel" />
      <ExportPanel
        title="Export — Crypto"
        description="Download your futures trades, spot holdings, and cash flows as CSV or Excel."
        desk="crypto"
        buttonClass="bg-cyan-600 hover:bg-cyan-500"
        accentText="text-cyan-400"
        choices={choices}
      />
    </div>
  );
}
