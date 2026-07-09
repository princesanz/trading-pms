// Vercel Edge serverless proxy for Yahoo Finance chart data.
// Browsers can't call query1.finance.yahoo.com directly (no CORS headers),
// so the hero ticker hits this relay instead.
//
//   GET /api/market-proxy?symbols=XAUUSD,DXY,BTC-USD,^GSPC,^JKSE
//   -> [{ symbol, price, changePercent }, ...]
//
// Each symbol is fetched independently and fails soft (price: null).

export const config = { runtime: 'edge' };

// Friendly symbol -> actual Yahoo Finance symbol. Anything not listed is
// passed through unchanged (this supports US tickers like AAPL and IDX tickers like BBCA.JK).
const YAHOO_SYMBOL: Record<string, string> = {
  // Gold: the FX-style 'XAUUSD=X' quote is unreliable and often omits a previous close,
  // leaving changePercent null (so the ticker showed no arrow). COMEX gold futures 'GC=F'
  // reliably returns both regularMarketPrice and previousClose. The hero shows spot price
  // from the internal feed and uses this only for the day-change %, which tracks spot closely.
  XAUUSD: 'GC=F',
  DXY: 'DX-Y.NYB',
};

type Quote = { symbol: string; price: number | null; changePercent: number | null };

async function fetchQuote(symbol: string): Promise<Quote> {
  const yh = YAHOO_SYMBOL[symbol] ?? symbol;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yh)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!res.ok) return { symbol, price: null, changePercent: null };
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price: number | null = typeof meta?.regularMarketPrice === 'number' ? meta.regularMarketPrice : null;
    const prev: number | null =
      typeof meta?.chartPreviousClose === 'number' ? meta.chartPreviousClose
      : typeof meta?.previousClose === 'number' ? meta.previousClose
      : null;
    const changePercent = price != null && prev ? ((price - prev) / prev) * 100 : null;
    return { symbol, price, changePercent };
  } catch {
    return { symbol, price: null, changePercent: null };
  }
}

export default async function handler(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const symbols = (searchParams.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return new Response(JSON.stringify({ error: 'missing ?symbols' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const quotes = await Promise.all(symbols.map(fetchQuote));

  return new Response(JSON.stringify(quotes), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
    },
  });
}
