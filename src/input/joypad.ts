import type { Bus } from "@/bus/bus";
import { Button, DEFAULT_KEYBOARD_MAPPING } from "@/constants/joypad.constants";
import { INT } from "@/constants/memory.constants";
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

  reset(): void {
    this.pressed.fill(false);
    this.selectButtons = false;
    this.selectDpad = false;
  }

  attachKeyboard(target: Window | HTMLElement = window): void {
    this.detachKeyboard();
    this.keyTarget = target;
    target.addEventListener("keydown", this.onKeyDown, { capture: true });
    target.addEventListener("keyup", this.onKeyUp, { capture: true });
  }

  detachKeyboard(): void {
    if (!this.keyTarget) return;
    this.keyTarget.removeEventListener("keydown", this.onKeyDown, { capture: true } as EventListenerOptions);
    this.keyTarget.removeEventListener("keyup", this.onKeyUp, { capture: true } as EventListenerOptions);
    this.keyTarget = null;
  }

  /** Bind on-screen `[data-btn]` buttons (Chippy-style digital pad). */
  attachVirtualPad(root: ParentNode): void {
    this.detachVirtualPad();
    this.detachVirtual = attachVirtualPadElements(root, (b, p) => this.triggerButton(b, p));
  }

  detachVirtualPad(): void {
    this.detachVirtual?.();
    this.detachVirtual = null;
  }

  /** Enable Gamepad API (auto-detect + poll). */
  attachGamepad(options?: Partial<GamepadButtonMap>): void {
    this.gamepad.attach(options);
  }

  detachGamepad(): void {
    this.gamepad.detach();
  }

  onGamepadConnected(cb: ((pad: Gamepad) => void) | null): void {
    this.gamepad.onGamepadConnected(cb);
  }

  onGamepadDisconnected(cb: ((pad: Gamepad) => void) | null): void {
    this.gamepad.onGamepadDisconnected(cb);
  }

  getGamepads(): (Gamepad | null)[] {
    return this.gamepad.getGamepads();
  }

  setGamepadMap(map: Partial<GamepadButtonMap>): void {
    this.gamepad.setButtonMap(map);
  }

  setKeyMapping(code: string, button: Button): void {
    this.KeyboardMapping[code] = button;
  }

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

  isButtonPressed(button: Button): boolean {
    return this.pressed[button] ?? false;
  }

  writeP1(value: number): void {
    const prevNibble = this.readP1() & 0x0f;
    this.selectButtons = (value & 0x20) === 0;
    this.selectDpad = (value & 0x10) === 0;
    const nextNibble = this.readP1() & 0x0f;
    if ((prevNibble & nextNibble) !== prevNibble) {
      this.bus.requestInterrupt(INT.JOYPAD);
    }
  }

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

  private handleKey(e: KeyboardEvent, pressed: boolean): void {
    const button = this.KeyboardMapping[e.code];
    if (button === undefined) return;
    if (pressed && e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    this.triggerButton(button, pressed);
  }

  exportState(): Uint8Array {
    const buf = new Uint8Array(10);
    for (let i = 0; i < 8; i++) buf[i] = this.pressed[i] ? 1 : 0;
    buf[8] = this.selectButtons ? 1 : 0;
    buf[9] = this.selectDpad ? 1 : 0;
    return buf;
  }

  importState(data: Uint8Array, offset = 0): number {
    for (let i = 0; i < 8; i++) this.pressed[i] = data[offset + i]! !== 0;
    this.selectButtons = data[offset + 8]! !== 0;
    this.selectDpad = data[offset + 9]! !== 0;
    return 10;
  }
}
