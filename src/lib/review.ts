import type { LaneEvent } from "./acp-events";

export const TOTAL_PATCH_CAP = 40_960;
export const PER_FILE_HUNK_CAP = 8_192;
export const INTENT_CAP = 2_000;
export const COMMAND_RESULT_TAIL = 400;
export const SUMMARY_CAP = 600;
export const CONCERN_CAP = 200;

export interface ReviewDiffstatEntry {
  path: string;
  status: "M" | "A" | "D" | "R" | "?";
  added: number;
  removed: number;
}

export interface ReviewPatchHunk {
  path: string;
  status: "M" | "A" | "D" | "R" | "?";
  hunk: string;
  truncated: boolean;
}

export interface ReviewUntrackedExcerpt {
  path: string;
  head: string;
}

export interface ReviewCommandSummary {
  command: string;
  exitCode: number | null;
  summary: string;
  at: number;
}

export interface ReviewToolSummary {
  kind: "read" | "edit" | "search" | "other";
  subject: string;
  count: number;
}

export interface ReviewGitState {
  repoRoot: string;
  hasGitRepo: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  partialStagingDetected: boolean;
  worktreeFingerprint: string;
  diffstat: ReviewDiffstatEntry[];
  patchHunks: ReviewPatchHunk[];
  untrackedExcerpts: ReviewUntrackedExcerpt[];
}

export interface ReviewPacket {
  packetId: string;
  fromLaneId: string;
  toLaneId: string;
  intent: string;
  repoRoot: string;
  patchBase: "head";
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  partialStagingDetected: boolean;
  worktreeFingerprint: string;
  diffstat: ReviewDiffstatEntry[];
  patchHunks: ReviewPatchHunk[];
  untrackedExcerpts: ReviewUntrackedExcerpt[];
  commands: ReviewCommandSummary[];
  toolSummary: ReviewToolSummary[];
  note?: string;
  sentAt: number;
  harnessId?: string;
}

export interface ReviewFinding {
  file: string;
  line: number;
  severity: "block" | "warn" | "nit";
  concern: string;
  suggestedCheck?: string;
}

export interface TranscriptSignal {
  intent: string;
  commands: ReviewCommandSummary[];
  toolSummary: ReviewToolSummary[];
}

export interface BuildPacketInput {
  packetId: string;
  fromLaneId: string;
  toLaneId: string;
  note: string | undefined;
  signals: TranscriptSignal;
  git: ReviewGitState;
  sentAt: number;
  harnessId: string | undefined;
}

export function buildPacket(input: BuildPacketInput): ReviewPacket {
  return {
    packetId: input.packetId,
    fromLaneId: input.fromLaneId,
    toLaneId: input.toLaneId,
    intent: input.signals.intent.slice(0, INTENT_CAP),
    repoRoot: input.git.repoRoot,
    patchBase: "head",
    hasStagedChanges: input.git.hasStagedChanges,
    hasUnstagedChanges: input.git.hasUnstagedChanges,
    partialStagingDetected: input.git.partialStagingDetected,
    worktreeFingerprint: input.git.worktreeFingerprint,
    diffstat: input.git.diffstat,
    patchHunks: input.git.patchHunks,
    untrackedExcerpts: input.git.untrackedExcerpts,
    commands: input.signals.commands,
    toolSummary: input.signals.toolSummary,
    note: input.note?.trim() || undefined,
    sentAt: input.sentAt,
    harnessId: input.harnessId,
  };
}

