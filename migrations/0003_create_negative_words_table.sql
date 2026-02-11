CREATE TABLE IF NOT EXISTS negative_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  word TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_negative_words_shop ON negative_words(shop);
CREATE UNIQUE INDEX IF NOT EXISTS idx_negative_words_shop_word ON negative_words(shop, word);
