-- ==========================================
-- Phase 2: Crypto Desk Migration
-- Run this in Supabase SQL Editor
-- ==========================================

-- 1. New enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crypto_position') THEN
        CREATE TYPE crypto_position AS ENUM ('Long', 'Short');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'margin_mode') THEN
        CREATE TYPE margin_mode AS ENUM ('Cross', 'Isolated');
    END IF;
END$$;

-- 2. Crypto Spot Holdings table
CREATE TABLE IF NOT EXISTS crypto_spot_holdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal_beli DATE NOT NULL,
    coin TEXT NOT NULL,
    jumlah_koin NUMERIC NOT NULL,
    harga_beli_rata NUMERIC NOT NULL,
    exchange_wallet TEXT NOT NULL,
    catatan TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- 3. Crypto Futures Trades table
CREATE TABLE IF NOT EXISTS crypto_futures_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tanggal DATE NOT NULL,
    coin TEXT NOT NULL,
    posisi crypto_position NOT NULL,
    notional_usd NUMERIC NOT NULL,
    leverage NUMERIC NOT NULL DEFAULT 1,
    margin_mode margin_mode NOT NULL DEFAULT 'Isolated',
    harga_entry NUMERIC NOT NULL,
    sl NUMERIC,
    tp NUMERIC,
    liquidation_price NUMERIC,
    funding_rate_paid NUMERIC DEFAULT 0,
    net_pnl NUMERIC,
    persen_profit_loss NUMERIC,
    setup UUID REFERENCES setup_tags(id),
    psikologi UUID REFERENCES psychology_tags(id),
    saldo_akun NUMERIC,
    status trade_status NOT NULL DEFAULT 'Open',
    catatan TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- 4. Add modal_awal_crypto to account_settings
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_settings' AND column_name = 'modal_awal_crypto'
    ) THEN
        ALTER TABLE account_settings ADD COLUMN modal_awal_crypto NUMERIC NOT NULL DEFAULT 0;
    END IF;
END$$;

-- 5. RLS with unique policy names
ALTER TABLE crypto_spot_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_futures_trades ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all anon access crypto_spot_holdings') THEN
        CREATE POLICY "Allow all anon access crypto_spot_holdings" ON crypto_spot_holdings FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all anon access crypto_futures_trades') THEN
        CREATE POLICY "Allow all anon access crypto_futures_trades" ON crypto_futures_trades FOR ALL USING (true);
    END IF;
END$$;
