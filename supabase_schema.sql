-- ==========================================
-- PMS Phase 1: Forex & Commodities Desk
-- ==========================================

-- 1. Setup Tags Table
CREATE TABLE setup_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
);

-- Seed initial setup tags
INSERT INTO setup_tags (name) VALUES 
    ('Breakout'), 
    ('Breakdown');

-- 2. Psychology Tags Table
CREATE TABLE psychology_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
);

-- Seed initial psychology tags
INSERT INTO psychology_tags (name) VALUES 
    ('Tenang'), 
    ('Sesuai Trading Plan'), 
    ('FOMO'), 
    ('Marah'), 
    ('Ragu-ragu'), 
    ('Sabar'), 
    ('Takut'), 
    ('Revenge Trading'), 
    ('Overconfident');

-- 3. Account Settings Table
CREATE TABLE account_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    modal_awal NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Seed initial account setting (user can update this later)
INSERT INTO account_settings (modal_awal) VALUES (10000);

-- 4. Cash Flows Table
CREATE TYPE cash_flow_type AS ENUM ('Deposit', 'Withdraw', 'Transfer Masuk', 'Transfer Keluar');

CREATE TABLE cash_flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal DATE NOT NULL,
    tipe cash_flow_type NOT NULL,
    jumlah NUMERIC NOT NULL,
    desk TEXT NOT NULL DEFAULT 'Forex',
    desk_tujuan TEXT,
    catatan TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 5. Trades Table
CREATE TYPE trade_position AS ENUM ('Buy', 'Sell');
CREATE TYPE trade_status AS ENUM ('Open', 'Closed');

CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal DATE NOT NULL,
    instrumen TEXT NOT NULL,
    posisi trade_position NOT NULL,
    lot NUMERIC NOT NULL,
    harga_entry NUMERIC NOT NULL,
    sl NUMERIC,
    tp NUMERIC,
    risk_to_reward TEXT,
    komisi_swap NUMERIC DEFAULT 0,
    net_pnl NUMERIC,
    persen_profit_loss NUMERIC,
    setup UUID REFERENCES setup_tags(id),
    psikologi UUID REFERENCES psychology_tags(id),
    saldo_akun NUMERIC,
    status trade_status NOT NULL DEFAULT 'Open',
    catatan TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 6. Dividends Table (Phase 2 schema)
CREATE TABLE dividends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal_cum_date DATE NOT NULL,
    tanggal_pembayaran DATE NOT NULL,
    emiten TEXT NOT NULL,
    jumlah_lembar NUMERIC NOT NULL,
    dividend_per_lembar NUMERIC NOT NULL,
    total_dividend NUMERIC GENERATED ALWAYS AS (jumlah_lembar * dividend_per_lembar) STORED,
    pajak NUMERIC DEFAULT 0,
    net_dividend NUMERIC GENERATED ALWAYS AS ((jumlah_lembar * dividend_per_lembar) - COALESCE(pajak, 0)) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- ==========================================
-- Security & RLS (Row Level Security)
-- ==========================================

ALTER TABLE setup_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE psychology_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all anon access setup_tags" ON setup_tags FOR ALL USING (true);
CREATE POLICY "Allow all anon access psychology_tags" ON psychology_tags FOR ALL USING (true);
CREATE POLICY "Allow all anon access account_settings" ON account_settings FOR ALL USING (true);
CREATE POLICY "Allow all anon access cash_flows" ON cash_flows FOR ALL USING (true);
CREATE POLICY "Allow all anon access trades" ON trades FOR ALL USING (true);
CREATE POLICY "Allow all anon access dividends" ON dividends FOR ALL USING (true);

-- ==========================================
-- Migration: Add status column to existing trades table
-- Run this ONLY if the trades table already exists without the status column
-- ==========================================
-- ALTER TABLE trades ADD COLUMN status trade_status NOT NULL DEFAULT 'Open';