export function composeReviewerPrompt(
  packet: ReviewPacket,
  fromDisplayName: string,
): string {
  const lines: string[] = [];
  lines.push(
    `[review request] From ${fromDisplayName} (packet: ${packet.packetId}):`,
  );
  lines.push("");
  if (packet.note) {
    lines.push(`Note: ${packet.note}`);
    lines.push("");
  }
  lines.push("## Working-tree state");
  lines.push(`- repo root: ${packet.repoRoot}`);
  lines.push(
    `- staging: staged=${packet.hasStagedChanges ? "yes" : "no"} · unstaged=${packet.hasUnstagedChanges ? "yes" : "no"} · partial=${packet.partialStagingDetected ? "yes" : "no"}`,
  );
  if (packet.partialStagingDetected) {
    lines.push(
      "  WARNING — some paths differ in both index and worktree; the patch below reflects worktree state and may not match what would be committed.",
    );
  }
  lines.push("");

  if (packet.intent.trim().length > 0) {
    lines.push("## Intent");
    lines.push(packet.intent.trim());
    lines.push("");
  }

  lines.push("## Patch (vs HEAD)");
  if (packet.diffstat.length === 0) {
    lines.push("(no tracked changes)");
  } else {
    const added = packet.diffstat.reduce((s, e) => s + e.added, 0);
    const removed = packet.diffstat.reduce((s, e) => s + e.removed, 0);
    lines.push(
      `Diffstat: ${packet.diffstat.length} files changed, +${added} / -${removed}`,
    );
    for (const e of packet.diffstat) {
      lines.push(
        `  ${e.status}  ${e.path}    (+${e.added} / -${e.removed})`,
      );
    }
  }
  lines.push("");

  if (packet.patchHunks.length > 0) {
    lines.push("```diff");
    for (const h of packet.patchHunks) {
      lines.push(
        `--- ${h.path} (${h.status}${h.truncated ? ", truncated" : ""}) ---`,
      );
      lines.push(h.hunk);
    }
    lines.push("```");
    lines.push("");
  }

  if (packet.untrackedExcerpts.length > 0) {
    lines.push("Untracked excerpts:");
    for (const u of packet.untrackedExcerpts) {
      lines.push(`  ${u.path} (head):`);
      for (const ln of u.head.split("\n")) lines.push(`    ${ln}`);
    }
    lines.push("");
  }

  if (packet.commands.length > 0) {
    lines.push("## Commands run (best-effort)");
    for (const c of packet.commands) {
      const exit = c.exitCode === null ? "exit ?" : `exit ${c.exitCode}`;
      lines.push(`- \`${c.command}\` → ${exit}`);
    }
    lines.push("");
  }

  if (packet.toolSummary.length > 0) {
    lines.push("## Tool summary");
    for (const t of packet.toolSummary) {
      lines.push(`- ${t.kind}: ${t.subject} (×${t.count})`);
    }
    lines.push("");
  }

  lines.push(
    '[review request] Send the result with review_reply({ packet_id: "' +
      packet.packetId +
      '", summary, findings }).',
  );
  lines.push(
    "Use findings: [] for a clean review. For actionable findings, include file, line, severity (block | warn | nit), concern, and optional suggested_check.",
  );
  return lines.join("\n");
}

export function assembleReviewSignals(events: LaneEvent[]): TranscriptSignal {
  let intent = "";
  const commands: ReviewCommandSummary[] = [];
  const toolCounts = new Map<string, { subject: string; count: number }>();

  for (const ev of events) {
    const p = ev.payload;
    const text = typeof p.text === "string" ? p.text : "";

    if (ev.kind === "UserIn" && text) {
      if (intent.length < INTENT_CAP) {
        intent += (intent.length > 0 ? "\n" : "") + text;
      }
    }
    if (ev.kind === "ToolCall") {
      const kind = (typeof p.kind === "string" ? p.kind : "other") as string;
      const title = typeof p.title === "string" ? p.title : "";
      const toolCallId = typeof p.toolCallId === "string" ? p.toolCallId : "";
      const subject = title || toolCallId || "tool";
      const key = `${kind}:${subject}`;
      const existing = toolCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        toolCounts.set(key, { subject, count: 1 });
      }
    }
    if (ev.kind === "ToolResult" && p.kind === "execute") {
      const resultText = p.rawOutput != null ? String(p.rawOutput) : "";
      const tail =
        resultText.length > COMMAND_RESULT_TAIL
          ? resultText.slice(-COMMAND_RESULT_TAIL)
          : resultText;
      const title = typeof p.title === "string" ? p.title : "command";
      commands.push({
        command: title,
        exitCode: null,
        summary: tail,
        at: ev.ts,
      });
    }
  }

  const toolSummary: ReviewToolSummary[] = [];
  for (const [key, val] of toolCounts) {
    const kind = key.split(":")[0] as ReviewToolSummary["kind"];
    toolSummary.push({ kind, subject: val.subject, count: val.count });
  }

  return {
    intent: intent.slice(0, INTENT_CAP),
    commands,
    toolSummary,
  };
}

