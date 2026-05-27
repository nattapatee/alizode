import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HarnessMcpLaneStats } from "../lib/acp-types";

export function useMcpStats() {
  const [statsByLane, setStatsByLane] = useState<Map<string, HarnessMcpLaneStats>>(new Map());

  const refresh = useCallback(async () => {
    const list = await invoke<HarnessMcpLaneStats[]>("list_harness_mcp_stats").catch(() => []);
    const next = new Map<string, HarnessMcpLaneStats>();
    for (const s of list) {
      next.set(s.lane_label, s);
    }
    setStatsByLane(next);
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen("acp-harness-mcp-touched", () => {
      refresh();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [refresh]);

  return { statsByLane };
}
