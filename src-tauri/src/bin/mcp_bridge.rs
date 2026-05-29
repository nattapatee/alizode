use std::io::{self, BufRead, Write};
use std::process::Command as ShellCommand;

use rusqlite::Connection;
use serde_json::{json, Value};

struct Config {
    workspace_id: String,
    lane_id: String,
    standalone: bool,
}

fn default_db_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = format!("{home}/Library/Application Support/com.alizode.app");
    let _ = std::fs::create_dir_all(&dir);
    format!("{dir}/alizode.db")
}

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, cwd TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lanes (
    id TEXT NOT NULL, workspace_id TEXT NOT NULL, agent_kind TEXT NOT NULL,
    protocol TEXT NOT NULL, model TEXT NOT NULL, is_main INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Idle', cwd TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (id, workspace_id));
CREATE TABLE IF NOT EXISTS lane_events (
    workspace_id TEXT NOT NULL, lane_id TEXT NOT NULL, seq INTEGER NOT NULL,
    ts INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (workspace_id, lane_id, seq));
CREATE TABLE IF NOT EXISTS memory (
    workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, key TEXT NOT NULL,
    value TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, namespace, key));
CREATE TABLE IF NOT EXISTS peer_messages (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, from_lane TEXT NOT NULL,
    to_lane TEXT NOT NULL, request TEXT NOT NULL, reply TEXT,
    status TEXT NOT NULL DEFAULT 'Pending', created_at INTEGER NOT NULL, replied_at INTEGER);
CREATE TABLE IF NOT EXISTS review_requests (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, from_lane TEXT NOT NULL,
    to_lane TEXT NOT NULL, file_path TEXT NOT NULL, diff TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '', verdict TEXT, comments TEXT,
    status TEXT NOT NULL DEFAULT 'Pending', created_at INTEGER NOT NULL, replied_at INTEGER);
CREATE TABLE IF NOT EXISTS permission_requests (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, lane_id TEXT NOT NULL,
    tool TEXT NOT NULL, detail TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending',
    decision TEXT, created_at INTEGER NOT NULL, decided_at INTEGER);
