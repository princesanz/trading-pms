-- ==========================================
-- Migration: Add currency column to cash_flows
-- Run this in Supabase SQL Editor
-- ==========================================

-- 1. Add currency column with default 'USD' (safe default for existing Forex/Crypto rows)
ALTER TABLE cash_flows ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

-- 2. Backfill: Saham desk rows should be IDR
UPDATE cash_flows SET currency = 'IDR' WHERE desk = 'Saham' AND currency = 'USD';
