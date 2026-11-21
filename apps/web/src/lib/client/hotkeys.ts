"use client";

import { useEffect, useRef } from "react";

// Skróty klawiszowe ekranu. Nie działają w polach tekstowych ani przy wciśniętym Alt/Meta.
// Klucz: litera/cyfra („j”, „1”), „Enter”, „Escape” albo „ctrl+z”.
export function useHotkeys(map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      if (event.altKey || event.metaKey) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const name = event.ctrlKey ? `ctrl+${key}` : key;
      const action = ref.current[name];
      if (action) {
        event.preventDefault();
        action();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