";

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let standalone = get_arg(&args, "--workspace-id").is_none();
    let db_path = get_arg(&args, "--db-path").unwrap_or_else(default_db_path);
    let workspace_id = get_arg(&args, "--workspace-id").unwrap_or_else(|| "standalone".to_string());
    let lane_id = get_arg(&args, "--lane-id").unwrap_or_else(|| "claude-code".to_string());

    let conn = Connection::open(&db_path).expect("failed to open database");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("failed to set pragmas");
    conn.execute_batch(SCHEMA).expect("failed to run schema migrations");

    if standalone {
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string());
        conn.execute(
            "INSERT OR IGNORE INTO workspaces (id, name, cwd, created_at) VALUES (?1, ?2, ?3, ?4)",
            (&workspace_id, "Standalone", &cwd, now_ms()),
        ).ok();
    }

    let config = Config { workspace_id, lane_id, standalone };

    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut writer = stdout.lock();

    loop {
        match read_message(&mut reader) {
            Ok(Some(msg)) => {
                if let Some(response) = handle_message(&conn, &config, &msg) {
                    write_message(&mut writer, &response);
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
}

fn get_arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn read_message(reader: &mut impl BufRead) -> io::Result<Option<Value>> {
    let mut header = String::new();
    let n = reader.read_line(&mut header)?;
    if n == 0 {
        return Ok(None);
    }

    if header.starts_with("Content-Length:") {
        let content_length: usize = header
            .trim_start_matches("Content-Length:")
            .trim()
            .parse()
            .unwrap_or(0);
        let mut blank = String::new();
        reader.read_line(&mut blank)?;
        let mut body = vec![0u8; content_length];
        reader.read_exact(&mut body)?;
        let v: Value = serde_json::from_slice(&body).unwrap_or_default();
        Ok(Some(v))
    } else if let Ok(v) = serde_json::from_str::<Value>(header.trim()) {
        Ok(Some(v))
    } else {
        Ok(None)
    }
}

fn write_message(writer: &mut impl Write, msg: &Value) {
    let body = serde_json::to_string(msg).unwrap();
    let _ = write!(writer, "Content-Length: {}\r\n\r\n{}", body.len(), body);
    let _ = writer.flush();
}

fn handle_message(conn: &Connection, config: &Config, msg: &Value) -> Option<Value> {
    let method = msg.get("method")?.as_str()?;
    let id = msg.get("id");

    match method {
        "initialize" => {
            let result = json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "alizode-mcp", "version": "0.1.0" }
            });
            Some(jsonrpc_ok(id, result))
        }
        "notifications/initialized" => None,
        "tools/list" => {
            Some(jsonrpc_ok(id, json!({ "tools": tool_definitions() })))
        }
        "tools/call" => {
            let params = msg.get("params")?;
            let tool_name = params.get("name")?.as_str()?;
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let result = execute_tool(conn, config, tool_name, &args);
            Some(jsonrpc_ok(id, result))
        }
        _ => Some(json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": -32601, "message": format!("unknown method: {method}") }
        })),
    }
}

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "alizode_bash",
            "description": "Execute a shell command in the workspace directory. Use this for all terminal operations like ls, mkdir, git, npm, cargo, etc.",
            "inputSchema": { "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The shell command to execute" }
                }, "required": ["command"] }
        }),
        json!({
            "name": "alizode_write",
            "description": "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
            "inputSchema": { "type": "object",
                "properties": {
                    "file_path": { "type": "string", "description": "Absolute path to the file" },
                    "content": { "type": "string", "description": "Content to write" }
                }, "required": ["file_path", "content"] }
        }),
        json!({
            "name": "alizode_edit",
            "description": "Edit a file by replacing old_string with new_string. The old_string must match exactly.",
            "inputSchema": { "type": "object",
                "properties": {
                    "file_path": { "type": "string", "description": "Absolute path to the file" },
                    "old_string": { "type": "string", "description": "Exact text to find and replace" },
                    "new_string": { "type": "string", "description": "Replacement text" }
                }, "required": ["file_path", "old_string", "new_string"] }
        }),
        json!({
            "name": "memory_get",
            "description": "Get a value from workspace memory",
            "inputSchema": { "type": "object",
                "properties": {
                    "namespace": { "type": "string" },
                    "key": { "type": "string" }
                }, "required": ["namespace", "key"] }
        }),
        json!({
            "name": "memory_set",
            "description": "Set a value in workspace memory",
            "inputSchema": { "type": "object",
                "properties": {
                    "namespace": { "type": "string" },
                    "key": { "type": "string" },
                    "value": { "type": "string" }
                }, "required": ["namespace", "key", "value"] }
        }),
        json!({
            "name": "memory_list",
            "description": "List all keys in a namespace",
            "inputSchema": { "type": "object",
                "properties": { "namespace": { "type": "string" } },
                "required": ["namespace"] }
        }),
        json!({
            "name": "peer_list",
            "description": "List all active lanes in the workspace (includes team_id, directive, is_leader)",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "team_info",
            "description": "Get your team context: team name, your role/directive, whether you are the leader, and the full member roster.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "peer_send",
            "description": "Send a message to another lane and wait for reply (sync, 5 min timeout)",
            "inputSchema": { "type": "object",
                "properties": {
                    "target": { "type": "string", "description": "Target lane ID" },
                    "message": { "type": "string" }
                }, "required": ["target", "message"] }
        }),
        json!({
            "name": "peer_reply",
            "description": "Reply to a peer_send message by ID",
            "inputSchema": { "type": "object",
                "properties": {
                    "message_id": { "type": "string", "description": "Peer message ID" },
                    "reply": { "type": "string" }
                }, "required": ["message_id", "reply"] }
        }),
        json!({
            "name": "review_request",
            "description": "Request a code review from another lane. Blocks until review is complete (5 min timeout).",
            "inputSchema": { "type": "object",
                "properties": {
                    "target": { "type": "string", "description": "Target lane ID" },
                    "file_path": { "type": "string", "description": "File path to review" },
                    "diff": { "type": "string", "description": "Diff or code to review" },
                    "instructions": { "type": "string", "description": "Review instructions" }
                }, "required": ["target", "file_path", "diff"] }
        }),
        json!({
            "name": "review_reply",
            "description": "Reply to a review request with verdict and comments",
            "inputSchema": { "type": "object",
                "properties": {
                    "review_id": { "type": "string", "description": "Review request ID" },
                    "verdict": { "type": "string", "enum": ["approved", "changes_requested"], "description": "Review verdict" },
                    "comments": { "type": "string", "description": "Review comments" }
                }, "required": ["review_id", "verdict", "comments"] }
        }),
    ]
}

