/**
 * Gamepad API poller — keyboard/virtual-pad holds are preserved via edge transitions only.
 * Works with USB and Bluetooth controllers (Chrome/Firefox require a button press after
 * connect before `navigator.getGamepads()` lists the pad).
 */

import { Button } from "@/constants/joypad.constants";

export interface GamepadButtonMap {
  /** Gamepad button index → GB button */
  buttons: Record<number, Button>;
  /** Axis deadzone for left stick (default 0.35) */
  deadzone?: number;
}

/** W3C "standard" mapping (Xbox / most Bluetooth pads). */
const STANDARD_BUTTONS: Record<number, Button> = {
  0: Button.A, // bottom
  1: Button.B, // right
  2: Button.B, // left face (X) → B as extra
  3: Button.A, // top face (Y) → A as extra
  8: Button.Select,
  9: Button.Start,
  12: Button.Up,
  13: Button.Down,
  14: Button.Left,
  15: Button.Right,
};

/** Fallback when `pad.mapping` is empty (some BT / Nintendo-style reports). */
const DEFAULT_BUTTONS: Record<number, Button> = {
  0: Button.B,
  1: Button.A,
  2: Button.B,
  3: Button.A,
  6: Button.Select,
  7: Button.Start,
  8: Button.Select,
  9: Button.Start,
  12: Button.Up,
  13: Button.Down,
  14: Button.Left,
  15: Button.Right,
};

const DEFAULT_MAP: GamepadButtonMap = {
  buttons: { ...DEFAULT_BUTTONS },
  deadzone: 0.35,
};

type Trigger = (button: Button, pressed: boolean) => void;

/** rAF-polled Gamepad API with edge-only triggers so keyboard/virtual holds aren't stomped. */
export class GamepadController {
  // Properties
  private map: GamepadButtonMap = { ...DEFAULT_MAP, buttons: { ...DEFAULT_MAP.buttons } };
  private customButtons = false;
  private attached = false;
  private rafId = 0;
  private lastButtons = new Map<Button, boolean>();
  private knownIds = new Set<string>();
  private activePad: Gamepad | null = null;
  private onConnected: ((pad: Gamepad) => void) | null = null;
  private onDisconnected: ((pad: Gamepad) => void) | null = null;
  private trigger: Trigger;

  // Constructor
  constructor(trigger: Trigger) {
    this.trigger = trigger;
  }

  // ── Public ──────────────────────────────────────────────────────────────

  // Attach the gamepad controller to the gamepad
  attach(options?: Partial<GamepadButtonMap>): void {
    if (this.attached) return;
    if (options?.buttons) {
      this.map.buttons = { ...options.buttons };
      this.customButtons = true;
    }
    if (options?.deadzone !== undefined) this.map.deadzone = options.deadzone;
    this.attached = true;
    window.addEventListener("gamepadconnected", this.onConnect);
    window.addEventListener("gamepaddisconnected", this.onDisconnect);
    // Pads already connected before this page loaded often only appear after a press;
    // still scan once and keep polling so they light up as soon as the browser exposes them.
    this.scanNewPads();
    this.loop();
  }

  // Detach the gamepad controller from the gamepad
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
    this.knownIds.clear();
    this.activePad = null;
  }

  // Set the button map of the gamepad controller
  setButtonMap(map: Partial<GamepadButtonMap>): void {
    if (map.buttons) {
      this.map.buttons = { ...this.map.buttons, ...map.buttons };
      this.customButtons = true;
    }
    if (map.deadzone !== undefined) this.map.deadzone = map.deadzone;
  }

  // On gamepad connected
  onGamepadConnected(cb: ((pad: Gamepad) => void) | null): void {
    this.onConnected = cb;
  }

  // On gamepad disconnected
  onGamepadDisconnected(cb: ((pad: Gamepad) => void) | null): void {
    this.onDisconnected = cb;
  }

  // Get the gamepads
  getGamepads(): (Gamepad | null)[] {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
    return [...navigator.getGamepads()];
  }

  // Get the active gamepad
  getActiveGamepad(): Gamepad | null {
    return this.activePad;
  }

  // Poll once (also called from internal rAF).
  poll(): void {
    if (!this.attached || typeof navigator === "undefined" || !navigator.getGamepads) return;
    this.scanNewPads();

    const pads = navigator.getGamepads();
    const dz = this.map.deadzone ?? 0.35;
    const next = new Map<Button, boolean>();

    // Merge all connected pads (Bluetooth + USB) so any active controller works.
    let chosen: Gamepad | null = null;
    for (const p of pads) {
      if (!p || p.buttons.length === 0) continue;
      chosen = p;
      this.applyPad(p, dz, next);
    }
    this.activePad = chosen;

    const allButtons = new Set<Button>([...this.lastButtons.keys(), ...next.keys()]);
    for (const b of allButtons) {
      const was = this.lastButtons.get(b) === true;
      const now = next.get(b) === true;
      if (was !== now) this.trigger(b, now);
    }
    this.lastButtons = next;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  // Loop
  private loop = (): void => {
    if (!this.attached) return;
    this.poll();
    this.rafId = requestAnimationFrame(this.loop);
  };

  // Pad key
  private padKey(pad: Gamepad): string {
    return `${pad.index}:${pad.id}`;
  }

  // Remember pad
  private rememberPad(pad: Gamepad): void {
    this.knownIds.add(this.padKey(pad));
  }

  // Fire connect for pads that appear in getGamepads() without a prior event.
  private scanNewPads(): void {
    for (const p of this.getGamepads()) {
      if (!p) continue;
      const key = this.padKey(p);
      if (this.knownIds.has(key)) continue;
      this.rememberPad(p);
      this.onConnected?.(p);
    }
  }

  // Is button down
  private isButtonDown(btn: GamepadButton | undefined): boolean {
    if (!btn) return false;
    return btn.pressed || btn.value >= 0.5;
  }

  // Button map for
  private buttonMapFor(pad: Gamepad): Record<number, Button> {
    if (this.customButtons) return this.map.buttons;
    return pad.mapping === "standard" ? STANDARD_BUTTONS : DEFAULT_BUTTONS;
  }

  // Apply pad
  private applyPad(pad: Gamepad, dz: number, next: Map<Button, boolean>): void {
    const buttons = this.buttonMapFor(pad);
    for (const [idxStr, button] of Object.entries(buttons)) {
      const idx = Number(idxStr);
      if (this.isButtonDown(pad.buttons[idx])) next.set(button, true);
    }
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    if (ax <= -dz) next.set(Button.Left, true);
    if (ax >= dz) next.set(Button.Right, true);
    if (ay <= -dz) next.set(Button.Up, true);
    if (ay >= dz) next.set(Button.Down, true);
  }

  // On connect
  private onConnect = (e: GamepadEvent): void => {
    this.rememberPad(e.gamepad);
    this.onConnected?.(e.gamepad);
  };

  // On disconnect
  private onDisconnect = (e: GamepadEvent): void => {
    this.knownIds.delete(this.padKey(e.gamepad));
    if (this.activePad && this.padKey(this.activePad) === this.padKey(e.gamepad)) {
      this.activePad = null;
    }
    this.onDisconnected?.(e.gamepad);
  };
}
