import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AcpClient } from "../lib/acp-client";
import type { Lane } from "../lib/acp-events";
import { pushPeerEvent, pushSystemEvent, setHarnessLaneStatus, getLaneEvents, subscribeDrainActions } from "./useLaneStream";
import { assembleReviewSignals, buildPacket, composeReviewerPrompt } from "../lib/review";
import type { ReviewGitState } from "../lib/review";

interface PeerEnvelope {
  id: string;
  fromLaneId: string;
  toLaneId: string;
  message: string;
  done?: boolean;
  requestId: string;
  harnessId?: string;
}

interface PeerListRequest {
  requestId: string;
  harnessId?: string;
}

interface ReviewRequest {
  packetId: string;
  fromLaneId: string;
  toLaneId: string;
  note?: string;
  requestId: string;
  harnessId?: string;
}

interface ReviewReplyPayload {
  packetId: string;
  fromLaneId: string;
  summary: string;
  findings: string[];
  requestId: string;
  harnessId?: string;
}

interface LaneSummary {
  lane_id: string;
  display_name: string;
  backend_id: string;
  status: string;
  inbox_depth: number;
}

function replyToHarness(requestId: string, value: unknown) {
  invoke("harness_mcp_reply", { requestId, value }).catch(() => {});
}

export function useHarnessCoordinator(
  getOrSpawnClient: (laneId: string) => Promise<AcpClient | null>,
  lanes: Lane[],
) {
  const getOrSpawnRef = useRef(getOrSpawnClient);
  getOrSpawnRef.current = getOrSpawnClient;

  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;

  const harnessIdRef = useRef<string | null>(null);

  // Lanes that received a peer message and still owe a reply to the sender.
  // Key = receiver lane id, value = sender lane id. Used to auto-reply when a
  // delegated agent (e.g. a weaker backend) ends its turn without calling
  // peer_reply, so the leader always hears back.
  const owedReplies = useRef<Map<string, string>>(new Map());

  // Lanes with an in-flight drain prompt. Prevents issuing two concurrent
  // prompts to the same ACP session (which hangs the subprocess). New inbox
  // messages that arrive while a lane is draining are picked up by the
  // post-turn on_stop → set_status drain check.
  const drainingLanes = useRef<Set<string>>(new Set());

  function wsFor(laneId: string): string {
    return lanesRef.current.find((l) => l.id === laneId)?.workspace_id ?? "";
  }

  const drainPromptCycle = useRef(
    async (action: { lane_id: string; prompt_text: string }) => {
      const ws = wsFor(action.lane_id);
      // Serialize per lane: never issue two concurrent prompts to one ACP
      // session (that hangs the subprocess). A message that arrives mid-turn
      // stays in the coordinator inbox and is drained by the post-turn check.
      if (drainingLanes.current.has(action.lane_id)) {
        return;
      }
      const client = await getOrSpawnRef.current(action.lane_id);
      if (!client) {
        if (ws) pushSystemEvent(ws, action.lane_id, "drain: no client available");
        return;
      }
      if (drainingLanes.current.has(action.lane_id)) {
        return;
      }
      drainingLanes.current.add(action.lane_id);
      if (ws) {
        setHarnessLaneStatus(ws, action.lane_id, "busy");
        pushSystemEvent(ws, action.lane_id, "processing peer message…");
      }
      await invoke("inter_lane_set_status", {
        laneId: action.lane_id,
        status: "busy",
      }).catch(() => {});
      try {
        await client.prompt([{ type: "text", text: action.prompt_text }]);
      } catch (err) {
        if (ws) {
          setHarnessLaneStatus(ws, action.lane_id, "error");
          pushSystemEvent(ws, action.lane_id, `drain error: ${String(err)}`);
        }
        await invoke("inter_lane_set_status", {
          laneId: action.lane_id,
          status: "error",
        }).catch(() => {});
      } finally {
        drainingLanes.current.delete(action.lane_id);
      }
      // The lane's stop event (status reset + next-drain dispatch) is handled
      // by attachClientStream, which captures every lane's stream globally.
    },
  );

  useEffect(() => {
    invoke<string>("harness_id").then((id) => {
      harnessIdRef.current = id;
    });

    const unsubs: Promise<UnlistenFn>[] = [];

    // Lanes that go idle with a pending inbox emit a drain action (from
    // attachClientStream). Route it through the same auto-prompt cycle.
    const unsubDrain = subscribeDrainActions((action) => {
      drainPromptCycle.current(action);
    });

    unsubs.push(
      listen<PeerEnvelope>("acp-inter-lane-message", async (e) => {
        if (harnessIdRef.current && e.payload.harnessId && e.payload.harnessId !== harnessIdRef.current) return;
        const env = e.payload;
        try {
          const result = await invoke<{
            delivered: boolean;
            drain?: { lane_id: string; prompt_text: string } | null;
            error?: string | null;
          }>("inter_lane_deliver", {
            fromLaneId: env.fromLaneId,
            toLaneId: env.toLaneId,
            message: env.message,
            done: env.done ?? false,
          });
          if (result.delivered) {
            const fromWs = wsFor(env.fromLaneId);
            const toWs = wsFor(env.toLaneId);
            if (fromWs) pushPeerEvent(fromWs, env.fromLaneId, "PeerOut", env.fromLaneId, env.toLaneId, env.message);
            if (toWs) pushPeerEvent(toWs, env.toLaneId, "PeerIn", env.fromLaneId, env.toLaneId, env.message);
            // The sender just spoke → it has fulfilled any reply it owed.
            owedReplies.current.delete(env.fromLaneId);
            // A non-done message means the receiver now owes a reply.
            if (!env.done) {
              owedReplies.current.set(env.toLaneId, env.fromLaneId);
            }
          }
          if (result.drain) {
            drainPromptCycle.current(result.drain);
          }
          replyToHarness(env.requestId, {
            delivered: result.delivered,
            envelopeId: env.id,
            reason: result.error ?? null,
          });
        } catch (err) {
          replyToHarness(env.requestId, {
            delivered: false,
            reason: String(err),
          });
        }
      }),
    );

    unsubs.push(
      listen<PeerListRequest>("acp-peer-list-requested", async (e) => {
        if (harnessIdRef.current && e.payload.harnessId && e.payload.harnessId !== harnessIdRef.current) return;
        try {
          const lanes = await invoke<LaneSummary[]>("inter_lane_list");
          replyToHarness(e.payload.requestId, {
            lanes: lanes.map((l) => ({
              laneId: l.lane_id,
              displayName: l.display_name,
              backendId: l.backend_id,
              status: l.status,
            })),
          });
        } catch (err) {
          replyToHarness(e.payload.requestId, { lanes: [], error: String(err) });
        }
      }),
    );

    // acp-peer-reply is handled by PeerBus for UI updates.
    // Delivery routes through acp-inter-lane-message via peer_send(done:true).

    unsubs.push(
      listen<ReviewRequest>("acp-review-requested", async (e) => {
        if (harnessIdRef.current && e.payload.harnessId && e.payload.harnessId !== harnessIdRef.current) return;
        const req = e.payload;
        try {
          const fromWs = wsFor(req.fromLaneId);
          const fromLane = lanesRef.current.find((l) => l.id === req.fromLaneId);
          const cwd = fromLane?.cwd ?? "";

          let git: ReviewGitState | null = null;
          if (cwd) {
            git = await invoke<ReviewGitState>("collect_review_git_state", { cwd }).catch(() => null);
          }
          const events = fromWs ? getLaneEvents(fromWs, req.fromLaneId) : [];
          const signals = assembleReviewSignals(events);

          let message: string;
          if (git && git.hasGitRepo) {
            const packet = buildPacket({
              packetId: req.packetId,
              fromLaneId: req.fromLaneId,
              toLaneId: req.toLaneId,
              note: req.note,
              signals,
              git,
              sentAt: Date.now(),
              harnessId: harnessIdRef.current ?? undefined,
            });
            message = composeReviewerPrompt(packet, req.fromLaneId);
          } else {
            message = `[review request] ${req.note ?? "Please review my recent changes."}`;
          }

          const result = await invoke<{
            delivered: boolean;
            drain?: { lane_id: string; prompt_text: string } | null;
            error?: string | null;
          }>("inter_lane_deliver", {
            fromLaneId: req.fromLaneId,
            toLaneId: req.toLaneId,
            message,
            done: false,
          });
          if (result.delivered) {
            const toWs = wsFor(req.toLaneId);
            if (fromWs) pushPeerEvent(fromWs, req.fromLaneId, "PeerOut", req.fromLaneId, req.toLaneId, message);
            if (toWs) pushPeerEvent(toWs, req.toLaneId, "PeerIn", req.fromLaneId, req.toLaneId, message);
          }
          if (result.drain) {
            drainPromptCycle.current(result.drain);
          }
          replyToHarness(req.requestId, {
            delivered: result.delivered,
            packetId: req.packetId,
            reason: result.error ?? null,
          });
        } catch (err) {
          replyToHarness(req.requestId, {
            delivered: false,
            reason: String(err),
          });
        }
      }),
    );

    unsubs.push(
      listen<ReviewReplyPayload>("acp-review-reply-requested", async (e) => {
        if (harnessIdRef.current && e.payload.harnessId && e.payload.harnessId !== harnessIdRef.current) return;
        const req = e.payload;
        try {
          const result = await invoke<{
            delivered: boolean;
            drain?: { lane_id: string; prompt_text: string } | null;
            error?: string | null;
          }>("inter_lane_deliver", {
            fromLaneId: req.fromLaneId,
            toLaneId: req.fromLaneId,
            message: `[review reply] ${req.summary}\nFindings: ${req.findings.join(", ")}`,
            done: false,
          });
          if (result.delivered) {
            const msg = `[review reply] ${req.summary}\nFindings: ${req.findings.join(", ")}`;
            const fromWs = wsFor(req.fromLaneId);
            if (fromWs) pushPeerEvent(fromWs, req.fromLaneId, "PeerOut", req.fromLaneId, req.fromLaneId, msg);
          }
          if (result.drain) {
            drainPromptCycle.current(result.drain);
          }
          replyToHarness(req.requestId, {
            delivered: result.delivered,
            packetId: req.packetId,
            reason: result.error ?? null,
          });
        } catch (err) {
          replyToHarness(req.requestId, {
            delivered: false,
            reason: String(err),
          });
        }
      }),
    );

    return () => {
      unsubDrain();
      unsubs.forEach((p) => p.then((fn) => fn()));
    };
  }, []);
}
