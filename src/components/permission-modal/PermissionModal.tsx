import { useEffect, useState, useCallback } from "react";
import type { AcpClient } from "../../lib/acp-client";
import type { AcpEvent, PermissionOption, ToolCall } from "../../lib/acp-types";

interface PendingPermission {
  requestId: number;
  toolCall: ToolCall;
  options: PermissionOption[];
}

interface Props {
  client: AcpClient | null;
}

export function PermissionModal({ client }: Props) {
  const [pending, setPending] = useState<PendingPermission | null>(null);

  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((e: AcpEvent) => {
      if (e.type === 'permission_request') {
        setPending({
          requestId: e.requestId,
          toolCall: e.toolCall,
          options: e.options,
        });
      }
    });
    return unsub;
  }, [client]);

  const handleOption = useCallback(
    async (optionId: string) => {
      if (!client || !pending) return;
      await client.respondPermission(pending.requestId, optionId);
      setPending(null);
    },
    [client, pending],
  );

  const handleDismiss = useCallback(async () => {
    if (!client || !pending) return;
    await client.respondPermission(pending.requestId, null);
    setPending(null);
  }, [client, pending]);

  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const allow = pending.options.find((o) => o.kind.startsWith("allow") && !o.kind.includes("always"));
        const fallback = pending.options.find((o) => o.kind.startsWith("allow"));
        if (allow || fallback) handleOption((allow ?? fallback)!.optionId);
        else handleOption("allow");
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pending, handleOption, handleDismiss]);

  if (!pending) return null;

  const toolName = pending.toolCall.title ?? pending.toolCall.toolCallId ?? 'unknown tool';

  const allowOpts = pending.options.filter((o) => o.kind.startsWith("allow"));
  const denyOpts = pending.options.filter((o) => !o.kind.startsWith("allow"));
  const alwaysOpt = allowOpts.find((o) => o.kind === "allow_always" || o.name.toLowerCase().includes("always"));
  const allowOnce = allowOpts.find((o) => o !== alwaysOpt) ?? allowOpts[0];

  return (
    <div className="perm-overlay">
      <div className="perm-modal">
        <div className="perm-badge">
          <span className="perm-dot" />
          <span className="perm-label">Permission Request</span>
        </div>

        <p className="perm-desc">Agent wants to run</p>
        <div className="perm-tool">{toolName}</div>

        <div className="perm-actions">
          {pending.options.length > 0 ? (
            <>
              <div className="perm-main-actions">
                {allowOnce && (
                  <button className="perm-btn perm-allow" onClick={() => handleOption(allowOnce.optionId)}>
                    Allow
                  </button>
                )}
                {denyOpts.length > 0 ? (
                  denyOpts.map((o) => (
                    <button key={o.optionId} className="perm-btn perm-deny" onClick={() => handleOption(o.optionId)}>
                      Reject
                    </button>
                  ))
                ) : (
                  <button className="perm-btn perm-deny" onClick={handleDismiss}>
                    Reject
                  </button>
                )}
              </div>
              {alwaysOpt && alwaysOpt !== allowOnce && (
                <button className="perm-always" onClick={() => handleOption(alwaysOpt.optionId)}>
                  Always allow this tool
                </button>
              )}
            </>
          ) : (
            <div className="perm-main-actions">
              <button className="perm-btn perm-allow" onClick={() => handleOption("allow")}>
                Allow
              </button>
              <button className="perm-btn perm-deny" onClick={handleDismiss}>
                Reject
              </button>
            </div>
          )}
        </div>

        <div className="perm-hint">
          <kbd>↵</kbd> allow · <kbd>esc</kbd> reject
        </div>
      </div>
    </div>
  );
}
