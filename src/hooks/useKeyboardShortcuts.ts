import { useEffect } from "react";

interface Actions {
  createLane: () => void;
  deleteLane: () => void;
  prevLane: () => void;
  nextLane: () => void;
  cancelLane: () => void;
}

export function useKeyboardShortcuts(actions: Actions) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "t") {
        e.preventDefault();
        actions.createLane();
        return;
      }

      if (meta && e.key === "w") {
        e.preventDefault();
        actions.deleteLane();
        return;
      }

      if (meta && e.key === "[") {
        e.preventDefault();
        actions.prevLane();
        return;
      }

      if (meta && e.key === "]") {
        e.preventDefault();
        actions.nextLane();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        actions.cancelLane();
        return;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions]);
}