fn execute_tool(conn: &Connection, config: &Config, tool: &str, args: &Value) -> Value {
    let ws = &config.workspace_id;
    match tool {
        "alizode_bash" => {
            let command = arg_str(args, "command");
            let detail = if command.len() > 200 {
                format!("Run: {}...", &command[..200])
            } else {
                format!("Run: {}", command)
            };
            match request_permission(conn, config, "Bash", &detail) {
                Some(ref d) if d == "allow_once" || d == "allow_session" => {
                    let cwd = get_lane_cwd(conn, &config.lane_id)
                        .unwrap_or_else(|| ".".to_string());
                    match ShellCommand::new("sh")
                        .arg("-c")
                        .arg(command)
                        .current_dir(&cwd)
                        .output()
                    {
                        Ok(output) => {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            let stderr = String::from_utf8_lossy(&output.stderr);
                            if stderr.is_empty() {
                                tool_ok(&stdout)
                            } else {
                                tool_ok(&format!("{}\n[stderr]\n{}", stdout, stderr))
                            }
                        }
                        Err(e) => tool_err(&format!("exec failed: {}", e)),
                    }
                }
                Some(_) => tool_err("Permission denied by user"),
                None => tool_err("Permission request timed out"),
            }
        }
        "alizode_write" => {
            let file_path = arg_str(args, "file_path");
            let content = arg_str(args, "content");
            let detail = format!("Write: {}", file_path);
            match request_permission(conn, config, "Write", &detail) {
                Some(ref d) if d == "allow_once" || d == "allow_session" => {
                    if let Some(parent) = std::path::Path::new(file_path).parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    match std::fs::write(file_path, content) {
                        Ok(_) => tool_ok(&format!("wrote {} bytes to {}", content.len(), file_path)),
                        Err(e) => tool_err(&format!("write failed: {}", e)),
                    }
                }
                Some(_) => tool_err("Permission denied by user"),
                None => tool_err("Permission request timed out"),
            }
        }
        "alizode_edit" => {
            let file_path = arg_str(args, "file_path");
            let old_string = arg_str(args, "old_string");
            let new_string = arg_str(args, "new_string");
            let detail = format!("Edit: {}", file_path);
            match request_permission(conn, config, "Edit", &detail) {
                Some(ref d) if d == "allow_once" || d == "allow_session" => {
                    match std::fs::read_to_string(file_path) {
                        Ok(content) => {
                            if !content.contains(old_string) {
                                return tool_err("old_string not found in file");
                            }
                            let updated = content.replacen(old_string, new_string, 1);
                            match std::fs::write(file_path, &updated) {
                                Ok(_) => tool_ok(&format!("edited {}", file_path)),
                                Err(e) => tool_err(&format!("write failed: {}", e)),
                            }
                        }
                        Err(e) => tool_err(&format!("read failed: {}", e)),
                    }
                }
                Some(_) => tool_err("Permission denied by user"),
                None => tool_err("Permission request timed out"),
            }
        }
        "memory_get" => {
            let ns = arg_str(args, "namespace");
            let key = arg_str(args, "key");
            match conn.query_row(
                "SELECT value FROM memory WHERE workspace_id=?1 AND namespace=?2 AND key=?3",
                [ws.as_str(), ns, key],
                |row| row.get::<_, String>(0),
            ) {
                Ok(val) => tool_ok(&val),
                Err(rusqlite::Error::QueryReturnedNoRows) => tool_ok("null"),
                Err(e) => tool_err(&e.to_string()),
            }
        }
        "memory_set" => {
            let ns = arg_str(args, "namespace");
            let key = arg_str(args, "key");
            let value = arg_str(args, "value");
            match conn.execute(
                "INSERT INTO memory (workspace_id,namespace,key,value,updated_at) VALUES(?1,?2,?3,?4,?5) \
                 ON CONFLICT(workspace_id,namespace,key) DO UPDATE SET value=?4,updated_at=?5",
                (ws.as_str(), ns, key, value, now_ms()),
            ) {
                Ok(_) => tool_ok("ok"),
                Err(e) => tool_err(&e.to_string()),
            }
        }
        "memory_list" => match list_memory(conn, ws, arg_str(args, "namespace")) {
            Ok(entries) => tool_ok(&serde_json::to_string(&entries).unwrap_or_default()),
            Err(e) => tool_err(&e.to_string()),
        },
        "peer_list" => match list_lanes(conn, ws) {
            Ok(lanes) => tool_ok(&serde_json::to_string(&lanes).unwrap_or_default()),
            Err(e) => tool_err(&e.to_string()),
        },
        "team_info" => match team_info(conn, ws, &config.lane_id) {
            Ok(info) => tool_ok(&serde_json::to_string(&info).unwrap_or_default()),
            Err(e) => tool_err(&e.to_string()),
        },
        "peer_send" => peer_send(conn, config, arg_str(args, "target"), arg_str(args, "message")),
        "peer_reply" => {
            let msg_id = arg_str(args, "message_id");
            let reply = arg_str(args, "reply");
            match conn.execute(
                "UPDATE peer_messages SET reply=?1, status='Replied', replied_at=?2 WHERE id=?3",
                (reply, now_ms(), msg_id),
            ) {
                Ok(0) => tool_err("peer message not found"),
                Ok(_) => tool_ok("replied"),
                Err(e) => tool_err(&e.to_string()),
            }
        }
        "review_request" => review_request_send(
            conn, config,
            arg_str(args, "target"),
            arg_str(args, "file_path"),
            arg_str(args, "diff"),
            arg_str(args, "instructions"),
        ),
        "review_reply" => {
            let review_id = arg_str(args, "review_id");
            let verdict = arg_str(args, "verdict");
            let comments = arg_str(args, "comments");
            let now = now_ms();
            match conn.execute(
                "UPDATE review_requests SET verdict=?1, comments=?2, status='Replied', replied_at=?3 WHERE id=?4",
                (verdict, comments, now, review_id),
            ) {
                Ok(0) => tool_err("review request not found"),
                Ok(_) => tool_ok(&format!("review replied: {verdict}")),
                Err(e) => tool_err(&e.to_string()),
            }
        }
        _ => tool_err(&format!("unknown tool: {tool}")),
    }
}

