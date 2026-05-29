use std::path::Path;
use anyhow::Result;
use rusqlite::Connection;

use super::models::*;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(data_dir: &Path) -> Result<Self> {
        let db_path = data_dir.join("alizode.db");
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        Ok(Self { conn })
    }

    pub fn run_migrations(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );"
        )?;

        let migrations: &[(i64, &str)] = &[
            (1, include_str!("../../migrations/001_init.sql")),
            (2, include_str!("../../migrations/002_teams.sql")),
        ];

        let current_version: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;

        for &(version, sql) in migrations {
            if version > current_version {
                self.conn.execute_batch(sql)?;
                self.conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                    (version, now_ms()),
                )?;
            }
        }

        Ok(())
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, cwd, created_at FROM workspaces ORDER BY created_at")?;
        let rows = stmt.query_map([], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                cwd: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn create_workspace(&self, input: &CreateWorkspace) -> Result<Workspace> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO workspaces (id, name, cwd, created_at) VALUES (?1, ?2, ?3, ?4)",
            (&id, &input.name, &input.cwd, &now),
        )?;
        Ok(Workspace {
            id,
            name: input.name.clone(),
            cwd: input.cwd.clone(),
            created_at: now,
        })
    }

    pub fn delete_workspace(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM lanes WHERE workspace_id = ?1", [id])?;
        self.conn.execute("DELETE FROM memory WHERE workspace_id = ?1", [id])?;
        self.conn.execute("DELETE FROM peer_messages WHERE workspace_id = ?1", [id])?;
        self.conn.execute("DELETE FROM review_requests WHERE workspace_id = ?1", [id])?;
        self.conn.execute("DELETE FROM teams WHERE workspace_id = ?1", [id])?;
        self.conn.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn list_lanes(&self, workspace_id: &str) -> Result<Vec<Lane>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, workspace_id, agent_kind, protocol, model, is_main, status, cwd, \
             created_at, team_id, directive, is_leader, team_sort_order \
             FROM lanes WHERE workspace_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map([workspace_id], lane_from_row)?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn get_lane(&self, lane_id: &str) -> Result<Option<Lane>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, workspace_id, agent_kind, protocol, model, is_main, status, cwd, \
             created_at, team_id, directive, is_leader, team_sort_order \
             FROM lanes WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([lane_id], lane_from_row)?;
        match rows.next() {
            Some(Ok(lane)) => Ok(Some(lane)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    /// Smallest free `{agent_kind}-{n}` id within a workspace. Avoids PRIMARY KEY
    /// collisions after lane deletions or when a team adds multiple same-kind lanes
    /// (the old `count + 1` scheme reused ids that still existed).
    fn next_lane_id(&self, workspace_id: &str, agent_kind: &str) -> Result<String> {
        let mut n = 1;
        loop {
            let candidate = format!("{}-{}", agent_kind, n);
            let exists: i32 = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM lanes WHERE workspace_id = ?1 AND id = ?2)",
                (workspace_id, &candidate),
                |row| row.get(0),
            )?;
            if exists == 0 {
                return Ok(candidate);
            }
            n += 1;
        }
    }

    pub fn create_lane(&self, input: &CreateLane) -> Result<Lane> {
        let count: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM lanes WHERE workspace_id = ?1",
            [&input.workspace_id],
            |row| row.get(0),
        )?;
        let id = self.next_lane_id(&input.workspace_id, &input.agent_kind)?;
        let is_main = count == 0;
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO lanes (id, workspace_id, agent_kind, protocol, model, is_main, status, cwd, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            (
                &id,
                &input.workspace_id,
                &input.agent_kind,
                "NativeAcp",
                &input.model,
                if is_main { 1 } else { 0 },
                "Idle",
                &input.cwd,
                &now,
            ),
        )?;
        Ok(Lane {
            id,
            workspace_id: input.workspace_id.clone(),
            agent_kind: input.agent_kind.clone(),
            protocol: "NativeAcp".to_string(),
            model: input.model.clone(),
            is_main,
            status: "Idle".to_string(),
            cwd: input.cwd.clone(),
            created_at: now,
            team_id: None,
            directive: String::new(),
            is_leader: false,
            team_sort_order: 0,
        })
    }

    pub fn memory_get(
        &self,
        workspace_id: &str,
        namespace: &str,
        key: &str,
    ) -> Result<Option<MemoryEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT workspace_id, namespace, key, value, updated_at \
             FROM memory WHERE workspace_id = ?1 AND namespace = ?2 AND key = ?3",
        )?;
        let mut rows = stmt.query_map([workspace_id, namespace, key], |row| {
            Ok(MemoryEntry {
                workspace_id: row.get(0)?,
                namespace: row.get(1)?,
                key: row.get(2)?,
                value: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default(),
                updated_at: row.get(4)?,
            })
        })?;
        match rows.next() {
            Some(Ok(entry)) => Ok(Some(entry)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    pub fn memory_set(
        &self,
        workspace_id: &str,
        namespace: &str,
        key: &str,
        value: &str,
    ) -> Result<()> {
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO memory (workspace_id, namespace, key, value, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(workspace_id, namespace, key) DO UPDATE SET value = ?4, updated_at = ?5",
            (workspace_id, namespace, key, value, &now),
        )?;
        Ok(())
    }

    pub fn insert_lane_event(
        &self,
        workspace_id: &str,
        lane_id: &str,
        seq: u64,
        kind: &str,
        payload: &str,
    ) -> Result<()> {
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO lane_events (workspace_id, lane_id, seq, ts, kind, payload) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (workspace_id, lane_id, seq as i64, now, kind, payload),
        )?;
        Ok(())
    }

    pub fn list_lane_events(&self, workspace_id: &str, lane_id: &str) -> Result<Vec<crate::store::models::LaneEvent>> {
        let mut stmt = self.conn.prepare(
            "SELECT workspace_id, lane_id, seq, ts, kind, payload \
             FROM lane_events WHERE workspace_id = ?1 AND lane_id = ?2 ORDER BY ts, seq",
        )?;
        let rows = stmt.query_map([workspace_id, lane_id], |row| {
            let payload_str: String = row.get(5)?;
            let payload: serde_json::Value = serde_json::from_str(&payload_str)
                .unwrap_or_else(|_| serde_json::json!({ "text": payload_str }));
            Ok(crate::store::models::LaneEvent {
                workspace_id: row.get(0)?,
                lane_id: row.get(1)?,
                seq: row.get::<_, i64>(2)? as u64,
                ts: row.get(3)?,
                kind: row.get(4)?,
                payload,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn update_lane_model(&self, workspace_id: &str, lane_id: &str, model: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE lanes SET model = ?1 WHERE id = ?2 AND workspace_id = ?3",
            (model, lane_id, workspace_id),
        )?;
        Ok(())
    }

    pub fn update_lane_status(&self, workspace_id: &str, lane_id: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE lanes SET status = ?1 WHERE id = ?2 AND workspace_id = ?3",
            (status, lane_id, workspace_id),
        )?;
        Ok(())
    }

    pub fn update_workspace_name(&self, id: &str, name: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE workspaces SET name = ?1 WHERE id = ?2",
            (name, id),
        )?;
        Ok(())
    }

    pub fn update_workspace_cwd(&self, id: &str, cwd: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE workspaces SET cwd = ?1 WHERE id = ?2",
            (cwd, id),
        )?;
        Ok(())
    }

    pub fn delete_lane(&self, workspace_id: &str, lane_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM lane_events WHERE workspace_id = ?1 AND lane_id = ?2",
            (workspace_id, lane_id),
        )?;
        self.conn.execute(
            "DELETE FROM permission_requests WHERE workspace_id = ?1 AND lane_id = ?2",
            (workspace_id, lane_id),
        )?;
        self.conn.execute(
            "DELETE FROM peer_messages WHERE workspace_id = ?1 AND (from_lane = ?2 OR to_lane = ?2)",
            (workspace_id, lane_id),
        )?;
        self.conn.execute(
            "DELETE FROM lanes WHERE id = ?1 AND workspace_id = ?2",
            (lane_id, workspace_id),
        )?;
        Ok(())
    }

    pub fn create_peer_message(
        &self,
        workspace_id: &str,
        from_lane: &str,
        to_lane: &str,
        request: &str,
    ) -> Result<PeerMessage> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO peer_messages (id, workspace_id, from_lane, to_lane, request, reply, status, created_at, replied_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'Pending', ?6, NULL)",
            (&id, workspace_id, from_lane, to_lane, request, &now),
        )?;
        Ok(PeerMessage {
            id,
            workspace_id: workspace_id.to_string(),
            from_lane: from_lane.to_string(),
            to_lane: to_lane.to_string(),
            request: request.to_string(),
            reply: None,
            status: "Pending".to_string(),
            created_at: now,
            replied_at: None,
        })
    }

    pub fn get_peer_message(&self, id: &str) -> Result<Option<PeerMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, workspace_id, from_lane, to_lane, request, reply, status, created_at, replied_at \
             FROM peer_messages WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id], |row| {
            Ok(PeerMessage {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                from_lane: row.get(2)?,
                to_lane: row.get(3)?,
                request: row.get(4)?,
                reply: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                replied_at: row.get(8)?,
            })
        })?;
        match rows.next() {
            Some(Ok(msg)) => Ok(Some(msg)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    pub fn get_pending_peer_messages(&self, workspace_id: &str) -> Result<Vec<PeerMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, workspace_id, from_lane, to_lane, request, reply, status, created_at, replied_at \
             FROM peer_messages WHERE workspace_id = ?1 AND status = 'Pending' ORDER BY created_at",
        )?;
        let rows = stmt.query_map([workspace_id], |row| {
            Ok(PeerMessage {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                from_lane: row.get(2)?,
                to_lane: row.get(3)?,
                request: row.get(4)?,
                reply: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                replied_at: row.get(8)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn get_all_pending_peer_messages(&self) -> Result<Vec<PeerMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, workspace_id, from_lane, to_lane, request, reply, status, created_at, replied_at \
             FROM peer_messages WHERE status = 'Pending' ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PeerMessage {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                from_lane: row.get(2)?,
                to_lane: row.get(3)?,
                request: row.get(4)?,
                reply: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                replied_at: row.get(8)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn mark_peer_delivered(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE peer_messages SET status = 'Delivered' WHERE id = ?1 AND status = 'Pending'",
            [id],
        )?;
        Ok(())
    }

    pub fn reply_peer_message(&self, id: &str, reply: &str) -> Result<()> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE peer_messages SET reply = ?1, status = 'Replied', replied_at = ?2 WHERE id = ?3",
            (reply, &now, id),
        )?;
        Ok(())
    }

    pub fn set_lane_main(&self, workspace_id: &str, lane_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE lanes SET is_main = 0 WHERE workspace_id = ?1",
            [workspace_id],
        )?;
        self.conn.execute(
            "UPDATE lanes SET is_main = 1 WHERE id = ?1 AND workspace_id = ?2",
            [lane_id, workspace_id],
        )?;
        Ok(())
    }

    pub fn create_review_request(
        &self,
        workspace_id: &str,
        from_lane: &str,
        to_lane: &str,
        file_path: &str,
        diff: &str,
        instructions: &str,
    ) -> Result<ReviewRequest> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO review_requests (id, workspace_id, from_lane, to_lane, file_path, diff, instructions, \
             verdict, comments, status, created_at, replied_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, 'Pending', ?8, NULL)",
            (&id, workspace_id, from_lane, to_lane, file_path, diff, instructions, &now),
        )?;
        Ok(ReviewRequest {
            id,
            workspace_id: workspace_id.to_string(),
            from_lane: from_lane.to_string(),
            to_lane: to_lane.to_string(),
            file_path: file_path.to_string(),
            diff: diff.to_string(),
            instructions: instructions.to_string(),
            verdict: None,
            comments: None,
            status: "Pending".to_string(),
            created_at: now,
            replied_at: None,
        })
    }

    pub fn get_review_request(&self, id: &str) -> Result<Option<ReviewRequest>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, workspace_id, from_lane, to_lane, file_path, diff, instructions, \
             verdict, comments, status, created_at, replied_at \
             FROM review_requests WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id], |row| {
            Ok(ReviewRequest {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                from_lane: row.get(2)?,
                to_lane: row.get(3)?,
                file_path: row.get(4)?,
                diff: row.get(5)?,
                instructions: row.get(6)?,
                verdict: row.get(7)?,
                comments: row.get(8)?,
                status: row.get(9)?,
                created_at: row.get(10)?,
                replied_at: row.get(11)?,
            })
        })?;
        match rows.next() {
            Some(Ok(r)) => Ok(Some(r)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    pub fn reply_review_request(
        &self,
        id: &str,
        verdict: &str,
        comments: &str,
    ) -> Result<()> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE review_requests SET verdict = ?1, comments = ?2, status = 'Replied', \
             replied_at = ?3 WHERE id = ?4",
            (verdict, comments, &now, id),
        )?;
        Ok(())
    }

    pub fn get_pending_permission_requests(&self) -> Result<Vec<PermissionRequest>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, workspace_id, lane_id, tool, detail, status, decision, created_at, decided_at \
             FROM permission_requests WHERE status = 'Pending' ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PermissionRequest {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                lane_id: row.get(2)?,
                tool: row.get(3)?,
                detail: row.get(4)?,
                status: row.get(5)?,
                decision: row.get(6)?,
                created_at: row.get(7)?,
                decided_at: row.get(8)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn mark_permission_prompted(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE permission_requests SET status = 'Prompted' WHERE id = ?1 AND status = 'Pending'",
            [id],
        )?;
        Ok(())
    }

    pub fn decide_permission_request(&self, id: &str, decision: &str) -> Result<()> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE permission_requests SET decision = ?1, status = 'Decided', decided_at = ?2 \
             WHERE id = ?3",
            (decision, &now, id),
        )?;
        Ok(())
    }

    // --- Team methods ---

    pub fn create_team(&self, input: &CreateTeamInput) -> Result<CreateTeamResult> {
        if input.name.trim().is_empty() {
            anyhow::bail!("team name must not be empty");
        }
        if input.members.len() < 2 || input.members.len() > 4 {
            anyhow::bail!("team must have 2-4 members");
        }
        let leader_count = input.members.iter().filter(|m| m.is_leader).count();
        if leader_count != 1 {
            anyhow::bail!("team must have exactly one leader");
        }
        for m in &input.members {
            if m.directive.trim().is_empty() {
                anyhow::bail!("every member must have a non-empty directive");
            }
        }

        let team_id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();

        // Atomic: a failure anywhere below rolls back the team + any lanes/preset
        // so we never leave an orphan team row with no members.
        let tx = self.conn.unchecked_transaction()?;

        self.conn.execute(
            "INSERT INTO teams (id, workspace_id, name, preset_id, created_at) \
             VALUES (?1, ?2, ?3, NULL, ?4)",
            (&team_id, &input.workspace_id, &input.name, &now),
        )?;

        let mut lanes = Vec::new();
        let ws_lane_count: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM lanes WHERE workspace_id = ?1",
            [&input.workspace_id],
            |row| row.get(0),
        )?;
        for (idx, member) in input.members.iter().enumerate() {
            let lane_id = self.next_lane_id(&input.workspace_id, &member.agent_kind)?;
            let is_main = ws_lane_count == 0 && idx == 0;

            self.conn.execute(
                "INSERT INTO lanes (id, workspace_id, agent_kind, protocol, model, is_main, \
                 status, cwd, created_at, team_id, directive, is_leader, team_sort_order) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                (
                    &lane_id, &input.workspace_id, &member.agent_kind, "NativeAcp",
                    &member.model, if is_main { 1 } else { 0 }, "Idle",
                    &input.cwd, &now, &team_id, &member.directive,
                    if member.is_leader { 1 } else { 0 }, &member.sort_order,
                ),
            )?;

            lanes.push(Lane {
                id: lane_id,
                workspace_id: input.workspace_id.clone(),
                agent_kind: member.agent_kind.clone(),
                protocol: "NativeAcp".to_string(),
                model: member.model.clone(),
                is_main,
                status: "Idle".to_string(),
                cwd: input.cwd.clone(),
                created_at: now,
                team_id: Some(team_id.clone()),
                directive: member.directive.clone(),
                is_leader: member.is_leader,
                team_sort_order: member.sort_order,
            });
        }

        let preset_id = if input.save_as_preset {
            let pid = uuid::Uuid::new_v4().to_string();
            self.conn.execute(
                "INSERT INTO team_presets (id, name, created_at) VALUES (?1, ?2, ?3)",
                (&pid, &input.name, &now),
            )?;
            for member in &input.members {
                let mid = uuid::Uuid::new_v4().to_string();
                self.conn.execute(
                    "INSERT INTO team_preset_members (id, preset_id, agent_kind, model, \
                     directive, is_leader, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    (
                        &mid, &pid, &member.agent_kind, &member.model,
                        &member.directive, if member.is_leader { 1 } else { 0 },
                        &member.sort_order,
                    ),
                )?;
            }
            self.conn.execute(
                "UPDATE teams SET preset_id = ?1 WHERE id = ?2",
                (&pid, &team_id),
            )?;
            Some(pid)
        } else {
            None
        };

        tx.commit()?;

        let team = Team {
            id: team_id,
            workspace_id: input.workspace_id.clone(),
            name: input.name.clone(),
            preset_id,
            created_at: now,
        };

        Ok(CreateTeamResult { team, lanes })
    }

    pub fn list_teams(&self, workspace_id: &str) -> Result<Vec<Team>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, workspace_id, name, preset_id, created_at \
             FROM teams WHERE workspace_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map([workspace_id], |row| {
            Ok(Team {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                preset_id: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn delete_team(&self, team_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE lanes SET team_id = NULL, directive = '', is_leader = 0, \
             team_sort_order = 0 WHERE team_id = ?1",
            [team_id],
        )?;
        self.conn.execute("DELETE FROM teams WHERE id = ?1", [team_id])?;
        Ok(())
    }

    pub fn list_team_presets(&self) -> Result<Vec<TeamPresetWithMembers>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, created_at FROM team_presets ORDER BY created_at",
        )?;
        let presets: Vec<TeamPreset> = stmt
            .query_map([], |row| {
                Ok(TeamPreset {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut result = Vec::new();
        for preset in presets {
            let mut mstmt = self.conn.prepare(
                "SELECT id, preset_id, agent_kind, model, directive, is_leader, sort_order \
                 FROM team_preset_members WHERE preset_id = ?1 ORDER BY sort_order",
            )?;
            let members: Vec<TeamPresetMember> = mstmt
                .query_map([&preset.id], |row| {
                    Ok(TeamPresetMember {
                        id: row.get(0)?,
                        preset_id: row.get(1)?,
                        agent_kind: row.get(2)?,
                        model: row.get(3)?,
                        directive: row.get(4)?,
                        is_leader: row.get::<_, i32>(5)? != 0,
                        sort_order: row.get(6)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            result.push(TeamPresetWithMembers { preset, members });
        }
        Ok(result)
    }

    pub fn save_team_preset(
        &self,
        name: &str,
        members: &[CreateTeamMemberInput],
    ) -> Result<TeamPreset> {
        let pid = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO team_presets (id, name, created_at) VALUES (?1, ?2, ?3)",
            (&pid, name, &now),
        )?;
        for member in members {
            let mid = uuid::Uuid::new_v4().to_string();
            self.conn.execute(
                "INSERT INTO team_preset_members (id, preset_id, agent_kind, model, \
                 directive, is_leader, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                (
                    &mid, &pid, &member.agent_kind, &member.model, &member.directive,
                    if member.is_leader { 1 } else { 0 }, &member.sort_order,
                ),
            )?;
        }
        Ok(TeamPreset {
            id: pid,
            name: name.to_string(),
            created_at: now,
        })
    }

    pub fn delete_team_preset(&self, preset_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM team_preset_members WHERE preset_id = ?1",
            [preset_id],
        )?;
        self.conn.execute(
            "DELETE FROM team_presets WHERE id = ?1",
            [preset_id],
        )?;
        Ok(())
    }

    pub fn memory_list(&self, workspace_id: &str, namespace: &str) -> Result<Vec<MemoryEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT workspace_id, namespace, key, value, updated_at \
             FROM memory WHERE workspace_id = ?1 AND namespace = ?2 ORDER BY key",
        )?;
        let rows = stmt.query_map([workspace_id, namespace], |row| {
            Ok(MemoryEntry {
                workspace_id: row.get(0)?,
                namespace: row.get(1)?,
                key: row.get(2)?,
                value: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default(),
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
}

fn lane_from_row(row: &rusqlite::Row) -> rusqlite::Result<Lane> {
    Ok(Lane {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        agent_kind: row.get(2)?,
        protocol: row.get(3)?,
        model: row.get(4)?,
        is_main: row.get::<_, i32>(5)? != 0,
        status: row.get(6)?,
        cwd: row.get(7)?,
        created_at: row.get(8)?,
        team_id: row.get(9)?,
        directive: row.get(10)?,
        is_leader: row.get::<_, i32>(11)? != 0,
        team_sort_order: row.get(12)?,
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
