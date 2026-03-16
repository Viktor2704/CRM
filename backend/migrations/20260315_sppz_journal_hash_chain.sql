-- Migration: Add hash chain integrity columns to SPPZ journal entries (F-033)
-- Created: 2026-03-15

ALTER TABLE sppz_journal_entries ADD COLUMN IF NOT EXISTS prev_entry_hash TEXT;
ALTER TABLE sppz_journal_entries ADD COLUMN IF NOT EXISTS entry_hash TEXT;

-- Index for fast chain lookups: find the last fully_signed entry per direction
CREATE INDEX IF NOT EXISTS idx_sppz_journal_entries_hash_chain
    ON sppz_journal_entries (direction_id, customer_signed_at)
    WHERE status = 'fully_signed' AND deleted_at IS NULL AND entry_hash IS NOT NULL;
