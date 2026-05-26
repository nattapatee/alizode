import { useCallback } from "react";

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", desc: "Fast, best coding" },
  { id: "claude-opus-4-6", label: "Opus 4.6", desc: "Deep reasoning" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", desc: "Quick, lightweight" },
];

interface Props {
  currentModel: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}

export function ModelPicker({ currentModel, onSelect, onClose }: Props) {
  const handleSelect = useCallback(
    (model: string) => {
      onSelect(model);
      onClose();
    },
    [onSelect, onClose],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-1 border border-surface-2 rounded-lg p-4 min-w-[320px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-mono text-zinc-400 mb-3">Select Model</div>
        <div className="flex flex-col gap-1">
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => handleSelect(m.id)}
              className={`flex items-center justify-between px-3 py-2 rounded text-left text-xs font-mono
                transition-colors hover:bg-surface-2
                ${currentModel === m.id ? "text-neon-cyan bg-surface-2" : "text-zinc-300"}`}
            >
              <div>
                <span className="font-semibold">{m.label}</span>
                <span className="text-zinc-600 ml-2">{m.desc}</span>
              </div>
              {currentModel === m.id && <span className="text-neon-cyan">●</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
