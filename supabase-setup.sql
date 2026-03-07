-- =============================================
-- salesbirdie — Supabase Database Setup
-- Run this in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query)
-- =============================================

-- 1. Create the profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  full_name  TEXT NOT NULL,
  title      TEXT DEFAULT '',
  is_manager BOOLEAN DEFAULT FALSE,
  team_id    TEXT,
  parent_user_id TEXT,
  is_pending BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies

-- Anyone can read profiles (needed for team features, rankings, etc.)
CREATE POLICY "Profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (true);

-- Users can insert their own profile (sign-up flow)
CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (true);

-- Users can update their own profile
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (true);

-- Note: The policies above are permissive for the initial setup.
-- Once the app is working, you can tighten them to:
--   USING (auth.uid() = id) for own-profile operations
--   USING (team_id IN (SELECT team_id FROM profiles WHERE id = auth.uid()))
--     for team-level access.
