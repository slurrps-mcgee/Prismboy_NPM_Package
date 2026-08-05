import type { Bus } from "@/bus/bus";
import { Button, DEFAULT_KEYBOARD_MAPPING } from "@/constants/joypad.constants";
import { INT } from "@/constants/interrupt.constants";
import { attachVirtualPadElements, VirtualPadMapping } from "@/input/virtualPad";
import { GamepadController, type GamepadButtonMap } from "@/input/gamepad";

export { Button, VirtualPadMapping };
export type { GamepadButtonMap };

export class Joypad {
  KeyboardMapping: Record<string, Button> = { ...DEFAULT_KEYBOARD_MAPPING };

  private pressed = new Array<boolean>(8).fill(false);
  private selectButtons = false;
  private selectDpad = false;
  private keyTarget: Window | HTMLElement | null = null;
  private onKeyDown = (e: Event): void => this.handleKey(e as KeyboardEvent, true);
  private onKeyUp = (e: Event): void => this.handleKey(e as KeyboardEvent, false);
  private detachVirtual: (() => void) | null = null;
  private gamepad = new GamepadController((b, p) => this.triggerButton(b, p));

  constructor(private bus: Bus) {}

  // ── Public ──────────────────────────────────────────────────────────────

  // Reset the joypad
  reset(): void {
    this.pressed.fill(false);
    this.selectButtons = false;
    this.selectDpad = false;
  }

  // Attach the joypad to the keyboard
  attachKeyboard(target: Window | HTMLElement = window): void {
    this.detachKeyboard();
    this.keyTarget = target;
    target.addEventListener("keydown", this.onKeyDown, { capture: true });
    target.addEventListener("keyup", this.onKeyUp, { capture: true });
  }

  // Detach the joypad from the keyboard
  detachKeyboard(): void {
    if (!this.keyTarget) return;
    this.keyTarget.removeEventListener("keydown", this.onKeyDown, { capture: true } as EventListenerOptions);
    this.keyTarget.removeEventListener("keyup", this.onKeyUp, { capture: true } as EventListenerOptions);
    this.keyTarget = null;
  }

  // Bind on-screen `[data-btn]` buttons (Chippy-style digital pad).
  attachVirtualPad(root: ParentNode): void {
    this.detachVirtualPad();
    this.detachVirtual = attachVirtualPadElements(root, (b, p) => this.triggerButton(b, p));
  }

  // Detach the joypad from the virtual pad
  detachVirtualPad(): void {
    this.detachVirtual?.();
    this.detachVirtual = null;
  }

  // Enable Gamepad API (auto-detect + poll).
  attachGamepad(options?: Partial<GamepadButtonMap>): void {
    this.gamepad.attach(options);
  }

  // Detach the joypad from the gamepad
  detachGamepad(): void {
    this.gamepad.detach();
  }

  // On gamepad connected
  onGamepadConnected(cb: ((pad: Gamepad) => void) | null): void {
    this.gamepad.onGamepadConnected(cb);
  }

  // On gamepad disconnected
  onGamepadDisconnected(cb: ((pad: Gamepad) => void) | null): void {
    this.gamepad.onGamepadDisconnected(cb);
  }

  // Get the gamepads
  getGamepads(): (Gamepad | null)[] {
    return this.gamepad.getGamepads();
  }

  // First non-null pad currently used by the poller, if any.
  getActiveGamepad(): Gamepad | null {
    return this.gamepad.getActiveGamepad();
  }

  // Set the gamepad map
  setGamepadMap(map: Partial<GamepadButtonMap>): void {
    this.gamepad.setButtonMap(map);
  }

  // Set the key mapping
  setKeyMapping(code: string, button: Button): void {
    this.KeyboardMapping[code] = button;
  }

  // Trigger a button
  triggerButton(button: Button, pressed: boolean): void {
    const was = this.pressed[button];
    if (was === pressed) return;
    const prevNibble = this.readP1() & 0x0f;
    this.pressed[button] = pressed;
    const nextNibble = this.readP1() & 0x0f;
    if ((prevNibble & nextNibble) !== prevNibble) {
      this.bus.requestInterrupt(INT.JOYPAD);
    }
  }

  // Is button pressed
  isButtonPressed(button: Button): boolean {
    return this.pressed[button] ?? false;
  }

  // Release every button without firing extra interrupts unnecessarily.
  releaseAllButtons(): void {
    for (let i = 0; i < 8; i++) {
      if (this.pressed[i]) this.triggerButton(i as Button, false);
    }
  }

  // Write to the P1 register (P1 register is the joypad register)
  writeP1(value: number): void {
    const prevNibble = this.readP1() & 0x0f;
    this.selectButtons = (value & 0x20) === 0;
    this.selectDpad = (value & 0x10) === 0;
    const nextNibble = this.readP1() & 0x0f;
    if ((prevNibble & nextNibble) !== prevNibble) {
      this.bus.requestInterrupt(INT.JOYPAD);
    }
  }

  // Read from the P1 register (P1 register is the joypad register)
  readP1(): number {
    let result = 0xcf;
    if (this.selectButtons) result &= 0xef;
    if (this.selectDpad) result &= 0xdf;

    let low = 0x0f;
    if (this.selectDpad) {
      if (this.pressed[Button.Right]) low &= ~0x01;
      if (this.pressed[Button.Left]) low &= ~0x02;
      if (this.pressed[Button.Up]) low &= ~0x04;
      if (this.pressed[Button.Down]) low &= ~0x08;
    }
    if (this.selectButtons) {
      if (this.pressed[Button.A]) low &= ~0x01;
      if (this.pressed[Button.B]) low &= ~0x02;
      if (this.pressed[Button.Select]) low &= ~0x04;
      if (this.pressed[Button.Start]) low &= ~0x08;
    }
    if (!this.selectButtons && !this.selectDpad) low = 0x0f;
    return (result & 0xf0) | (low & 0x0f);
  }

  // Export the state of the joypad (state of the joypad is the state of the buttons)
  exportState(): Uint8Array {
    const buf = new Uint8Array(10);
    for (let i = 0; i < 8; i++) buf[i] = this.pressed[i] ? 1 : 0;
    buf[8] = this.selectButtons ? 1 : 0;
    buf[9] = this.selectDpad ? 1 : 0;
    return buf;
  }

  // Import the state of the joypad (state of the joypad is the state of the buttons)
  importState(data: Uint8Array, offset = 0): number {
    for (let i = 0; i < 8; i++) this.pressed[i] = data[offset + i]! !== 0;
    this.selectButtons = data[offset + 8]! !== 0;
    this.selectDpad = data[offset + 9]! !== 0;
    return 10;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  // Handle the key press
  private handleKey(e: KeyboardEvent, pressed: boolean): void {
    const button = this.KeyboardMapping[e.code];
    if (button === undefined) return;

    // Let form fields keep arrows / Enter / etc. for editing.
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    ) {
      return;
    }

    // Always block browser scroll/shortcuts for mapped keys (including key-repeat).
    e.preventDefault();
    e.stopPropagation();
    if (pressed && e.repeat) return;
    this.triggerButton(button, pressed);
  }
}
