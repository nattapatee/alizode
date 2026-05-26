CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cwd TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lanes (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_kind TEXT NOT NULL,
    protocol TEXT NOT NULL,
    model TEXT NOT NULL,
    is_main INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Idle',
    cwd TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (id, workspace_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS lane_events (
    workspace_id TEXT NOT NULL,
    lane_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (workspace_id, lane_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_lane_events_lookup
    ON lane_events(workspace_id, lane_id, seq);

CREATE TABLE IF NOT EXISTS memory (
    workspace_id TEXT NOT NULL,
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, namespace, key)
);

CREATE TABLE IF NOT EXISTS peer_messages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    from_lane TEXT NOT NULL,
    to_lane TEXT NOT NULL,
    request TEXT NOT NULL,
    reply TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at INTEGER NOT NULL,
    replied_at INTEGER
);

CREATE TABLE IF NOT EXISTS review_requests (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    from_lane TEXT NOT NULL,
    to_lane TEXT NOT NULL,
    file_path TEXT NOT NULL,
    diff TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    verdict TEXT,
    comments TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at INTEGER NOT NULL,
    replied_at INTEGER
);

CREATE TABLE IF NOT EXISTS permission_requests (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    lane_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    detail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    decision TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER
);
