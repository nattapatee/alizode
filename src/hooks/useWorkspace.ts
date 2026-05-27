import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Workspace, Lane, LaneStatus } from "../lib/acp-events";
import type { AcpMcpCapabilities, AcpMcpServerDescriptor } from "../lib/acp-types";
import { AcpClient } from "../lib/acp-client";
import { pushSystemEvent, setHarnessLaneStatus } from "./useLaneStream";
import { loadProjectMcpServers, filterByCapability, dedupeByName } from "../lib/mcp-bridge";

export function useWorkspace() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [activeLaneId, setActiveLaneId] = useState<string | null>(null);
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    refreshLanes();
  }, [refreshLanes]);

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
      const backendId = lane.agent_kind.toLowerCase();
      const wsId = lane.workspace_id;
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
        await invoke("inter_lane_register", {
          laneId,
          displayName: laneId,
          backendId,
        }).catch(() => {});
        setHarnessLaneStatus(wsId, laneId, "idle");
        await setLaneStatus(laneId, "Idle");
        await invoke("inter_lane_set_status", { laneId, status: "idle" }).catch(
          () => {},
        );
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
    [lanes, workspaces, setLaneStatus],
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

      spawningRef.current.add(lane.id);
      try {
        const wsId = activeWorkspaceId;
        pushSystemEvent(wsId, lane.id, `starting ${agentKind}…`);
        setHarnessLaneStatus(wsId, lane.id, "starting");
        const [port, harnessId] = await Promise.all([
          invoke<number>("harness_mcp_port"),
          invoke<string>("harness_id"),
        ]);
        pushSystemEvent(wsId, lane.id, `harness MCP on port ${port}`);
        pushSystemEvent(wsId, lane.id, `spawning ${agentKind} process…`);
        const client = await AcpClient.spawn(agentKind, cwd, [], model);
        pushSystemEvent(wsId, lane.id, `connecting…`);
        await client.initialize(async (caps) => {
          const mcpCaps = (caps as { mcpCapabilities?: AcpMcpCapabilities } | null)
            ?.mcpCapabilities;
          const isClaudeLane = agentKind.toLowerCase() === "claude";
          const projectServers = isClaudeLane
            ? []
            : await loadProjectMcpServers(cwd);
          const filteredProject = filterByCapability(projectServers, mcpCaps);
          if (filteredProject.length > 0) {
            pushSystemEvent(wsId, lane.id, `loaded ${filteredProject.length} project MCP server(s)`);
          }
          let harnessDescriptor: AcpMcpServerDescriptor;
          const transport = mcpCaps?.http ? "http" : "stdio";
          if (mcpCaps?.http) {
            harnessDescriptor = {
              name: "alizode-harness",
              type: "http" as const,
              url: `http://127.0.0.1:${port}/mcp/harness/${harnessId}/lane/${lane.id}`,
              headers: [],
            };
          } else {
            harnessDescriptor = await invoke<AcpMcpServerDescriptor>(
              "harness_mcp_bridge_descriptor",
              { workspaceId: wsId, laneId: lane.id },
            );
          }
          const servers = dedupeByName(filteredProject, [harnessDescriptor]);
          pushSystemEvent(wsId, lane.id, `injected ${servers.length} MCP server(s) via ${transport}${isClaudeLane ? " (claude loads .mcp.json natively)" : ""}`);
          return servers;
        });
        pushSystemEvent(wsId, lane.id, `${agentKind} ready`);
        clientsRef.current.set(lane.id, client);
        setClientVersion((v) => v + 1);
        await invoke("inter_lane_register", {
          laneId: lane.id,
          displayName: lane.id,
          backendId: agentKind,
        });
        setHarnessLaneStatus(wsId, lane.id, "idle");
        await setLaneStatus(lane.id, "Idle");
        await invoke("inter_lane_set_status", { laneId: lane.id, status: "idle" }).catch(
          () => {},
        );
      } catch (err) {
        spawnFailedRef.current.add(lane.id);
        const wsId = activeWorkspaceId;
        pushSystemEvent(wsId, lane.id, `error: ${String(err)}`);
        setHarnessLaneStatus(wsId, lane.id, "error");
        await setLaneStatus(lane.id, "Error").catch(() => {});
      } finally {
        spawningRef.current.delete(lane.id);
      }

      return lane;
    },
    [activeWorkspaceId, workspaces, setLaneStatus],
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
  };
}
