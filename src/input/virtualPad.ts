/**
 * Virtual Pad
 * 
 * This file is responsible for attaching the virtual pad on-screen buttons to the document.
 * It is used to map the virtual pad on-screen buttons to the joypad buttons.
 * It is also used to trigger the joypad buttons when the virtual pad on-screen buttons are pressed.
 * It is also used to release the joypad buttons when the virtual pad on-screen buttons are released.
 * It is also used to lost the joypad buttons when the virtual pad on-screen buttons are lost.
 * It is also used to click the joypad buttons when the virtual pad on-screen buttons are clicked.
 * It is also used to clean up the virtual pad on-screen buttons when the gameboy is detached.
 */

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
