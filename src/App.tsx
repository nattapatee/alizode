import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { WorkspaceTabs } from "./components/workspace-tabs/WorkspaceTabs";
import { LaneList } from "./components/lane-list/LaneList";
import { LaneView } from "./components/lane-view/LaneView";
import { LibraryView } from "./components/library-view/LibraryView";
import { EditorView } from "./components/editor-view/EditorView";
import { TerminalView } from "./components/terminal-view/TerminalView";
import { CommandBar } from "./components/command-bar/CommandBar";
import { StatusBar } from "./components/status-bar/StatusBar";
import { PermissionModal } from "./components/permission-modal/PermissionModal";
import { FsWriteModal } from "./components/fs-write-modal/FsWriteModal";
import { FullDiffModal } from "./components/full-diff-modal/FullDiffModal";
import { PeerToast } from "./components/peer-toast/PeerToast";
import { Onboarding } from "./components/onboarding/Onboarding";
import { Stage } from "./components/stage/Stage";
import { PeerBus } from "./components/peer-bus/PeerBus";
import { WorkspaceIntro } from "./components/workspace-intro/WorkspaceIntro";
import { ModelPicker } from "./components/model-picker/ModelPicker";
import { ConfigPicker } from "./components/config-picker/ConfigPicker";
import type { AcpConfigOption } from "./lib/acp-types";
import { SessionPicker } from "./components/session-picker/SessionPicker";
import { AgentPicker } from "./components/agent-picker/AgentPicker";
import { TeamBuilder } from "./components/team-builder/TeamBuilder";
import { MeetingRoom } from "./components/meeting-room/MeetingRoom";
import type { SpawnPayload } from "./components/team-builder/TeamBuilder";
import type { TeamPresetWithMembers, CreateTeamInput, Lane } from "./lib/acp-events";
import { buildTeamContext } from "./lib/team-context";
import { CHAR_BY_ID } from "./lib/characters";
import { getActiveThoughtText } from "./lib/acp-events";
import { useWorkspace } from "./hooks/useWorkspace";
import { useLaneStream, pushPeerEvent, pushSystemEvent, pushUserEvent, setHarnessLaneStatus } from "./hooks/useLaneStream";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useHarnessCoordinator } from "./hooks/useHarnessCoordinator";

