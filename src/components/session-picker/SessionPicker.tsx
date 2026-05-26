import { useCallback, useEffect, useState } from "react";
import type { AcpClient } from "../../lib/acp-client";
import type { AcpSessionInfo } from "../../lib/acp-types";

interface Props {
  client: AcpClient;
  cwd: string;
  onResume: (sessionId: string) => void;
  onLoad: (sessionId: string) => void;
  onClose: () => void;
}

export function SessionPicker({ client, cwd, onResume, onLoad, onClose }: Props) {
  const [sessions, setSessions] = useState<AcpSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client
      .listSessions(cwd)
      .then((result) => {
        if (!cancelled) {
          setSessions(result.sessions);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [client, cwd]);

  const handleResume = useCallback(
    (id: string) => {
      onResume(id);
      onClose();
    },
    [onResume, onClose],
  );

  const handleLoad = useCallback(
    (id: string) => {
      onLoad(id);
      onClose();
    },
    [onLoad, onClose],
  );

  const formatTime = (ts: string | null | undefined) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return ts;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-1 border border-surface-2 rounded-lg p-4 min-w-[400px] max-w-[560px] max-h-[70vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-mono text-zinc-400 mb-3">Sessions</div>

        {loading && <div className="text-xs font-mono text-zinc-500 py-4 text-center">loading sessions...</div>}

        {error && <div className="text-xs font-mono text-red-400 py-4 text-center">{error}</div>}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-xs font-mono text-zinc-500 py-4 text-center">no sessions found</div>
        )}

        {!loading && !error && sessions.length > 0 && (
          <div className="flex flex-col gap-1 overflow-y-auto">
            {sessions.map((s) => (
              <div
                key={s.sessionId}
                className="flex items-center justify-between px-3 py-2 rounded text-xs font-mono text-zinc-300 hover:bg-surface-2 transition-colors group"
              >
                <div className="flex-1 min-w-0 mr-3">
                  <div className="truncate">{s.title ?? s.sessionId}</div>
                  <div className="text-zinc-600 text-[10px]">
                    {formatTime(s.updatedAt)}
                    {s.cwd && <span className="ml-2">{s.cwd}</span>}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleResume(s.sessionId)}
                    className="px-2 py-1 rounded bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors"
                  >
                    resume
                  </button>
                  <button
                    onClick={() => handleLoad(s.sessionId)}
                    className="px-2 py-1 rounded bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 transition-colors"
                  >
                    load
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
