import { useCallback, useEffect, useRef } from "react";
import { wheelZoomFactor } from "../core/canvasViewport";

/** A pinch synthesizes ctrlKey without a physical Control keydown. */
export function useWheelZoomFactor() {
  const controlKeyDown = useRef(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Control") controlKeyDown.current = event.type === "keydown";
    };
    const blur = () => { controlKeyDown.current = false; };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return useCallback((event: { deltaY: number; deltaMode: number; ctrlKey?: boolean }) =>
    wheelZoomFactor(event, controlKeyDown.current), []);
}