fn request_permission(conn: &Connection, config: &Config, tool: &str, detail: &str) -> Option<String> {
    if config.standalone {
        return Some("allow_once".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO permission_requests (id,workspace_id,lane_id,tool,detail,status,created_at) \
         VALUES(?1,?2,?3,?4,?5,'Pending',?6)",
        (&id, config.workspace_id.as_str(), config.lane_id.as_str(), tool, detail, now_ms()),
    ).ok()?;

    let timeout = std::time::Duration::from_secs(300);
    let poll = std::time::Duration::from_millis(200);
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            let _ = conn.execute(
                "UPDATE permission_requests SET status='TimedOut' WHERE id=?1",
                [&id],
            );
            return None;
        }
        match conn.query_row(
            "SELECT decision, status FROM permission_requests WHERE id=?1",
            [&id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        ) {
            Ok((Some(decision), ref s)) if s == "Decided" => return Some(decision),
            _ => {}
        }
        std::thread::sleep(poll);
    }
}

fn get_lane_cwd(conn: &Connection, lane_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT cwd FROM lanes WHERE id=?1",
        [lane_id],
        |row| row.get::<_, String>(0),
    ).ok().map(|cwd| {
        let home = std::env::var("HOME").unwrap_or_default();
        if cwd == "~" {
            home
        } else if let Some(rest) = cwd.strip_prefix("~/") {
            format!("{}/{}", home, rest)
        } else {
            cwd
        }
    })
}

