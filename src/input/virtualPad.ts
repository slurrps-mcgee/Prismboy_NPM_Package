import { Button } from "@/constants/joypad.constants";

/** HTML `data-btn` attribute → Button (for custom on-screen pads). */
export const VirtualPadMapping: Record<string, Button> = {
  Right: Button.Right,
  Left: Button.Left,
  Up: Button.Up,
  Down: Button.Down,
  A: Button.A,
  B: Button.B,
  Select: Button.Select,
  Start: Button.Start,
};

type Trigger = (button: Button, pressed: boolean) => void;

/**
 * Bind `[data-btn]` elements under `root` to joypad buttons with pointer capture.
 */
export function attachVirtualPadElements(root: ParentNode, trigger: Trigger): () => void {
  const cleanups: Array<() => void> = [];

  root.querySelectorAll<HTMLElement>("[data-btn]").forEach((el) => {
    const name = el.dataset.btn!;
    const button = VirtualPadMapping[name];
    if (button === undefined) return;

    el.tabIndex = -1;
    let activePointer: number | null = null;

    const down = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (activePointer !== null) return;
      activePointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      trigger(button, true);
    };
    const up = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (activePointer !== e.pointerId) return;
      activePointer = null;
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      trigger(button, false);
    };
    const lost = () => {
      if (activePointer !== null) {
        activePointer = null;
        trigger(button, false);
      }
    };
    const click = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", lost);
    el.addEventListener("click", click);

    cleanups.push(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", lost);
      el.removeEventListener("click", click);
    });
  });

  return () => {
    for (const c of cleanups) c();
  };
}