export interface FindingValidationError {
  index: number;
  message: string;
}

export interface ValidatedReply {
  ok: boolean;
  errors: FindingValidationError[];
  cleanedFindings: ReviewFinding[];
  summary: string;
}

export function validateReply(
  raw: unknown,
  expectedPacketId: string,
  repoRoot: string,
): ValidatedReply {
  const errors: FindingValidationError[] = [];
  const cleaned: ReviewFinding[] = [];

  if (typeof raw !== "object" || raw === null) {
    return {
      ok: false,
      errors: [{ index: -1, message: "reply payload is not an object" }],
      cleanedFindings: [],
      summary: "",
    };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.packet_id !== expectedPacketId) {
    return {
      ok: false,
      errors: [
        {
          index: -1,
          message: `packet_id mismatch (expected ${expectedPacketId})`,
        },
      ],
      cleanedFindings: [],
      summary: "",
    };
  }
  const summary =
    typeof obj.summary === "string" ? obj.summary.slice(0, SUMMARY_CAP) : "";
  const findingsValue = obj.findings;
  const findingsRaw =
    findingsValue === undefined
      ? []
      : Array.isArray(findingsValue)
        ? findingsValue
        : null;
  if (findingsRaw === null) {
    return {
      ok: false,
      errors: [
        { index: -1, message: "findings must be an array when provided" },
      ],
      cleanedFindings: [],
      summary,
    };
  }

  findingsRaw.forEach((f: unknown, idx: number) => {
    if (typeof f !== "object" || f === null) {
      errors.push({ index: idx, message: "finding is not an object" });
      return;
    }
    const fo = f as Record<string, unknown>;
    const file = typeof fo.file === "string" ? fo.file.trim() : "";
    const line =
      typeof fo.line === "number" && Number.isInteger(fo.line) ? fo.line : null;
    const severity = fo.severity;
    const concern = typeof fo.concern === "string" ? fo.concern.trim() : "";
    const suggestedCheck =
      typeof fo.suggested_check === "string"
        ? fo.suggested_check.trim()
        : typeof fo.suggestedCheck === "string"
          ? (fo.suggestedCheck as string).trim()
          : "";

    if (file.length === 0) {
      errors.push({ index: idx, message: "file is required" });
      return;
    }
    if (line === null || line < 1) {
      errors.push({
        index: idx,
        message: "line is required (1-based positive integer)",
      });
      return;
    }
    if (severity !== "block" && severity !== "warn" && severity !== "nit") {
      errors.push({
        index: idx,
        message: "severity must be one of block | warn | nit",
      });
      return;
    }
    if (concern.length === 0) {
      errors.push({ index: idx, message: "concern is required" });
      return;
    }
    if (concern.length > CONCERN_CAP) {
      errors.push({
        index: idx,
        message: `concern exceeds ${CONCERN_CAP} chars`,
      });
      return;
    }
    if (severity === "block" && suggestedCheck.length === 0) {
      errors.push({
        index: idx,
        message: "severity=block requires suggested_check",
      });
      return;
    }
    const segments = file.split("/");
    if (segments.some((s) => s === "..")) {
      errors.push({
        index: idx,
        message: 'file path may not contain ".." segments',
      });
      return;
    }
    const repoRootWithSep = repoRoot.endsWith("/")
      ? repoRoot
      : `${repoRoot}/`;
    let normalized = file;
    if (file.startsWith("/")) {
      if (file === repoRoot || file.startsWith(repoRootWithSep)) {
        normalized = file.slice(repoRootWithSep.length);
      } else {
        errors.push({
          index: idx,
          message: "absolute file path is outside repoRoot",
        });
        return;
      }
    }
    normalized = normalized.replace(/^\/+/, "");
    cleaned.push({
      file: normalized,
      line,
      severity: severity as ReviewFinding["severity"],
      concern,
      suggestedCheck: suggestedCheck.length > 0 ? suggestedCheck : undefined,
    });
  });

  return { ok: errors.length === 0, errors, cleanedFindings: cleaned, summary };
}