export default function App() {
  const {
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
    createLane,
    deleteLane,
    deleteWorkspace,
    renameWorkspace,
    updateWorkspaceCwd,
    refreshLanes,
    teams,
    teamPresets,
    spawnTeam,
    deleteTeam,
    deleteTeamPreset,
  } = useWorkspace();

  useHarnessCoordinator(getOrSpawnClient, lanes);

  const handleDrainAction = useCallback(
    async (action: { lane_id: string; prompt_text: string }) => {
      const lane = lanes.find((l) => l.id === action.lane_id);
      const wsId = lane?.workspace_id ?? activeWorkspaceId ?? "";
      const drainClient = await getOrSpawnClient(action.lane_id);
      if (!drainClient) {
        if (wsId) pushSystemEvent(wsId, action.lane_id, "drain: no client available");
        return;
      }
      if (wsId) {
        setHarnessLaneStatus(wsId, action.lane_id, "busy");
        pushSystemEvent(wsId, action.lane_id, "processing peer message…");
      }
      await invoke("inter_lane_set_status", { laneId: action.lane_id, status: "busy" }).catch(() => {});
      try {
        await drainClient.prompt([{ type: "text", text: action.prompt_text }]);
      } catch (err) {
        if (wsId) {
          setHarnessLaneStatus(wsId, action.lane_id, "error");
          pushSystemEvent(wsId, action.lane_id, `drain error: ${String(err)}`);
        }
        await invoke("inter_lane_set_status", { laneId: action.lane_id, status: "error" }).catch(() => {});
        return;
      }
      const nextStatus = await invoke<string | null>("inter_lane_on_stop", { laneId: action.lane_id }).catch(() => null);
      if (!nextStatus) return;
      if (wsId) {
        setHarnessLaneStatus(wsId, action.lane_id, nextStatus as "idle" | "awaiting_peer");
      }
      const nextDrain = await invoke<{ lane_id: string; prompt_text: string } | null>(
        "inter_lane_set_status",
        { laneId: action.lane_id, status: nextStatus },
      ).catch(() => null);
      if (nextDrain) {
        handleDrainAction(nextDrain);
      }
    },
    [getOrSpawnClient, lanes, activeWorkspaceId],
  );

  const { events, addUserInput, addSystemEvent, clearEvents, isLoading, laneStatus, transcriptWindow } = useLaneStream(
    activeLaneId,
    activeWorkspaceId,
    activeClient,
    handleDrainAction,
    setLaneStatus,
  );

  const activeThought = useMemo(() => getActiveThoughtText(events), [events]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [configPickerOption, setConfigPickerOption] = useState<AcpConfigOption | null>(null);
  const [libraryWorkspaces, setLibraryWorkspaces] = useState<Set<string>>(new Set());
  const [editorWorkspaces, setEditorWorkspaces] = useState<Set<string>>(new Set());
  const [terminalWorkspaces, setTerminalWorkspaces] = useState<Set<string>>(new Set());
  const [introShown, setIntroShown] = useState<Set<string>>(new Set());
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showTeamBuilder, setShowTeamBuilder] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [focusedTeamLaneId, setFocusedTeamLaneId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"stage" | "bus">("stage");
  const [peerMsgCount, setPeerMsgCount] = useState(0);

  useEffect(() => {
    const bump = () => setPeerMsgCount((n) => n + 1);
    const unsubs = [
      listen("acp-inter-lane-message", bump),
      listen("acp-peer-reply", bump),
      listen("acp-review-requested", bump),
    ];
    return () => { unsubs.forEach((p) => p.then((fn) => fn())); };
  }, []);

  const isLibrary = activeWorkspaceId ? libraryWorkspaces.has(activeWorkspaceId) : false;
  const isEditor = activeWorkspaceId ? editorWorkspaces.has(activeWorkspaceId) : false;
  const isTerminal = activeWorkspaceId ? terminalWorkspaces.has(activeWorkspaceId) : false;

  const handleCancelLane = useCallback(async () => {
    if (!activeLaneId) return;
    const client = activeClient;
    if (client) {
      try {
        await client.cancel();
      } catch {
        // cancel may fail if process already exited
      }
    }
    setHarnessLaneStatus(activeWorkspaceId ?? "", activeLaneId, "idle");
    addSystemEvent("agent stopped");
  }, [activeLaneId, activeWorkspaceId, activeClient, addSystemEvent]);

  const handleSessionResume = useCallback(
    async (sessionId: string) => {
      if (!activeClient) return;
      try {
        await activeClient.resumeSession(sessionId);
        addSystemEvent(`resumed session ${sessionId.slice(0, 8)}…`);
      } catch (err) {
        addSystemEvent(`resume failed: ${err}`);
      }
    },
    [activeClient, addSystemEvent],
  );

  const handleSessionLoad = useCallback(
    async (sessionId: string) => {
      if (!activeClient) return;
      try {
        await activeClient.loadSession(sessionId);
        addSystemEvent(`loaded session ${sessionId.slice(0, 8)}… (read-only)`);
      } catch (err) {
        addSystemEvent(`load failed: ${err}`);
      }
    },
    [activeClient, addSystemEvent],
  );

  const handleModelSelect = useCallback(
    async (model: string) => {
      if (!activeLaneId || !activeWorkspaceId) return;
      await invoke("lane_update_model", { workspaceId: activeWorkspaceId, laneId: activeLaneId, model });
      addSystemEvent(`model → ${model}`);
      await refreshLanes();
    },
    [activeLaneId, activeWorkspaceId, addSystemEvent, refreshLanes],
  );

  const handleConfigOptionSelect = useCallback(
    async (configId: string, value: string) => {
      if (!activeClient) return;
      try {
        await activeClient.setConfigOption(configId, value);
        addSystemEvent(`${configId} → ${value}`);
      } catch (err) {
        addSystemEvent(`config error: ${err}`);
      }
    },
    [activeClient, addSystemEvent],
  );

  const handleCreateWorkspace = useCallback(() => {
    setShowCreateMenu(true);
  }, []);

  const handleCreateAgentWorkspace = useCallback(() => {
    setShowCreateMenu(false);
    setShowAgentPicker(true);
  }, []);

  const pendingAgentRef = useRef<string | null>(null);
  const seededTeamLanes = useRef<Set<string>>(new Set());

  const handleAgentPicked = useCallback(async (agentId: string) => {
    setShowAgentPicker(false);
    pendingAgentRef.current = agentId;
    const name = `workspace-${workspaces.length + 1}`;
    await createWorkspace(name, "~");
  }, [workspaces.length, createWorkspace]);

  useEffect(() => {
    if (!pendingAgentRef.current || !activeWorkspaceId) return;
    const agent = pendingAgentRef.current;
    pendingAgentRef.current = null;
    createLane(agent, "sonnet");
  }, [activeWorkspaceId, createLane]);

  const handleCreateLibrary = useCallback(async () => {
    setShowCreateMenu(false);
    const ws = await createWorkspace("library", "");
    setLibraryWorkspaces((prev) => new Set([...prev, ws.id]));
  }, [createWorkspace]);

  const handleCreateEditor = useCallback(async () => {
    setShowCreateMenu(false);
    const ws = await createWorkspace("ide", "");
    setEditorWorkspaces((prev) => new Set([...prev, ws.id]));
  }, [createWorkspace]);

  const handleCreateTerminal = useCallback(async () => {
    setShowCreateMenu(false);
    const ws = await createWorkspace("terminal", "~");
    setTerminalWorkspaces((prev) => new Set([...prev, ws.id]));
  }, [createWorkspace]);

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      setActiveTeamId(teamId);
      setFocusedTeamLaneId(null);
      const leader = lanes.find((l) => l.team_id === teamId && l.is_leader);
      if (leader) setActiveLaneId(leader.id);
    },
    [lanes, setActiveLaneId],
  );

  const handleSelectLaneClearTeam = useCallback(
    (laneId: string) => {
      setActiveTeamId(null);
      setActiveLaneId(laneId);
    },
    [setActiveLaneId],
  );

  const handleTeamSend = useCallback(
    async (laneId: string, text: string) => {
      const client = await getOrSpawnClient(laneId);
      if (!client) {
        addSystemEvent("error: could not spawn agent for team member");
        return;
      }
      const wsId = activeWorkspaceId ?? "";

      // Phase 6: inject team/role context once per lane so the leader knows
      // to delegate (via peer_send / team_info) and members know their role.
      let outgoing = text;
      const lane = lanes.find((l) => l.id === laneId);
      if (lane?.team_id && !seededTeamLanes.current.has(laneId)) {
        seededTeamLanes.current.add(laneId);
        const team = teams.find((t) => t.id === lane.team_id);
        const members = lanes
          .filter((l) => l.team_id === lane.team_id)
          .sort((a, b) => a.team_sort_order - b.team_sort_order);
        const leaderLane = members.find((l) => l.is_leader);
        const roster = members
          .map((l) => `- ${l.id} (${l.directive}${l.is_leader ? ", leader" : ""})`)
          .join("\n");
        const preamble = buildTeamContext({
          isLeader: lane.is_leader,
          role: lane.directive,
          team: team?.name ?? lane.team_id ?? "team",
          leader: leaderLane?.id ?? "unknown",
          roster,
          laneId,
        });
        outgoing = preamble + text;
      }

      pushUserEvent(wsId, laneId, text);
      setHarnessLaneStatus(wsId, laneId, "busy");
      await invoke("inter_lane_set_status", { laneId, status: "busy" }).catch(() => {});
      try {
        await client.prompt([{ type: "text", text: outgoing }]);
      } catch (err) {
        setHarnessLaneStatus(wsId, laneId, "error");
        pushSystemEvent(wsId, laneId, `prompt error: ${String(err)}`);
      }
    },
    [getOrSpawnClient, activeWorkspaceId, addSystemEvent, lanes, teams],
  );

  const handleCreateTeam = useCallback(() => {
    setShowCreateMenu(false);
    setShowTeamBuilder(true);
  }, []);

  const handleSpawnTeamPayload = useCallback(
    async (payload: SpawnPayload) => {
      if (!activeWorkspaceId || !activeWorkspace) return;
      const input: CreateTeamInput = {
        workspace_id: activeWorkspaceId,
        name: payload.name,
        cwd: activeWorkspace.cwd,
        members: payload.members,
        save_as_preset: payload.saveAsPreset,
      };
      await spawnTeam(input);
    },
    [activeWorkspaceId, activeWorkspace, spawnTeam],
  );

  const handleSpawnPreset = useCallback(
    async (preset: TeamPresetWithMembers) => {
      if (!activeWorkspaceId || !activeWorkspace) return;
      const input: CreateTeamInput = {
        workspace_id: activeWorkspaceId,
        name: preset.preset.name,
        cwd: activeWorkspace.cwd,
        members: preset.members.map((m, i) => ({
          agent_kind: m.agent_kind,
          model: m.model,
          directive: m.directive,
          is_leader: m.is_leader,
          sort_order: i,
        })),
        save_as_preset: false,
      };
      await spawnTeam(input);
    },
    [activeWorkspaceId, activeWorkspace, spawnTeam],
  );

  const handleLibraryFolderSelect = useCallback(
    async (path: string) => {
      if (!activeWorkspaceId) return;
      const folderName = path.split("/").pop() ?? "library";
      await updateWorkspaceCwd(activeWorkspaceId, path);
      await renameWorkspace(activeWorkspaceId, folderName);
    },
    [activeWorkspaceId, updateWorkspaceCwd, renameWorkspace],
  );

  const handleEditorFolderSelect = useCallback(
    async (path: string) => {
      if (!activeWorkspaceId) return;
      const folderName = path.split("/").pop() ?? "project";
      await updateWorkspaceCwd(activeWorkspaceId, path);
      await renameWorkspace(activeWorkspaceId, folderName);
    },
    [activeWorkspaceId, updateWorkspaceCwd, renameWorkspace],
  );

  const handleOnboardingComplete = useCallback(
    async (name: string, cwd: string) => {
      await createWorkspace(name, cwd);
    },
    [createWorkspace],
  );

  const handleCloseWorkspace = useCallback(
    async (id: string) => {
      if (terminalWorkspaces.has(id)) {
        await invoke("terminal_kill", { id }).catch(() => {});
        setTerminalWorkspaces((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      await deleteWorkspace(id);
    },
    [deleteWorkspace, terminalWorkspaces],
  );

  const handleSelectFolder = useCallback(
    async (workspaceId: string) => {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        await updateWorkspaceCwd(workspaceId, selected);
      }
    },
    [updateWorkspaceCwd],
  );

  const handleCreateLane = useCallback(
    async (agentKind: string, model: string) => {
      await createLane(agentKind, model);
    },
    [createLane],
  );

  const handleDeleteLane = useCallback(
    async (id: string) => {
      await deleteLane(id);
    },
    [deleteLane],
  );

  const handleCommand = useCallback(
    async (text: string) => {
      if (!activeLaneId) return;

      if (text.startsWith("@")) {
        const spaceIdx = text.indexOf(" ");
        if (spaceIdx > 1) {
          const mentionedLane = text.slice(1, spaceIdx);
          const message = text.slice(spaceIdx + 1).trim();
          // @leader resolves to the leader of the sender's team.
          let target: Lane | undefined;
          if (mentionedLane === "leader") {
            const me = lanes.find((l) => l.id === activeLaneId);
            target = me?.team_id
              ? lanes.find((l) => l.team_id === me.team_id && l.is_leader)
              : undefined;
          } else {
            target = lanes.find((l) => l.id === mentionedLane);
          }
          if (target && message) {
            addSystemEvent(`→ @${mentionedLane}: ${message}`);
            try {
              const result = await invoke<{
                delivered: boolean;
                drain?: { lane_id: string; prompt_text: string } | null;
                error?: string | null;
              }>("inter_lane_deliver", {
                fromLaneId: activeLaneId,
                toLaneId: target.id,
                message,
                done: false,
              });
              if (result.delivered && activeWorkspaceId) {
                pushPeerEvent(activeWorkspaceId, activeLaneId, "PeerOut", activeLaneId, target.id, message);
                pushPeerEvent(target.workspace_id, target.id, "PeerIn", activeLaneId, target.id, message);
              }
              if (result.drain) {
                handleDrainAction(result.drain);
              }
              if (result.error) {
                addSystemEvent(`peer error: ${result.error}`);
              }
            } catch (err) {
              addSystemEvent(`peer error: ${err}`);
            }
            return;
          }
        }
      }

      if (text.startsWith("/")) {
        const parts = text.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();

        switch (cmd) {
          case "clear":
            clearEvents();
            return;
          case "model": {
            const modelOpt = activeClient?.getConfigOption("model");
            if (modelOpt) {
              setConfigPickerOption(modelOpt);
            } else {
              setShowModelPicker(true);
            }
            return;
          }
          case "effort": {
            const effortOpt = activeClient?.getConfigOption("effort");
            if (effortOpt) {
              setConfigPickerOption(effortOpt);
            } else {
              addSystemEvent("effort config not available for this backend");
            }
            return;
          }
          case "mode": {
            const modeOpt = activeClient?.getConfigOption("mode");
            if (modeOpt) {
              setConfigPickerOption(modeOpt);
            } else {
              addSystemEvent("mode config not available for this backend");
            }
            return;
          }
          case "sessions":
          case "resume":
            if (!activeClient) {
              addSystemEvent("no active agent — spawn one first");
              return;
            }
            setShowSessionPicker(true);
            return;
          case "stop":
            if (!activeWorkspaceId) return;
            setHarnessLaneStatus(activeWorkspaceId, activeLaneId!, "stopped");
            addSystemEvent("lane stopped");
            return;
          case "cancel":
            if (activeClient) {
              await activeClient.cancel();
              addSystemEvent("cancelled");
            }
            return;
          case "export":
            if (!activeWorkspaceId) return;
            try {
              const jsonl = await invoke<string>("lane_export_session", {
                workspaceId: activeWorkspaceId,
                laneId: activeLaneId,
              });
              await navigator.clipboard.writeText(jsonl);
              addSystemEvent(`exported ${jsonl.split("\n").length} events to clipboard`);
            } catch (err) {
              addSystemEvent(`export failed: ${err}`);
            }
            return;
          case "help":
            addSystemEvent(
              "/model — pick model\n/effort — set effort level\n/mode — set permission mode\n/sessions — browse sessions\n/resume — resume a session\n/clear — clear display\n/stop — stop lane\n/cancel — cancel turn\n/export — copy session JSONL\n@lane-id msg — send to lane\nCmd+T — new lane\nCmd+W — close lane\nCmd+[/] — switch lanes\nEsc — cancel",
            );
            return;
          default:
            addSystemEvent(`unknown command: /${cmd}`);
            return;
        }
      }

      addUserInput(text);
      try {
        const client = await getOrSpawnClient(activeLaneId);
        if (client) {
          await invoke("inter_lane_set_status", { laneId: activeLaneId, status: "busy" }).catch(() => {});
          await client.prompt([{ type: 'text', text }]);
        } else {
          addSystemEvent("error: could not spawn agent");
        }
      } catch (err) {
        setHarnessLaneStatus(activeWorkspaceId ?? "", activeLaneId, "error");
        await invoke("inter_lane_set_status", { laneId: activeLaneId, status: "error" }).catch(() => {});
        addSystemEvent(`prompt error: ${err}`);
      }
    },
    [activeLaneId, activeWorkspaceId, activeClient, lanes, addUserInput, addSystemEvent, clearEvents, getClient, getOrSpawnClient, handleDrainAction],
  );

  const keyboardActions = useMemo(
    () => ({
      createLane: () => handleCreateLane("claude", "sonnet"),
      deleteLane: () => {
        if (activeLaneId) handleDeleteLane(activeLaneId);
      },
      prevLane: () => {
        if (!activeLaneId || lanes.length < 2) return;
        const idx = lanes.findIndex((l) => l.id === activeLaneId);
        const prev = idx > 0 ? lanes[idx - 1] : lanes[lanes.length - 1];
        setActiveLaneId(prev.id);
      },
      nextLane: () => {
        if (!activeLaneId || lanes.length < 2) return;
        const idx = lanes.findIndex((l) => l.id === activeLaneId);
        const next = idx < lanes.length - 1 ? lanes[idx + 1] : lanes[0];
        setActiveLaneId(next.id);
      },
      cancelLane: () => {
        if (activeClient) {
          activeClient.cancel();
        }
      },
    }),
    [activeLaneId, activeClient, lanes, handleCreateLane, handleDeleteLane, setActiveLaneId],
  );

  useKeyboardShortcuts(keyboardActions);

  if (workspaces.length === 0) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="term-root">
      <div className="scanlines subtle" />
      <div className="crt-glow" />

      <WorkspaceTabs
        workspaces={workspaces}
        activeId={activeWorkspaceId}
        libraryIds={libraryWorkspaces}
        editorIds={editorWorkspaces}
        terminalIds={terminalWorkspaces}
        onSelect={setActiveWorkspaceId}
        onCreate={handleCreateWorkspace}
        onClose={handleCloseWorkspace}
        onRename={renameWorkspace}
        onSelectFolder={handleSelectFolder}
      />

      {isTerminal && activeWorkspace ? (
        <TerminalView terminalId={activeWorkspace.id} cwd={activeWorkspace.cwd} />
      ) : isEditor && activeWorkspace ? (
        <EditorView rootPath={activeWorkspace.cwd} onSelectFolder={handleEditorFolderSelect} />
      ) : isLibrary && activeWorkspace ? (
        <LibraryView rootPath={activeWorkspace.cwd} onSelectFolder={handleLibraryFolderSelect} />
      ) : (
        <div className="term-body">
          {activeWorkspaceId && !introShown.has(activeWorkspaceId) && (() => {
            const introChar = activeLane ? CHAR_BY_ID[activeLane.agent_kind] : null;
            return (
              <WorkspaceIntro
                workspaceName={activeWorkspace?.name ?? "workspace"}
                charName={introChar?.name ?? "AGENT"}
                accent={introChar?.accent ?? "var(--cyan)"}
                onDone={() => setIntroShown((prev) => new Set([...prev, activeWorkspaceId!]))}
              />
            );
          })()}
          <LaneList
            lanes={lanes}
            teams={teams}
            activeId={activeLaneId}
            onSelect={handleSelectLaneClearTeam}
            onCreate={handleCreateLane}
            onDelete={handleDeleteLane}
            onSelectTeam={handleSelectTeam}
            onDeleteTeam={deleteTeam}
            onCreateTeam={handleCreateTeam}
          />
          {activeTeamId && teams.find((t) => t.id === activeTeamId) ? (
            <MeetingRoom
              team={teams.find((t) => t.id === activeTeamId)!}
              lanes={lanes.filter((l) => l.team_id === activeTeamId)}
              workspaceId={activeWorkspaceId}
              focusedLaneId={focusedTeamLaneId}
              onFocusLane={setFocusedTeamLaneId}
              onSend={handleTeamSend}
            />
          ) : (
          <>
          <main className="chat">
            <LaneView
              lane={activeLane}
              events={events}
              isLoading={isLoading}
              harnessStatus={laneStatus}
              transcriptWindow={transcriptWindow}
              isStreaming={
                isLoading &&
                events.length > 0 &&
                events[events.length - 1].kind === "AgentText"
              }
              onCancel={handleCancelLane}
            />
            <CommandBar
              laneId={activeLaneId}
              laneStatus={activeLane?.status}
              lanes={lanes}
              onSubmit={handleCommand}
            />
          </main>
          <aside className="right-panel">
            <div className="rp-tabs">
              <button
                className={`rp-tab${rightTab === "stage" ? " rp-tab-active" : ""}`}
                onClick={() => setRightTab("stage")}
              >
                AGENT_PORTAL
              </button>
              <button
                className={`rp-tab${rightTab === "bus" ? " rp-tab-active" : ""}`}
                onClick={() => setRightTab("bus")}
              >
                PEER_BUS
                {peerMsgCount > 0 && (
                  <span className="rp-tab-badge">{peerMsgCount}</span>
                )}
              </button>
              <span className="rp-stage-id">
                {rightTab === "stage"
                  ? `#${activeLane?.agent_kind ?? "---"}`
                  : "#bus"}
              </span>
            </div>
            {rightTab === "stage" ? (
              <Stage
                lane={activeLane}
                eventCount={events.length}
                activeThought={activeThought}
                isStreaming={
                  isLoading &&
                  events.length > 0 &&
                  events[events.length - 1].kind === "AgentText"
                }
                lanes={lanes}
                onSelectLane={setActiveLaneId}
              />
            ) : (
              <PeerBus lanes={lanes} activeLaneId={activeLaneId} />
            )}
          </aside>
          </>
          )}
        </div>
      )}

      <StatusBar workspace={activeWorkspace} lanes={lanes} />
      <PermissionModal client={activeClient} />
      <FsWriteModal client={activeClient} />
      <FullDiffModal />
      <PeerToast />
      {showModelPicker && (
        <ModelPicker
          currentModel={activeLane?.model ?? ""}
          onSelect={handleModelSelect}
          onClose={() => setShowModelPicker(false)}
        />
      )}
      {configPickerOption && (
        <ConfigPicker
          option={configPickerOption}
          onSelect={handleConfigOptionSelect}
          onClose={() => setConfigPickerOption(null)}
        />
      )}
      {showSessionPicker && activeClient && (
        <SessionPicker
          client={activeClient}
          cwd={activeWorkspace?.cwd ?? "."}
          onResume={handleSessionResume}
          onLoad={handleSessionLoad}
          onClose={() => setShowSessionPicker(false)}
        />
      )}
      {showAgentPicker && (
        <AgentPicker
          onSelect={handleAgentPicked}
          onCancel={() => setShowAgentPicker(false)}
        />
      )}
      <TeamBuilder
        open={showTeamBuilder}
        onClose={() => setShowTeamBuilder(false)}
        onSpawn={handleSpawnTeamPayload}
        presets={teamPresets}
        onSpawnPreset={handleSpawnPreset}
        onDeletePreset={deleteTeamPreset}
      />
      {showCreateMenu && (
        <div className="newtab-overlay" onClick={() => setShowCreateMenu(false)}>
          <div className="newtab-menu" onClick={(e) => e.stopPropagation()}>
            <div className="newtab-menu-head">open new</div>
            <button className="newtab-opt" onClick={handleCreateAgentWorkspace}>
              <span className="opt-glyph">›_</span>
              <span className="opt-meta">
                <span className="opt-name">workspace</span>
                <span className="opt-sub">terminal · agent lanes · chat</span>
              </span>
            </button>
            <button className="newtab-opt" onClick={handleCreateLibrary}>
              <span className="opt-glyph">▤</span>
              <span className="opt-meta">
                <span className="opt-name">library</span>
                <span className="opt-sub">browse · group · preview .md</span>
              </span>
            </button>
            <button className="newtab-opt" onClick={handleCreateEditor}>
              <span className="opt-glyph">⌬</span>
              <span className="opt-meta">
                <span className="opt-name">ide</span>
                <span className="opt-sub">file tree · code · forge chat</span>
              </span>
            </button>
            <button className="newtab-opt" onClick={handleCreateTerminal}>
              <span className="opt-glyph">$_</span>
              <span className="opt-meta">
                <span className="opt-name">terminal</span>
                <span className="opt-sub">shell · commands · full pty</span>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
