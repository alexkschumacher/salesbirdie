-- =============================================
-- salesbirdie — Add user_state table
-- Run this in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query)
-- NOTE: profiles table already exists, this
-- only adds the new user_state table.
-- =============================================

-- 1. Create the user_state table (activity data per user per quarter)
CREATE TABLE IF NOT EXISTS user_state (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_email  TEXT NOT NULL,
  quarter_key TEXT NOT NULL,   -- e.g. "2026-Q1"
  state_data  JSONB NOT NULL,  -- full activity/budget/revenue state blob
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_email, quarter_key)
);

-- 2. Enable Row Level Security
ALTER TABLE user_state ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies for user_state

-- Users can read their own data
CREATE POLICY "Users can read own state"
  ON user_state FOR SELECT
  USING (user_email = (SELECT email FROM profiles WHERE id = auth.uid()));

-- Managers can read their team members' data
CREATE POLICY "Managers can read team state"
  ON user_state FOR SELECT
  USING (
    user_email IN (
      SELECT email FROM profiles
      WHERE team_id = (
        SELECT team_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

-- Users can insert their own data
CREATE POLICY "Users can insert own state"
  ON user_state FOR INSERT
  WITH CHECK (user_email = (SELECT email FROM profiles WHERE id = auth.uid()));

-- Users can update their own data
CREATE POLICY "Users can update own state"
  ON user_state FOR UPDATE
  USING (user_email = (SELECT email FROM profiles WHERE id = auth.uid()));

-- 4. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_state_email_quarter ON user_state (user_email, quarter_key);
