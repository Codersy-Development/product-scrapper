CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_products INTEGER NOT NULL DEFAULT 0,
  imported_products INTEGER NOT NULL DEFAULT 0,
  failed_products INTEGER NOT NULL DEFAULT 0,
  source_urls TEXT,
  settings_snapshot TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_import_batches_shop ON import_batches(shop);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);
