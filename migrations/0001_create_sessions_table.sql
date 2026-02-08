-- Migration: Create sessions table for Shopify app authentication
-- This table stores OAuth session data for Shopify stores

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  state TEXT NOT NULL,
  isOnline INTEGER NOT NULL DEFAULT 0,
  scope TEXT,
  expires INTEGER,
  accessToken TEXT NOT NULL,
  userId INTEGER,
  firstName TEXT,
  lastName TEXT,
  email TEXT,
  accountOwner INTEGER NOT NULL DEFAULT 0,
  locale TEXT,
  collaborator INTEGER DEFAULT 0,
  emailVerified INTEGER DEFAULT 0,
  refreshToken TEXT,
  refreshTokenExpires INTEGER
);

-- Index for fast shop lookups
CREATE INDEX IF NOT EXISTS idx_sessions_shop ON sessions(shop);

-- Index for cleaning up expired sessions
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
