import { useCallback } from "react";
import type { AcpConfigOption } from "../../lib/acp-types";

interface Props {
  option: AcpConfigOption;
  onSelect: (configId: string, value: string) => void;
  onClose: () => void;
}

export function ConfigPicker({ option, onSelect, onClose }: Props) {
  const handleSelect = useCallback(
    (value: string) => {
      onSelect(option.id, value);
      onClose();
    },
    [option.id, onSelect, onClose],
  );

  const options = option.options ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-1 border border-surface-2 rounded-lg p-4 min-w-[320px] max-w-[400px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-mono text-zinc-400 mb-1">{option.name}</div>
        {option.description && (
          <div className="text-[10px] text-zinc-600 mb-3">{option.description}</div>
        )}
        <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => handleSelect(o.value)}
              className={`flex items-center justify-between px-3 py-2 rounded text-left text-xs font-mono
                transition-colors hover:bg-surface-2
                ${option.currentValue === o.value ? "text-neon-cyan bg-surface-2" : "text-zinc-300"}`}
            >
              <div className="min-w-0">
                <span className="font-semibold">{o.name}</span>
                {o.description && (
                  <span className="text-zinc-600 ml-2 truncate">{o.description}</span>
                )}
              </div>
              {option.currentValue === o.value && <span className="text-neon-cyan ml-2 shrink-0">●</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