fn peer_send(conn: &Connection, config: &Config, target: &str, message: &str) -> Value {
    let id = uuid::Uuid::new_v4().to_string();
    let ws = &config.workspace_id;
    let from = &config.lane_id;

    if let Err(e) = conn.execute(
        "INSERT INTO peer_messages (id,workspace_id,from_lane,to_lane,request,reply,status,created_at,replied_at) \
         VALUES(?1,?2,?3,?4,?5,NULL,'Pending',?6,NULL)",
        (&id, ws.as_str(), from.as_str(), target, message, now_ms()),
    ) {
        return tool_err(&format!("failed to create peer message: {e}"));
    }

    let timeout = std::time::Duration::from_secs(300);
    let poll = std::time::Duration::from_millis(100);
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            let _ = conn.execute("UPDATE peer_messages SET status='TimedOut' WHERE id=?1", [&id]);
            return tool_err("peer_send timed out (5 min)");
        }
        match conn.query_row(
            "SELECT reply, status FROM peer_messages WHERE id=?1",
            [&id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        ) {
            Ok((Some(reply), ref s)) if s == "Replied" => return tool_ok(&reply),
            Ok((_, ref s)) if s == "Failed" => return tool_err("peer delivery failed"),
            _ => {}
        }
        std::thread::sleep(poll);
    }
}

fn review_request_send(
    conn: &Connection,
    config: &Config,
    target: &str,
    file_path: &str,
    diff: &str,
    instructions: &str,
) -> Value {
    let id = uuid::Uuid::new_v4().to_string();
    let ws = &config.workspace_id;
    let from = &config.lane_id;
    let now = now_ms();

    if let Err(e) = conn.execute(
        "INSERT INTO review_requests (id,workspace_id,from_lane,to_lane,file_path,diff,instructions,\
         verdict,comments,status,created_at,replied_at) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,NULL,'Pending',?8,NULL)",
        (&id, ws.as_str(), from.as_str(), target, file_path, diff, instructions, now),
    ) {
        return tool_err(&format!("failed to create review request: {e}"));
    }

    let peer_msg = format!(
        "[REVIEW REQUEST id={}]\nFile: {}\nInstructions: {}\n\n{}",
        id, file_path, if instructions.is_empty() { "Review this code" } else { instructions }, diff
    );
    if let Err(e) = conn.execute(
        "INSERT INTO peer_messages (id,workspace_id,from_lane,to_lane,request,reply,status,created_at,replied_at) \
         VALUES(?1,?2,?3,?4,?5,NULL,'Pending',?6,NULL)",
        (&uuid::Uuid::new_v4().to_string(), ws.as_str(), from.as_str(), target, &peer_msg, now),
    ) {
        return tool_err(&format!("failed to send review to peer: {e}"));
    }

    let timeout = std::time::Duration::from_secs(300);
    let poll = std::time::Duration::from_millis(100);
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            let _ = conn.execute("UPDATE review_requests SET status='TimedOut' WHERE id=?1", [&id]);
            return tool_err("review_request timed out (5 min)");
        }
        match conn.query_row(
            "SELECT verdict, comments, status FROM review_requests WHERE id=?1",
            [&id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?)),
        ) {
            Ok((Some(verdict), Some(comments), ref s)) if s == "Replied" => {
                return tool_ok(&serde_json::to_string(&serde_json::json!({
                    "review_id": id,
                    "verdict": verdict,
                    "comments": comments,
                })).unwrap_or_default());
            }
            _ => {}
        }
        std::thread::sleep(poll);
    }
}

