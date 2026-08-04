/**
 * Gamepad Button Map
 * 
 * This file is responsible for mapping the gamepad buttons to the joypad buttons.
 * It is used to map the gamepad buttons to the joypad buttons.
 * It is also used to trigger the joypad buttons when the gamepad buttons are pressed.
 * It is also used to release the joypad buttons when the gamepad buttons are released.
 * It is also used to lost the joypad buttons when the gamepad buttons are lost.
 * It is also used to click the joypad buttons when the gamepad buttons are clicked.
 * It is also used to clean up the gamepad buttons when the gameboy is detached.
 */

import { Button } from "@/constants/joypad.constants";

export interface GamepadButtonMap {
  /** Standard gamepad button index → GB button */
  buttons: Record<number, Button>;
  /** Axis deadzone for left stick (default 0.4) */
  deadzone?: number;
}

const DEFAULT_MAP: GamepadButtonMap = {
  // Nintendo-style: B0=B, B1=A (also works for many USB pads)
  buttons: {
    0: Button.B,
    1: Button.A,
    8: Button.Select,
    9: Button.Start,
    12: Button.Up,
    13: Button.Down,
    14: Button.Left,
    15: Button.Right,
  },
  deadzone: 0.4,
};

type Trigger = (button: Button, pressed: boolean) => void;

/**
 * Gamepad API poller with connect/disconnect events.
 * Only emits edge transitions so keyboard/virtual pad holds aren't clobbered each frame.
 */
export class GamepadController {
  private map: GamepadButtonMap = { ...DEFAULT_MAP, buttons: { ...DEFAULT_MAP.buttons } };
  private attached = false;
  private rafId = 0;
  private lastButtons = new Map<Button, boolean>();
  private onConnected: ((pad: Gamepad) => void) | null = null;
  private onDisconnected: ((pad: Gamepad) => void) | null = null;
  private trigger: Trigger;

  private onConnect = (e: GamepadEvent): void => {
    this.onConnected?.(e.gamepad);
  };
  private onDisconnect = (e: GamepadEvent): void => {
    this.onDisconnected?.(e.gamepad);
  };

  constructor(trigger: Trigger) {
    this.trigger = trigger;
  }

  attach(options?: Partial<GamepadButtonMap>): void {
    if (this.attached) return;
    if (options?.buttons) this.map.buttons = { ...this.map.buttons, ...options.buttons };
    if (options?.deadzone !== undefined) this.map.deadzone = options.deadzone;
    this.attached = true;
    window.addEventListener("gamepadconnected", this.onConnect);
    window.addEventListener("gamepaddisconnected", this.onDisconnect);
    this.loop();
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener("gamepadconnected", this.onConnect);
    window.removeEventListener("gamepaddisconnected", this.onDisconnect);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    for (const [b, pressed] of this.lastButtons) {
      if (pressed) this.trigger(b, false);
    }
    this.lastButtons.clear();
  }

  setButtonMap(map: Partial<GamepadButtonMap>): void {
    if (map.buttons) this.map.buttons = { ...this.map.buttons, ...map.buttons };
    if (map.deadzone !== undefined) this.map.deadzone = map.deadzone;
  }

  onGamepadConnected(cb: ((pad: Gamepad) => void) | null): void {
    this.onConnected = cb;
  }

  onGamepadDisconnected(cb: ((pad: Gamepad) => void) | null): void {
    this.onDisconnected = cb;
  }

  getGamepads(): (Gamepad | null)[] {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
    return [...navigator.getGamepads()];
  }

  /** Poll once (also called from internal rAF). */
  poll(): void {
    if (!this.attached || typeof navigator === "undefined" || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const dz = this.map.deadzone ?? 0.4;

    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p) {
        pad = p;
        break;
      }
    }

    const next = new Map<Button, boolean>();
    if (pad) {
      for (const [idxStr, button] of Object.entries(this.map.buttons)) {
        const idx = Number(idxStr);
        if (pad.buttons[idx]?.pressed) next.set(button, true);
      }
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (ax <= -dz) next.set(Button.Left, true);
      if (ax >= dz) next.set(Button.Right, true);
      if (ay <= -dz) next.set(Button.Up, true);
      if (ay >= dz) next.set(Button.Down, true);
    }

    const allButtons = new Set<Button>([
      ...this.lastButtons.keys(),
      ...next.keys(),
    ]);
    for (const b of allButtons) {
      const was = this.lastButtons.get(b) === true;
      const now = next.get(b) === true;
      if (was !== now) this.trigger(b, now);
    }
    this.lastButtons = next;
  }

  private loop = (): void => {
    if (!this.attached) return;
    this.poll();
    this.rafId = requestAnimationFrame(this.loop);
  };
}
