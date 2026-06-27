import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xhnondpeqzndphbagxfs.supabase.co',
  'sb_publishable_lAAAqOGx9TppnR_erYGdwA_mNROGehM'
);

async function migrate() {
  console.log('=== Funding/Trading Account Migration ===\n');

  // Step 1: Check current state
  const { data: allRows } = await supabase.from('cash_flows').select('id, tanggal, tipe, jumlah, desk, desk_tujuan, currency, catatan');
  console.log(`Total existing cash_flows rows: ${allRows?.length || 0}`);
  
  if (!allRows || allRows.length === 0) {
    console.log('No existing rows to backfill. Migration only needs the column added via Supabase Dashboard SQL Editor.');
    console.log('\nPlease run the following SQL in your Supabase Dashboard SQL Editor:');
    console.log(`
ALTER TABLE cash_flows 
  ADD COLUMN IF NOT EXISTS account_type text 
  CHECK (account_type IN ('Funding', 'Trading'))
  DEFAULT 'Funding';
    `);
    console.log('Then set NOT NULL:');
    console.log(`ALTER TABLE cash_flows ALTER COLUMN account_type SET NOT NULL;`);
    return;
  }

  // If there ARE rows, show what needs backfilling
  const sahamTradeRows = allRows.filter(r => r.desk === 'Saham' && r.catatan && (r.catatan.startsWith('Buy ') || r.catatan.startsWith('Sell ')));
  const fundingRows = allRows.filter(r => !(r.desk === 'Saham' && r.catatan && (r.catatan.startsWith('Buy ') || r.catatan.startsWith('Sell '))));
  const inflowRows = fundingRows.filter(r => r.tipe === 'Deposit' || r.tipe === 'Transfer Masuk');
  const outflowRows = fundingRows.filter(r => r.tipe === 'Withdraw' || r.tipe === 'Transfer Keluar');

  console.log(`\nBackfill plan:`);
  console.log(`  Saham trade rows → Trading: ${sahamTradeRows.length}`);
  console.log(`  Other rows → Funding: ${fundingRows.length}`);
  console.log(`  Auto-sweep inflows (will create 2 rows each): ${inflowRows.length}`);
  console.log(`  Auto-sweep outflows (will create 2 rows each): ${outflowRows.length}`);
  console.log(`  Total new sweep rows: ${(inflowRows.length + outflowRows.length) * 2}`);

  console.log('\n⚠️  Cannot run ALTER TABLE via Supabase JS client.');
  console.log('Please run the full SQL from scripts/migration_account_type.sql in your Supabase Dashboard SQL Editor.');
  console.log('\nShowing existing rows for reference:');
  allRows.forEach(r => {
    console.log(`  ${r.tanggal} | ${r.tipe.padEnd(16)} | ${r.desk.padEnd(8)} | ${r.jumlah} | ${r.catatan || ''}`);
  });
}

migrate();