fn list_lanes(conn: &Connection, ws: &str) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id,agent_kind,model,status,is_main,team_id,directive,is_leader,team_sort_order \
         FROM lanes WHERE workspace_id=?1 ORDER BY created_at",
    )?;
    let rows = stmt.query_map([ws], |row| {
        Ok(json!({
            "id": row.get::<_,String>(0)?,
            "agent_kind": row.get::<_,String>(1)?,
            "model": row.get::<_,String>(2)?,
            "status": row.get::<_,String>(3)?,
            "is_main": row.get::<_,i32>(4)? != 0,
            "team_id": row.get::<_,Option<String>>(5)?,
            "directive": row.get::<_,String>(6)?,
            "is_leader": row.get::<_,i32>(7)? != 0,
            "team_sort_order": row.get::<_,i32>(8)?,
        }))
    })?;
    rows.collect()
}

fn team_info(conn: &Connection, ws: &str, lane_id: &str) -> rusqlite::Result<Value> {
    // Find this lane's team.
    let team_id: Option<String> = conn
        .query_row(
            "SELECT team_id FROM lanes WHERE id=?1 AND workspace_id=?2",
            (lane_id, ws),
            |row| row.get::<_, Option<String>>(0),
        )
        .unwrap_or(None);

    let Some(team_id) = team_id else {
        return Ok(json!({ "in_team": false }));
    };

    let team_name: String = conn
        .query_row(
            "SELECT name FROM teams WHERE id=?1",
            [&team_id],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_default();

    let mut stmt = conn.prepare(
        "SELECT id,agent_kind,directive,is_leader,status FROM lanes \
         WHERE team_id=?1 ORDER BY team_sort_order",
    )?;
    let members: Vec<Value> = stmt
        .query_map([&team_id], |row| {
            Ok(json!({
                "id": row.get::<_,String>(0)?,
                "agent_kind": row.get::<_,String>(1)?,
                "directive": row.get::<_,String>(2)?,
                "is_leader": row.get::<_,i32>(3)? != 0,
                "status": row.get::<_,String>(4)?,
            }))
        })?
        .collect::<rusqlite::Result<Vec<Value>>>()?;

    let me = members.iter().find(|m| m["id"] == json!(lane_id));
    let my_role = me.map(|m| m["directive"].clone()).unwrap_or(Value::Null);
    let am_leader = me.map(|m| m["is_leader"] == json!(true)).unwrap_or(false);
    let leader_id = members
        .iter()
        .find(|m| m["is_leader"] == json!(true))
        .map(|m| m["id"].clone())
        .unwrap_or(Value::Null);

    Ok(json!({
        "in_team": true,
        "team_id": team_id,
        "team_name": team_name,
        "your_lane_id": lane_id,
        "your_role": my_role,
        "you_are_leader": am_leader,
        "leader_lane_id": leader_id,
        "members": members,
    }))
}

fn list_memory(conn: &Connection, ws: &str, ns: &str) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT key,value FROM memory WHERE workspace_id=?1 AND namespace=?2 ORDER BY key",
    )?;
    let rows = stmt.query_map([ws, ns], |row| {
        Ok(json!({ "key": row.get::<_,String>(0)?, "value": row.get::<_,String>(1)? }))
    })?;
    rows.collect()
}

fn arg_str<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

fn tool_ok(text: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": text }] })
}

fn tool_err(text: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": true })
}

fn jsonrpc_ok(id: Option<&Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.cloned().unwrap_or(Value::Null), "result": result })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
