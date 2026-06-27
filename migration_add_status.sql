-- ==========================================
-- Migration: Add trade status to existing trades table
-- Run this in Supabase SQL Editor if the trades table already exists
-- ==========================================

-- Step 1: Create the enum type (skip if already created)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trade_status') THEN
        CREATE TYPE trade_status AS ENUM ('Open', 'Closed');
    END IF;
END$$;

-- Step 2: Add the status column (skip if already exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trades' AND column_name = 'status'
    ) THEN
        ALTER TABLE trades ADD COLUMN status trade_status NOT NULL DEFAULT 'Open';
    END IF;
END$$;

-- Step 3: Backfill existing rows
-- Trades that already have a net_pnl filled in → mark as 'Closed'
-- Trades with null net_pnl → stay as 'Open' (the default)
UPDATE trades SET status = 'Closed' WHERE net_pnl IS NOT NULL;
UPDATE trades SET status = 'Open'  WHERE net_pnl IS NULL;
