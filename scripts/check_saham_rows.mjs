import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xhnondpeqzndphbagxfs.supabase.co',
  'sb_publishable_lAAAqOGx9TppnR_erYGdwA_mNROGehM'
);

async function check() {
  // 1. Fetch ALL Saham desk cash_flows rows
  const { data: allSaham, error } = await supabase
    .from('cash_flows')
    .select('id, tanggal, tipe, jumlah, catatan')
    .eq('desk', 'Saham')
    .order('tanggal', { ascending: true });

  if (error) { console.error('Query error:', error); return; }

  console.log(`Total Saham cash_flows rows: ${allSaham.length}`);

  // 2. Check which rows DON'T have catatan starting with "Buy " or "Sell "
  const nonTradeRows = allSaham.filter(row => {
    const c = row.catatan || '';
    return !c.startsWith('Buy ') && !c.startsWith('Sell ');
  });

  if (nonTradeRows.length === 0) {
    console.log('✅ ALL Saham rows match the Buy/Sell catatan pattern. Backfill is safe.');
  } else {
    console.log(`⚠️  Found ${nonTradeRows.length} Saham rows that do NOT match "Buy " or "Sell " pattern:`);
    nonTradeRows.forEach(r => {
      console.log(`  id=${r.id} | tanggal=${r.tanggal} | tipe=${r.tipe} | jumlah=${r.jumlah} | catatan="${r.catatan}"`);
    });
  }

  // 3. Also show the matched ones for verification
  const tradeRows = allSaham.filter(row => {
    const c = row.catatan || '';
    return c.startsWith('Buy ') || c.startsWith('Sell ');
  });
  console.log(`\nMatched "Buy/Sell" pattern: ${tradeRows.length} rows`);
}

check();
