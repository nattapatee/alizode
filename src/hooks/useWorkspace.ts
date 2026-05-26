import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Workspace, Lane } from "../lib/acp-events";
import type { AcpMcpServerDescriptor } from "../lib/acp-types";
import { AcpClient } from "../lib/acp-client";
import { pushSystemEvent } from "./useLaneStream";

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

  const getOrSpawnClient = useCallback(
    async (laneId: string): Promise<AcpClient | null> => {
      const existing = clientsRef.current.get(laneId);
      if (existing) return existing;
      const lane = lanes.find((l) => l.id === laneId);
      if (!lane) return null;
      const ws = workspaces.find((w) => w.id === lane.workspace_id);
      const cwd = ws?.cwd ?? lane.cwd ?? ".";
      const backendId = lane.agent_kind.toLowerCase();
      pushSystemEvent(lane.workspace_id, laneId, `starting ${backendId}…`);
      const [mcpDesc, projectMcp] = await Promise.all([
        invoke<AcpMcpServerDescriptor>(
          "mcp_bridge_descriptor",
          { workspaceId: lane.workspace_id, laneId },
        ),
        invoke<AcpMcpServerDescriptor[]>("load_project_mcp_servers", { cwd })
          .catch(() => [] as AcpMcpServerDescriptor[]),
      ]);
      const allMcp = [mcpDesc, ...projectMcp];
      pushSystemEvent(lane.workspace_id, laneId, `spawning ${backendId} process…`);
      const client = await AcpClient.spawn(backendId, cwd, allMcp, lane.model ?? null);
      pushSystemEvent(lane.workspace_id, laneId, `connecting…`);
      await client.initialize();
      pushSystemEvent(lane.workspace_id, laneId, `${backendId} ready`);
      clientsRef.current.set(laneId, client);
      setClientVersion((v) => v + 1);
      await invoke("inter_lane_register", {
        laneId,
        displayName: laneId,
        backendId,
      }).catch(() => {});
      return client;
    },
    [lanes, workspaces],
  );

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

      try {
        const wsId = activeWorkspaceId;
        pushSystemEvent(wsId, lane.id, `starting ${agentKind}…`);
        const [mcpDesc, projectMcp] = await Promise.all([
          invoke<AcpMcpServerDescriptor>(
            "mcp_bridge_descriptor",
            { workspaceId: wsId, laneId: lane.id },
          ),
          invoke<AcpMcpServerDescriptor[]>("load_project_mcp_servers", { cwd })
            .catch(() => [] as AcpMcpServerDescriptor[]),
        ]);
        const allMcp = [mcpDesc, ...projectMcp];
        if (projectMcp.length > 0) {
          pushSystemEvent(wsId, lane.id, `${projectMcp.length} project MCP server(s) loaded`);
        }
        pushSystemEvent(wsId, lane.id, `spawning ${agentKind} process…`);
        const client = await AcpClient.spawn(agentKind, cwd, allMcp, model);
        pushSystemEvent(wsId, lane.id, `connecting…`);
        await client.initialize();
        pushSystemEvent(wsId, lane.id, `${agentKind} ready`);
        clientsRef.current.set(lane.id, client);
        setClientVersion((v) => v + 1);
        await invoke("inter_lane_register", {
          laneId: lane.id,
          displayName: lane.id,
          backendId: agentKind,
        });
        await invoke("lane_stop", {
          workspaceId: wsId,
          laneId: lane.id,
        }).catch(() => {});
      } catch (err) {
        const wsId = activeWorkspaceId;
        pushSystemEvent(wsId, lane.id, `spawn failed: ${err}`);
        console.warn('[useWorkspace] ACP spawn failed:', err);
      }

      return lane;
    },
    [activeWorkspaceId, workspaces],
  );

  const deleteLane = useCallback(
    async (laneId: string) => {
      if (!activeWorkspaceId) return;
      await invoke("inter_lane_unregister", { laneId, displayName: laneId }).catch(() => {});
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
