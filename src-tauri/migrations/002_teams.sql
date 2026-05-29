CREATE TABLE IF NOT EXISTS team_presets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_preset_members (
    id          TEXT PRIMARY KEY,
    preset_id   TEXT NOT NULL REFERENCES team_presets(id) ON DELETE CASCADE,
    agent_kind  TEXT NOT NULL,
    model       TEXT NOT NULL,
    directive   TEXT NOT NULL,
    is_leader   INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    preset_id     TEXT REFERENCES team_presets(id),
    created_at    INTEGER NOT NULL
);

ALTER TABLE lanes ADD COLUMN team_id TEXT;
ALTER TABLE lanes ADD COLUMN directive TEXT NOT NULL DEFAULT '';
ALTER TABLE lanes ADD COLUMN is_leader INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lanes ADD COLUMN team_sort_order INTEGER NOT NULL DEFAULT 0;
