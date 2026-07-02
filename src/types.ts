export type SetupTag = {
  id: string;
  name: string;
};

export type PsychologyTag = {
  id: string;
  name: string;
};

export type AnalysisTag = {
  id: string;
  name: string;
};

export type AccountSettings = {
  id: string;
  modal_awal: number;
  modal_awal_crypto: number;
  updated_at: string;
};

export type CashFlowType = 'Deposit' | 'Withdraw' | 'Transfer Masuk' | 'Transfer Keluar';
export type AccountType = 'Funding' | 'Trading';

export type CashFlow = {
  id: string;
  tanggal: string;
  tipe: CashFlowType;
  jumlah: number;
  desk: string;
  desk_tujuan?: string;
  currency: string;
  account_type: AccountType;
  /** Optional link back to the record that originated this cash flow (e.g. a spot holding). Polymorphic — no FK. */
  related_id?: string;
  /** True for delete-reversal rows (offsetting Deposit/Withdraw from deleting a holding/transaction).
   *  These still affect account balances, but are NOT new capital — excluded from Modal Awal. */
  is_reversal?: boolean;
  /** True for internal trading-activity rows (Buy Withdraw / Sell Deposit, spot buy Withdraw).
   *  These affect balances but are NOT external capital — excluded from Modal Awal. */
  is_trading_proceeds?: boolean;
  catatan?: string;
  created_at: string;
};

/** Derives the correct currency code for a given desk */
export function getCurrencyForDesk(desk: string): string {
  return desk === 'Saham' ? 'IDR' : 'USD';
}

/**
 * Convert an amount between USD and IDR using an IDR-per-USD rate (e.g. 16000 = "1 USD = 16,000 IDR").
 * Same-currency pairs are returned unchanged, so callers can route 1:1 transfers through this too.
 * Only USD/IDR exist in this app today; any other pair falls back to 1:1.
 */
export function convertAmount(amount: number, from: string, to: string, usdToIdrRate: number): number {
  if (from === to) return amount;
  if (from === 'USD' && to === 'IDR') return amount * usdToIdrRate;
  if (from === 'IDR' && to === 'USD') return amount / usdToIdrRate;
  return amount;
}

/** Round a converted amount the way it is stored/displayed: IDR to whole rupiah, USD to cents. */
export function roundForCurrency(amount: number, currency: string): number {
  return currency === 'IDR' ? Math.round(amount) : Math.round(amount * 100) / 100;
}

/** Format an amount with its currency symbol (IDR → Rp1,000,000, USD → $62.50). */
export function formatCurrencyAmount(amount: number, currency: string): string {
  return currency === 'IDR'
    ? `Rp${Math.round(amount).toLocaleString()}`
    : `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type TradePosition = 'Buy' | 'Sell';
export type TradeStatus = 'Open' | 'Closed';

export type Trade = {
  id: string;
  tanggal: string;
  instrumen: string;
  posisi: TradePosition;
  lot: number;
  leverage: number;
  harga_entry: number;
  sl?: number;
  tp?: number;
  risk_to_reward?: string;
  komisi_swap: number;
  harga_exit?: number;
  tanggal_tutup?: string;
  net_pnl?: number;
  persen_profit_loss?: number;
  setup?: string;
  psikologi?: string;
  saldo_akun?: number;
  status: TradeStatus;
  catatan?: string;
  created_at: string;
  setup_tag?: SetupTag;
  psychology_tag?: PsychologyTag;
};

// --- Crypto Types ---

export type CryptoPosition = 'Long' | 'Short';
export type MarginMode = 'Cross' | 'Isolated';

export type CryptoSpotHolding = {
  id: string;
  tanggal_beli: string;
  coin: string;
  jumlah_koin: number;
  harga_beli_rata: number;
  exchange_wallet: string;
  catatan?: string;
  created_at: string;
};

/**
 * Realized sell of a spot holding. Append-only — once recorded, sell_price and
 * realized_pnl are immutable history. `harga_beli_rata_at_sell` is a snapshot of
 * the avg cost at sale time so realized P&L doesn't drift from later DCA buys.
 */
export type CryptoSpotSale = {
  id: string;
  tanggal: string;
  coin: string;
  jumlah_koin_sold: number;
  harga_jual: number;
  harga_beli_rata_at_sell: number;
  realized_pnl: number;
  catatan?: string;
  created_at: string;
};

export type CryptoFuturesTrade = {
  id: string;
  tanggal: string;
  coin: string;
  posisi: CryptoPosition;
  notional_usd: number;
  leverage: number;
  margin_mode: MarginMode;
  harga_entry: number;
  sl?: number;
  tp?: number;
  liquidation_price?: number;
  funding_rate_paid?: number;
  harga_exit?: number;
  tanggal_tutup?: string;
  net_pnl?: number;
  persen_profit_loss?: number;
  setup?: string;
  psikologi?: string;
  saldo_akun?: number;
  status: TradeStatus;
  catatan?: string;
  created_at: string;
  setup_tag?: SetupTag;
  psychology_tag?: PsychologyTag;
};

// --- Equities Types ---

export type StockTipe = 'Buy' | 'Sell';
export type StockMarket = 'IDX' | 'US' | 'CRYPTO';

export type StockTransaction = {
  id: string;
  tanggal: string;
  emiten: string;
  tipe: StockTipe;
  market: StockMarket;
  lot: number;
  harga: number;
  komisi: number;
  analysis_tag?: string; // UUID
  catatan?: string;
  created_at: string;
  // Joined field
  analysis_tag_obj?: AnalysisTag;
};

export type StockHolding = {
  id: string;
  emiten: string;
  market: StockMarket;
  total_lot: number;
  average_price: number;
  total_cost_basis: number;
  updated_at: string;
};

export type Dividend = {
  id: string;
  tanggal_cum_date: string;
  tanggal_pembayaran: string;
  emiten: string;
  jumlah_lembar: number;
  dividend_per_lembar: number;
  total_dividend: number;  // GENERATED ALWAYS
  pajak: number;
  net_dividend: number;    // GENERATED ALWAYS
  created_at: string;
};

// --- Contract size helpers (Forex) ---

export const CONTRACT_SIZES: Record<string, number> = {
  XAUUSD: 100,
  XAGUSD: 5000,
  DJI30: 5,
  NDX100: 20,
  SPX500: 50,
};

export const DEFAULT_CONTRACT_SIZE = 100_000;

export function getContractSize(instrument: string): number {
  const normalized = instrument.toUpperCase().trim();
  return CONTRACT_SIZES[normalized] ?? DEFAULT_CONTRACT_SIZE;
}
