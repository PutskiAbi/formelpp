-- ============================================================
--  Trainingsplaner – Supabase Setup
--  Im selben Supabase-Projekt wie Formel++, im SQL-Editor ausführen
-- ============================================================

-- 1) Kategorien (frei definierbar, je eigene Farbe + aktive Feldgruppen)
CREATE TABLE IF NOT EXISTS categories (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  color        TEXT        NOT NULL DEFAULT '#3b82f6',
  field_flags  JSONB       NOT NULL DEFAULT '{}',  -- { rpe: bool, distance: bool, exercises: bool }
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Serientermine (Regel, aus der einzelne Sessions materialisiert werden)
CREATE TABLE IF NOT EXISTS series (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id       UUID        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title             TEXT        NOT NULL,
  byweekday         INT[]       NOT NULL DEFAULT '{}', -- 0=Mo .. 6=So
  start_time        TIME        NULL,
  duration_minutes  INT         NOT NULL DEFAULT 60,
  until_date        DATE        NULL,
  details           JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Einzelne Kalender-Einträge (geplant oder erledigt), auch aus Serien materialisiert
CREATE TABLE IF NOT EXISTS sessions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id         UUID        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  series_id           UUID        NULL REFERENCES series(id) ON DELETE SET NULL,
  title               TEXT        NOT NULL,
  date                DATE        NOT NULL,
  start_time          TIME        NULL,
  duration_minutes    INT         NOT NULL DEFAULT 60,
  status              TEXT        NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'skipped')),
  intensity           INT         NULL CHECK (intensity BETWEEN 1 AND 10),
  performance_rating  INT         NULL CHECK (performance_rating BETWEEN 1 AND 5),
  fitness_rating      INT         NULL CHECK (fitness_rating BETWEEN 1 AND 5),
  notes               TEXT        NOT NULL DEFAULT '',
  details             JSONB       NOT NULL DEFAULT '{}', -- distance_km, pace, exercises[], ...
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4) Taktikblatt (gesammelte Erkenntnisse, optional an ein Training geknüpft)
CREATE TABLE IF NOT EXISTS tactic_notes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id   UUID        NULL REFERENCES sessions(id) ON DELETE SET NULL,
  category_id  UUID        NULL REFERENCES categories(id) ON DELETE SET NULL,
  content      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5) Row Level Security aktivieren
ALTER TABLE categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE series       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tactic_notes ENABLE ROW LEVEL SECURITY;

-- 6) Policies – jeweils nur eigene Einträge sichtbar/veränderbar
CREATE POLICY "Nur eigene Kategorien"
  ON categories FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Nur eigene Serien"
  ON series FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Nur eigene Sessions"
  ON sessions FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Nur eigene Taktik-Notizen"
  ON tactic_notes FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 7) Indizes für Kalenderabfragen
CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tactic_notes_user  ON tactic_notes(user_id, created_at DESC);
