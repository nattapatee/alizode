import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Workspace, Lane, LaneStatus, Team, CreateTeamInput, CreateTeamResult, TeamPresetWithMembers } from "../lib/acp-events";
import type { AcpMcpCapabilities, AcpMcpServerDescriptor } from "../lib/acp-types";
import { AcpClient } from "../lib/acp-client";
import { pushSystemEvent, setHarnessLaneStatus, attachClientStream } from "./useLaneStream";
import { loadProjectMcpServers, filterByCapability, dedupeByName } from "../lib/mcp-bridge";

export function useWorkspace() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [activeLaneId, setActiveLaneId] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamPresets, setTeamPresets] = useState<TeamPresetWithMembers[]>([]);
  const clientsRef = useRef<Map<string, AcpClient>>(new Map());
  const [, setClientVersion] = useState(0);

  const refresh = useCallback(async () => {
    const ws = await invoke<Workspace[]>("workspace_list");
    setWorkspaces(ws);
    if (ws.length > 0 && !activeWorkspaceId) {
      setActiveWorkspaceId(ws[0].id);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    setActiveLaneId(null);
    setLanes([]);
    setTeams([]);
  }, [activeWorkspaceId]);

  const refreshLanes = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const ls = await invoke<Lane[]>("lane_list", {
      workspaceId: activeWorkspaceId,
    });
    setLanes(ls);
    if (ls.length > 0) {
      const currentValid = activeLaneId && ls.some((l) => l.id === activeLaneId);
      if (!currentValid) {
        const main = ls.find((l) => l.is_main);
        setActiveLaneId(main?.id ?? ls[0].id);
      }
    } else {
      setActiveLaneId(null);
    }
  }, [activeWorkspaceId, activeLaneId]);

  const refreshTeams = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const ts = await invoke<Team[]>("team_list", { workspaceId: activeWorkspaceId });
    setTeams(ts);
  }, [activeWorkspaceId]);

  const refreshTeamPresets = useCallback(async () => {
    const ps = await invoke<TeamPresetWithMembers[]>("team_presets_list");
    setTeamPresets(ps);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    refreshLanes();
    refreshTeams();
  }, [refreshLanes, refreshTeams]);

  useEffect(() => {
    refreshTeamPresets();
  }, [refreshTeamPresets]);

  const getClient = useCallback((laneId: string): AcpClient | null => {
    return clientsRef.current.get(laneId) ?? null;
  }, []);

  const setLaneStatus = useCallback(
    async (laneId: string, status: LaneStatus) => {
      if (!activeWorkspaceId) return;
      await invoke("lane_set_status", {
        workspaceId: activeWorkspaceId,
        laneId,
        status,
      });
      setLanes((prev) =>
        prev.map((l) => (l.id === laneId ? { ...l, status } : l)),
      );
    },
    [activeWorkspaceId],
  );

  const spawnFailedRef = useRef(new Set<string>());
  const spawningRef = useRef(new Set<string>());

  const spawnClientForLane = useCallback(
    async (lane: Lane, cwd: string): Promise<AcpClient | null> => {
      const backendId = lane.agent_kind.toLowerCase();
      const wsId = lane.workspace_id;
      const laneId = lane.id;

      pushSystemEvent(wsId, laneId, `starting ${backendId}…`);
      setHarnessLaneStatus(wsId, laneId, "starting");
      spawningRef.current.add(laneId);

      let client: AcpClient | null = null;
      try {
        const [port, harnessId] = await Promise.all([
          invoke<number>("harness_mcp_port"),
          invoke<string>("harness_id"),
        ]);
        pushSystemEvent(wsId, laneId, `spawning ${backendId} process…`);
        client = await AcpClient.spawn(backendId, cwd, [], lane.model ?? null);
        pushSystemEvent(wsId, laneId, `connecting…`);
        await client.initialize(async (caps) => {
          const mcpCaps = (caps as { mcpCapabilities?: AcpMcpCapabilities } | null)
            ?.mcpCapabilities;
          const isClaudeLane = backendId === "claude";
          const projectServers = isClaudeLane
            ? []
            : await loadProjectMcpServers(cwd);
          const filteredProject = filterByCapability(projectServers, mcpCaps);
          if (filteredProject.length > 0) {
            pushSystemEvent(wsId, laneId, `loaded ${filteredProject.length} project MCP server(s)`);
          }
          let harnessDescriptor: AcpMcpServerDescriptor;
          const transport = mcpCaps?.http ? "http" : "stdio";
          if (mcpCaps?.http) {
            harnessDescriptor = {
              name: "alizode-harness",
              type: "http" as const,
              url: `http://127.0.0.1:${port}/mcp/harness/${harnessId}/lane/${laneId}`,
              headers: [],
            };
          } else {
            harnessDescriptor = await invoke<AcpMcpServerDescriptor>(
              "harness_mcp_bridge_descriptor",
              { workspaceId: wsId, laneId },
            );
          }
          const servers = dedupeByName(filteredProject, [harnessDescriptor]);
          pushSystemEvent(wsId, laneId, `injected ${servers.length} MCP server(s) via ${transport}${isClaudeLane ? " (claude loads .mcp.json natively)" : ""}`);
          return servers;
        });
        pushSystemEvent(wsId, laneId, `${backendId} ready`);
        clientsRef.current.set(laneId, client);
        setClientVersion((v) => v + 1);

        // Permission auto-allow. A team-member lane runs autonomously and is
        // often not the active lane, so its permission dialog never surfaces in
        // the UI (PermissionModal only watches the active lane) — auto-allow ALL
        // its tool calls so it can coordinate and work. Non-team lanes only
        // auto-allow harness coordination tools; everything else uses the modal.
        const permClient = client;
        const isTeamLane = Boolean(lane.team_id);
        permClient.onEvent((ev) => {
          if (ev.type !== "permission_request") return;
          if (!isTeamLane) {
            const name = `${ev.toolCall?.title ?? ""} ${ev.toolCall?.toolCallId ?? ""}`;
            if (!/peer_send|peer_reply|peer_list|team_info|review_request|review_reply/.test(name)) {
              return;
            }
          }
          const allow =
            ev.options.find((o) => o.kind === "allow_always") ??
            ev.options.find((o) => o.kind.startsWith("allow"));
          if (allow) permClient.respondPermission(ev.requestId, allow.optionId).catch(() => {});
        });

        // Capture this lane's transcript + status globally, so its events flow
        // even when it is not the active/focused lane (Meeting Room members).
        attachClientStream(permClient, wsId, laneId);

        await invoke("inter_lane_register", {
          laneId,
          displayName: laneId,
          backendId,
        }).catch(() => {});
        setHarnessLaneStatus(wsId, laneId, "idle");
        await setLaneStatus(laneId, "Idle");
        await invoke("inter_lane_set_status", { laneId, status: "idle" }).catch(() => {});
        return client;
      } catch (e) {
        spawnFailedRef.current.add(laneId);
        setHarnessLaneStatus(wsId, laneId, "error");
        pushSystemEvent(wsId, laneId, `error: ${String(e)}`);
        if (client) {
          client.dispose().catch(() => {});
        }
        return null;
      } finally {
        spawningRef.current.delete(laneId);
      }
    },
    [setLaneStatus],
  );

  const getOrSpawnClient = useCallback(
    async (laneId: string): Promise<AcpClient | null> => {
      const existing = clientsRef.current.get(laneId);
      if (existing && !existing.dead) return existing;
      if (existing?.dead) {
        existing.dispose().catch(() => {});
        clientsRef.current.delete(laneId);
        spawnFailedRef.current.delete(laneId);
      }
      if (spawningRef.current.has(laneId)) return null;
      if (spawnFailedRef.current.has(laneId)) return null;
      const lane = lanes.find((l) => l.id === laneId);
      if (!lane) return null;
      const ws = workspaces.find((w) => w.id === lane.workspace_id);
      const cwd = ws?.cwd ?? lane.cwd ?? ".";
      return spawnClientForLane(lane, cwd);
    },
    [lanes, workspaces, spawnClientForLane],
  );

  useEffect(() => {
    for (const lane of lanes) {
      if (!clientsRef.current.has(lane.id) && !spawnFailedRef.current.has(lane.id)) {
        getOrSpawnClient(lane.id).catch(() => {});
      }
    }
  }, [lanes, getOrSpawnClient]);

  const createWorkspace = useCallback(
    async (name: string, cwd: string) => {
      const ws = await invoke<Workspace>("workspace_create", { name, cwd });
      setWorkspaces((prev) => [...prev, ws]);
      setActiveWorkspaceId(ws.id);
      return ws;
    },
    [],
  );

  const createLane = useCallback(
    async (agentKind: string, model: string) => {
      if (!activeWorkspaceId) return;
      const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
      const cwd = activeWs?.cwd ?? ".";
      const lane = await invoke<Lane>("lane_create", {
        workspaceId: activeWorkspaceId,
        agentKind,
        model,
        cwd,
      });
      setLanes((prev) => [...prev, lane]);
      setActiveLaneId(lane.id);
      await spawnClientForLane(lane, cwd);
      return lane;
    },
    [activeWorkspaceId, workspaces, spawnClientForLane],
  );

  const deleteLane = useCallback(
    async (laneId: string) => {
      if (!activeWorkspaceId) return;
      await invoke("inter_lane_unregister", { laneId, displayName: laneId }).catch(() => {});
      spawnFailedRef.current.delete(laneId);
      const client = clientsRef.current.get(laneId);
      if (client) {
        await client.dispose();
        clientsRef.current.delete(laneId);
      }
      await invoke("lane_delete", { workspaceId: activeWorkspaceId, laneId });
      setLanes((prev) => prev.filter((l) => l.id !== laneId));
      if (activeLaneId === laneId) {
        setActiveLaneId(null);
      }
    },
    [activeWorkspaceId, activeLaneId],
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      const wsLanes = lanes.filter((l) => l.workspace_id === id);
      for (const lane of wsLanes) {
        await invoke("inter_lane_unregister", { laneId: lane.id, displayName: lane.id }).catch(() => {});
        const client = clientsRef.current.get(lane.id);
        if (client) {
          await client.dispose();
          clientsRef.current.delete(lane.id);
        }
      }
      await invoke("workspace_delete", { workspaceId: id });
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
      if (activeWorkspaceId === id) {
        setActiveWorkspaceId(null);
        setLanes([]);
        setActiveLaneId(null);
      }
    },
    [activeWorkspaceId, lanes],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      await invoke("workspace_rename", { workspaceId, name });
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === workspaceId ? { ...w, name } : w)),
      );
    },
    [],
  );

  const updateWorkspaceCwd = useCallback(
    async (workspaceId: string, cwd: string) => {
      await invoke("workspace_update_cwd", { workspaceId, cwd });
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === workspaceId ? { ...w, cwd } : w)),
      );
    },
    [],
  );

  const spawnTeam = useCallback(
    async (input: CreateTeamInput): Promise<CreateTeamResult | null> => {
      try {
        const result = await invoke<CreateTeamResult>("team_create", { input });
        setTeams((prev) => [...prev, result.team]);
        setLanes((prev) => [...prev, ...result.lanes]);
        if (input.save_as_preset) {
          refreshTeamPresets();
        }
        const activeWs = workspaces.find((w) => w.id === input.workspace_id);
        const cwd = activeWs?.cwd ?? input.cwd ?? ".";
        for (const lane of result.lanes) {
          spawnClientForLane(lane, cwd).catch(() => {});
        }
        return result;
      } catch (e) {
        pushSystemEvent(input.workspace_id, "", `team create error: ${String(e)}`);
        return null;
      }
    },
    [workspaces, spawnClientForLane, refreshTeamPresets],
  );

  const deleteTeam = useCallback(
    async (teamId: string) => {
      const teamLanes = lanes.filter((l) => l.team_id === teamId);
      for (const lane of teamLanes) {
        await invoke("inter_lane_unregister", { laneId: lane.id, displayName: lane.id }).catch(() => {});
        const client = clientsRef.current.get(lane.id);
        if (client) {
          await client.dispose();
          clientsRef.current.delete(lane.id);
        }
      }
      await invoke("team_delete", { teamId });
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
      setLanes((prev) =>
        prev.map((l) => (l.team_id === teamId ? { ...l, team_id: null, directive: "", is_leader: false, team_sort_order: 0 } : l)),
      );
    },
    [lanes],
  );

  const deleteTeamPreset = useCallback(
    async (presetId: string) => {
      await invoke("team_preset_delete", { presetId });
      setTeamPresets((prev) => prev.filter((p) => p.preset.id !== presetId));
    },
    [],
  );

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const activeLane = lanes.find((l) => l.id === activeLaneId) ?? null;
  const activeClient = activeLaneId ? (clientsRef.current.get(activeLaneId) ?? null) : null;

  return {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    lanes,
    activeLane,
    activeLaneId,
    setActiveLaneId,
    activeClient,
    getClient,
    getOrSpawnClient,
    setLaneStatus,
    createWorkspace,
    renameWorkspace,
    createLane,
    deleteLane,
    deleteWorkspace,
    updateWorkspaceCwd,
    refresh,
    refreshLanes,
    teams,
    teamPresets,
    refreshTeams,
    refreshTeamPresets,
    spawnTeam,
    deleteTeam,
    deleteTeamPreset,
  };
}
