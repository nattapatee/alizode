import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";

interface PeerMessage {
  message_id: string;
  from_lane: string;
  to_lane: string;
  request: string;
}

interface Toast extends PeerMessage {
  id: number;
}

let nextId = 0;

export function PeerToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const unlisten = listen<PeerMessage>("peer://message", (e) => {
      const toast: Toast = { ...e.payload, id: nextId++ };
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 5000);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-40 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-surface-1 border border-neon-cyan/30 rounded-lg p-3 shadow-lg
                     animate-in slide-in-from-right"
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
              <span className="text-[10px] font-mono text-neon-cyan uppercase tracking-wider">
                Peer Message
              </span>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-zinc-600 hover:text-zinc-400 text-xs"
            >
              ×
            </button>
          </div>
          <p className="text-xs text-zinc-400 font-mono mb-1">
            <span className="text-neon-green">{toast.from_lane}</span>
            {" → "}
            <span className="text-neon-amber">{toast.to_lane}</span>
          </p>
          <p className="text-xs text-zinc-300 font-mono line-clamp-3">
            {toast.request}
          </p>
        </div>
      ))}
    </div>
  );
}
