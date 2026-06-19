import type Database from "better-sqlite3";

type Migration = {
  name: string;
  sql: string;
};

const migrations: Migration[] = [
  {
    name: "001_initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    name: "002_categories",
    sql: `
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#6366f1',
        type TEXT NOT NULL DEFAULT 'expense' CHECK(type IN ('income', 'expense')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT OR IGNORE INTO categories (name, color, type) VALUES
        ('Prehrana & živila', '#22c55e', 'expense'),
        ('Plača', '#3b82f6', 'income'),
        ('Prevoz', '#f59e0b', 'expense'),
        ('Zabava & restavracije', '#ec4899', 'expense'),
        ('Zdravje & lekarna', '#ef4444', 'expense'),
        ('Stanovanje & režije', '#8b5cf6', 'expense'),
        ('Oblačila & moda', '#06b6d4', 'expense'),
        ('Varčevanje & investicije', '#10b981', 'income'),
        ('Ostali odhodki',  '#94a3b8', 'expense'),
        ('Ostali prihodki', '#6366f1', 'income');
    `
  },
  {
    name: "003_uploaded_files",
    sql: `
      CREATE TABLE IF NOT EXISTS uploaded_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_name TEXT NOT NULL,
        file_path TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'error')),
        transactions_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT
      );
    `
  },
  {
    name: "004_transactions",
    sql: `
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
        category_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE,
        FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
      CREATE INDEX IF NOT EXISTS idx_transactions_file_id ON transactions(file_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    `
  },
  {
    name: "005_clear_error_files",
    sql: `
      DELETE FROM uploaded_files WHERE status = 'error';
    `
  },
  {
    name: "006_category_rules",
    sql: `
      CREATE TABLE IF NOT EXISTS category_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL UNIQUE,
        category_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_category_rules_category_id ON category_rules(category_id);
    `
  },
  {
    name: "007_transactions_manual_flag",
    sql: `
      ALTER TABLE transactions ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    name: "008_transactions_prejemnik",
    sql: `
      ALTER TABLE transactions ADD COLUMN prejemnik TEXT NOT NULL DEFAULT '';
    `
  },
  {
    name: "009_unique_filename",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_uploaded_files_original_name
        ON uploaded_files(original_name);
    `
  },
  {
    name: "010_expanded_categories",
    sql: `
      INSERT OR IGNORE INTO categories (name, color, type) VALUES
        -- Expenses: Food & dining
        ('Restavracije & kavarne',        '#f43f5e', 'expense'),
        -- Expenses: Transport
        ('Gorivo',                         '#f97316', 'expense'),
        ('Avto & vzdrževanje',             '#eab308', 'expense'),
        ('Javni prevoz',                   '#0ea5e9', 'expense'),
        -- Expenses: Health
        ('Zdravnik & zobozdravnik',        '#fb7185', 'expense'),
        -- Expenses: Housing
        ('Elektrika & ogrevanje',          '#818cf8', 'expense'),
        ('Internet & telefon',             '#38bdf8', 'expense'),
        -- Expenses: Lifestyle
        ('Elektronika & tehnologija',      '#60a5fa', 'expense'),
        ('Zabava & prosti čas',            '#e879f9', 'expense'),
        ('Potovanja & počitnice',          '#34d399', 'expense'),
        ('Šport & fitnes',                 '#a3e635', 'expense'),
        ('Naročnine',                      '#a78bfa', 'expense'),
        ('Izobraževanje',                  '#64748b', 'expense'),
        ('Gospodinjstvo',                  '#78716c', 'expense'),
        ('Darila',                         '#f9a8d4', 'expense'),
        ('Zavarovanje',                    '#9ca3af', 'expense'),
        ('Bančne storitve & provizije',    '#a1a1aa', 'expense'),
        ('Otroci & šola',                  '#fbbf24', 'expense'),
        ('Hišni ljubimci',                 '#fb923c', 'expense'),
        -- Income
        ('Freelance & honorar',            '#059669', 'income'),
        ('Najem & nepremičnine',           '#0d9488', 'income'),
        ('Dividende & obresti',            '#16a34a', 'income'),
        ('Vračilo & kompenzacija',         '#0284c7', 'income'),
        ('Socialne pomoči & štipendija',   '#4338ca', 'income');
    `
  },
  {
    name: "011_distinct_category_colors",
    sql: `
      UPDATE categories SET color = CASE name
        -- Default categories (002)
        WHEN 'Prehrana & živila'            THEN '#26de81'
        WHEN 'Plača'                        THEN '#38bdf8'
        WHEN 'Prevoz'                       THEN '#ff9f43'
        WHEN 'Zabava & restavracije'        THEN '#f472b6'
        WHEN 'Zdravje & lekarna'            THEN '#ff6b81'
        WHEN 'Stanovanje & režije'          THEN '#818cf8'
        WHEN 'Oblačila & moda'              THEN '#2dd4bf'
        WHEN 'Varčevanje & investicije'     THEN '#10b981'
        WHEN 'Ostali odhodki'               THEN '#94a3b8'
        WHEN 'Ostali prihodki'              THEN '#a78bfa'
        -- Extended categories (010)
        WHEN 'Restavracije & kavarne'       THEN '#ff4757'
        WHEN 'Gorivo'                       THEN '#ffa502'
        WHEN 'Avto & vzdrževanje'           THEN '#f9ca24'
        WHEN 'Javni prevoz'                 THEN '#74b9ff'
        WHEN 'Zdravnik & zobozdravnik'      THEN '#ff6348'
        WHEN 'Elektrika & ogrevanje'        THEN '#a29bfe'
        WHEN 'Internet & telefon'           THEN '#45aaf2'
        WHEN 'Elektronika & tehnologija'    THEN '#0652dd'
        WHEN 'Zabava & prosti čas'          THEN '#e056fd'
        WHEN 'Potovanja & počitnice'        THEN '#1dd1a1'
        WHEN 'Šport & fitnes'              THEN '#badc58'
        WHEN 'Naročnine'                   THEN '#e67e22'
        WHEN 'Izobraževanje'               THEN '#fdcb6e'
        WHEN 'Gospodinjstvo'               THEN '#b2bec3'
        WHEN 'Darila'                       THEN '#fd79a8'
        WHEN 'Zavarovanje'                  THEN '#636e72'
        WHEN 'Bančne storitve & provizije'  THEN '#6c5ce7'
        WHEN 'Otroci & šola'               THEN '#ffd32a'
        WHEN 'Hišni ljubimci'              THEN '#00d2d3'
        WHEN 'Freelance & honorar'          THEN '#2ed573'
        WHEN 'Najem & nepremičnine'         THEN '#0abde3'
        WHEN 'Dividende & obresti'          THEN '#c0fb2d'
        WHEN 'Vračilo & kompenzacija'       THEN '#3c40c4'
        WHEN 'Socialne pomoči & štipendija' THEN '#b33fc0'
        ELSE color
      END;
    `
  },
  {
    name: "012_fix_duplicate_category_colors",
    sql: `
      UPDATE categories SET color = '#ff7f50' WHERE name = 'Amazon';
      UPDATE categories SET color = '#5352ed' WHERE name = 'Interactive Brokers';
      UPDATE categories SET color = '#a3e635' WHERE name = 'Crypto';
      UPDATE categories SET color = '#64748b' WHERE name = 'Dvigi na bankomatu';
      UPDATE categories SET color = '#e74c3c' WHERE name = 'Zdravnik & zobozdravnik';
      UPDATE categories SET color = '#1e9e5e' WHERE name = 'Freelance & honorar';
      UPDATE categories SET color = '#2e86de' WHERE name = 'Vračilo & kompenzacija';
    `
  },
  {
    name: "013_rules_conditions_and_lock",
    sql: `
      ALTER TABLE category_rules ADD COLUMN conditions TEXT;
      ALTER TABLE category_rules ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    name: "014_transactions_stanje",
    sql: `
      ALTER TABLE transactions ADD COLUMN stanje REAL;
    `
  },
  {
    // Statement period date (end-of-month), parsed from the IZP_NNN_YYYYMMDD_... filename.
    // Used to order transactions across files in true booking order: monthly statements
    // never overlap in the balance chain, so ordering by (statement_date, id-within-file)
    // reproduces the bank's chronological sequence — which calendar date alone cannot,
    // because value dates interleave across month boundaries.
    name: "015_uploaded_files_statement_date",
    sql: `
      ALTER TABLE uploaded_files ADD COLUMN statement_date TEXT;
      UPDATE uploaded_files
      SET statement_date =
        substr(original_name, 9, 4) || '-' || substr(original_name, 13, 2) || '-' || substr(original_name, 15, 2)
      WHERE substr(original_name, 9, 8) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';
      CREATE INDEX IF NOT EXISTS idx_uploaded_files_statement_date ON uploaded_files(statement_date);
    `
  },
  {
    // Split the combined "Dividende & obresti" income category into two distinct
    // categories: "Dividende" (renamed from the original, keeps its color and any
    // existing references) and a new "Obresti".
    name: "016_split_dividende_obresti",
    sql: `
      UPDATE categories SET name = 'Dividende' WHERE name = 'Dividende & obresti';
      INSERT OR IGNORE INTO categories (name, color, type) VALUES
        ('Obresti', '#facc15', 'income');
    `
  },
  {
    // Clear category assignments where the category type doesn't match the
    // transaction type (e.g. an income category on an expense transaction).
    // Transaction type is always determined by the amount sign from the bank
    // statement and must never be changed. Clearing the wrong category lets
    // the transaction be re-categorized correctly.
    name: "017_clear_mismatched_categories",
    sql: `
      UPDATE transactions
      SET category_id = NULL, is_manual = 0
      WHERE category_id IS NOT NULL
        AND type != (SELECT type FROM categories WHERE categories.id = transactions.category_id);
    `
  }
];

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const hasMigration = sqlite.prepare("SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1");
  const insertMigration = sqlite.prepare("INSERT INTO app_migrations (name) VALUES (?)");

  for (const migration of migrations) {
    const exists = hasMigration.get(migration.name);
    if (exists) {
      continue;
    }

    const applyMigration = sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      insertMigration.run(migration.name);
    });

    try {
      applyMigration();
    } catch (e) {
      // If the schema change was already applied outside the migration tracker
      // (e.g. ALTER TABLE ADD COLUMN on a column that already exists, or a
      // table that was created manually), record it as applied and continue.
      const msg = e instanceof Error ? e.message : String(e);
      const alreadyApplied =
        msg.includes("duplicate column name") ||
        msg.includes("already exists");
      if (alreadyApplied) {
        insertMigration.run(migration.name);
      } else {
        throw e;
      }
    }
  }
}
