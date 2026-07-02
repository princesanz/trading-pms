-- ==========================================
-- Migration: Add market column to stock_transactions and stock_holdings
-- Run this in Supabase SQL Editor
-- ==========================================

-- Step 1: Create the enum type (skip if already created)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_market') THEN
        CREATE TYPE stock_market AS ENUM ('IDX', 'US', 'CRYPTO');
    END IF;
END$$;

-- Step 2: Add market column to stock_transactions (default IDX for existing rows)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_transactions' AND column_name = 'market'
    ) THEN
        ALTER TABLE stock_transactions ADD COLUMN market stock_market NOT NULL DEFAULT 'IDX';
    END IF;
END$$;

-- Step 3: Add market column to stock_holdings (default IDX for existing rows)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_holdings' AND column_name = 'market'
    ) THEN
        ALTER TABLE stock_holdings ADD COLUMN market stock_market NOT NULL DEFAULT 'IDX';
    END IF;
END$$;
