-- ==========================================
-- Phase 3: Equities (Saham) Desk Migration
-- Run this in Supabase SQL Editor
-- ==========================================

-- 1. Analysis Tags (reference table)
CREATE TABLE IF NOT EXISTS analysis_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
);

INSERT INTO analysis_tags (name) VALUES
    ('Breakout'),
    ('Big Player Accumulation'),
    ('Strong Fundamental'),
    ('Dividend Play'),
    ('Technical Reversal')
ON CONFLICT (name) DO NOTHING;

-- 2. Stock transaction type enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_tipe') THEN
        CREATE TYPE stock_tipe AS ENUM ('Buy', 'Sell');
    END IF;
END$$;

-- 3. Stock Transactions table (source of truth)
CREATE TABLE IF NOT EXISTS stock_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal DATE NOT NULL,
    emiten TEXT NOT NULL,
    tipe stock_tipe NOT NULL,
    lot NUMERIC NOT NULL,
    harga NUMERIC NOT NULL,
    komisi NUMERIC DEFAULT 0,
    analysis_tag UUID REFERENCES analysis_tags(id),
    catatan TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- 4. Stock Holdings table (derived aggregate, recalculated by app)
CREATE TABLE IF NOT EXISTS stock_holdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emiten TEXT UNIQUE NOT NULL,
    total_lot NUMERIC NOT NULL DEFAULT 0,
    average_price NUMERIC NOT NULL DEFAULT 0,
    total_cost_basis NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- 5. RLS with unique policy names
ALTER TABLE analysis_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_holdings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all anon access analysis_tags') THEN
        CREATE POLICY "Allow all anon access analysis_tags" ON analysis_tags FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all anon access stock_transactions') THEN
        CREATE POLICY "Allow all anon access stock_transactions" ON stock_transactions FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all anon access stock_holdings') THEN
        CREATE POLICY "Allow all anon access stock_holdings" ON stock_holdings FOR ALL USING (true);
    END IF;
END$$;
