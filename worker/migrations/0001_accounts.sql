-- worker/migrations/0001_accounts.sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  trial_ends_at INTEGER NOT NULL,
  terms_version TEXT,
  terms_accepted_at INTEGER,
  stripe_customer_id TEXT UNIQUE,
  subscription_status TEXT,
  current_period_end INTEGER,
  past_due_since INTEGER
);
CREATE TABLE stripe_events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
