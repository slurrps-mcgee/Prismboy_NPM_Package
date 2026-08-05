import { Bus } from "@/bus/bus";
import { CPU } from "@/cpu/cpu";
import { Ppu } from "@/ppu/ppu";
import { Timer } from "@/timer/timer";
import { Joypad, Button, VirtualPadMapping } from "@/input/joypad";
import type { GamepadButtonMap } from "@/input/joypad";
import { Apu } from "@/apu/apu";
import { Screen, type ScaleMode, type ScreenOptions } from "@/display/screen";
import { createCartridge, type CartridgeInfo } from "@/cartridge/cartridge";
import { serializeSave, deserializeSave } from "@/cartridge/saveData";
import { createSavestate, loadSavestate } from "@/state/savestate";
import { CYCLES_PER_FRAME, SCREEN_WIDTH, SCREEN_HEIGHT } from "@/constants/memory.constants";
import { selectBootRom } from "@/boot";
import {
  downloadBytes,
  loadLocalBase64,
  persistLocalBase64,
  readFileBytes,
  romIdFromFilename,
} from "@/host/files";
import { EventEmitter, type GameBoyEvents } from "@/events/emitter";
import {
  BreakpointSet,
  type CpuRegisterState,
  type DisasmLine,
  type InterruptDebugState,
  type PpuDebugState,
  type TimerDebugState,
} from "@/debug/debug";
import { disassembleRange } from "@/cpu/disassembler";
import {
  applyColorCorrection,
  cloneDefaultPalette,
  normalizePalette,
  type DmgPalette,
} from "@/ppu/palette";
import { PACKAGE_VERSION } from "@/version";

export { Button, VirtualPadMapping };
export type { Cartridge, CartridgeInfo } from "@/cartridge/cartridge";
export type { ScaleMode, ScreenOptions, GamepadButtonMap };
export type { DmgPalette, Rgba } from "@/ppu/palette";
export type { GameBoyEvents } from "@/events/emitter";
export type {
  CpuRegisterState,
  PpuDebugState,
  TimerDebugState,
  InterruptDebugState,
  DisasmLine,
} from "@/debug/debug";
export { DMG_BOOT, CGB_BOOT } from "@/boot";

const SPEED_MIN = 0.25;
const SPEED_MAX = 8;

function clampSpeed(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));
}

export class GameBoy {
  readonly bus = new Bus();
  readonly cpu = new CPU(this.bus);
  readonly ppu = new Ppu(this.bus);
  readonly timer = new Timer(this.bus);
  readonly joypad = new Joypad(this.bus);
  readonly apu = new Apu();
  readonly screen = new Screen();

  private running = false;
  private rafId = 0;
  private cyclesThisFrame = 0;
  private totalCycles = 0;
  private totalFrames = 0;
  private lastTime = 0;
  private frames = 0;
  private fps = 0;
  private fpsTimer = 0;
  private frameCb: ((frame: ImageData, fps: number) => void) | null = null;
  private saveCb: ((data: Uint8Array) => void) | null = null;
  private cgbMode = false;
  private useBootRom = true;
  private romBytes: Uint8Array | null = null;
  private romId = "rom";
  private saveDirty = false;
  private saveFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Carry bit when mapping CPU T-cycles → LCD dots in double-speed mode. */
  private lcdPhase = 0;
  private screenAttached = false;
  private muted = false;
  /** Temporary mute while host speed > 1 (does not change user mute preference). */
  private speedMuted = false;
  private autoSave = false;
  private autoSavePrefix = "gbc-sav:";
  private stateSlots: (Uint8Array | null)[] = [];
  private fpsEl: HTMLElement | null = null;

  private speedMultiplier = 1;
  private turboEnabled = false;
  private turboMultiplier = 4;
  private colorCorrection = false;
  private presentScratch: ImageData | null = null;

  private readonly events = new EventEmitter<GameBoyEvents>();
  private readonly breakpoints = new BreakpointSet();
  private gamepadConnectedCb: ((pad: Gamepad) => void) | null = null;
  private gamepadDisconnectedCb: ((pad: Gamepad) => void) | null = null;

  constructor(options?: { useBootRom?: boolean; autoSave?: boolean; autoSavePrefix?: string }) {
    if (options?.useBootRom !== undefined) this.useBootRom = options.useBootRom;
    if (options?.autoSave) this.autoSave = true;
    if (options?.autoSavePrefix) this.autoSavePrefix = options.autoSavePrefix;
    this.bus.joypad = this.joypad;
    this.bus.timer = this.timer;
    this.bus.ppu = this.ppu;
    this.bus.apu = this.apu;
    this.bus.onSramWrite = () => this.scheduleSaveFlush();
    this.joypad.onGamepadConnected((pad) => {
      this.events.emit("gamepadconnected", pad);
      this.gamepadConnectedCb?.(pad);
    });
    this.joypad.onGamepadDisconnected((pad) => {
      this.events.emit("gamepaddisconnected", pad);
      this.gamepadDisconnectedCb?.(pad);
    });
    if (this.autoSave) this.wireAutoSave();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════════════

  // ── Events ──────────────────────────────────────────────────────────────

  on<K extends keyof GameBoyEvents>(event: K, handler: (...args: GameBoyEvents[K]) => void): void {
    this.events.on(event, handler);
  }

  off<K extends keyof GameBoyEvents>(event: K, handler: (...args: GameBoyEvents[K]) => void): void {
    this.events.off(event, handler);
  }

  // ── Boot / config ───────────────────────────────────────────────────────

  /** Prefer SameBoy open-source boot ROMs (default). Pass false to skip to cart entry. */
  setUseBootRom(enabled: boolean): void {
    this.useBootRom = enabled;
  }

  /**
   * Load a custom boot ROM (e.g. your own DMG/CGB dump).
   * Official Nintendo boot ROMs are copyrighted — only use dumps from hardware you own.
   * Pass null to restore the bundled SameBoy boot ROM on next loadRom/reload.
   */
  setBootRom(rom: Uint8Array | null): void {
    if (rom) {
      this.bus.setBootRom(rom);
      this.useBootRom = true;
    } else {
      this.bus.setBootRom(null);
    }
  }

  // ── Video / screen ──────────────────────────────────────────────────────

  /**
   * Attach a host canvas. The package paints each frame automatically.
   * Optional `onFrameFinished` still fires for FPS overlays / post-process.
   */
  attachScreen(canvas: HTMLCanvasElement, options?: ScreenOptions): void {
    this.screen.attach(canvas, options);
    this.screenAttached = true;
  }

  detachScreen(): void {
    this.screen.detach();
    this.screenAttached = false;
  }

  clearScreen(): void {
    this.screen.clear();
  }

  /** Update an element’s textContent with `FPS: N` each second. */
  attachFpsElement(el: HTMLElement): void {
    this.fpsEl = el;
  }

  setScale(n: number): void {
    this.screen.setScale(n);
  }

  getScale(): number {
    return this.screen.getScale();
  }

  setScaleMode(mode: ScaleMode): void {
    this.screen.setScaleMode(mode);
  }

  getScaleMode(): ScaleMode {
    return this.screen.getScaleMode();
  }

  toggleFullscreen(): Promise<void> {
    return this.screen.toggleFullscreen();
  }

  getFrameBuffer(): ImageData {
    return this.ppu.frameBuffer;
  }

  getWidth(): number {
    return SCREEN_WIDTH;
  }

  getHeight(): number {
    return SCREEN_HEIGHT;
  }

  /** Clone of the current framebuffer (ImageData). */
  takeScreenshot(): ImageData {
    const src = this.ppu.frameBuffer;
    const data = new Uint8ClampedArray(src.data);
    return typeof ImageData !== "undefined"
      ? new ImageData(data, src.width, src.height)
      : ({ data, width: src.width, height: src.height } as ImageData);
  }

  setPalette(colors: DmgPalette): void {
    this.ppu.setDmgPalette(normalizePalette(colors));
  }

  getPalette(): DmgPalette {
    return this.ppu.getDmgPalette();
  }

  /** Reset DMG shades to the built-in green-tinted greyscale. */
  resetPalette(): void {
    this.ppu.setDmgPalette(cloneDefaultPalette());
  }

  setColorCorrection(enabled: boolean): void {
    this.colorCorrection = enabled;
  }

  isColorCorrectionEnabled(): boolean {
    return this.colorCorrection;
  }

  // ── Audio ───────────────────────────────────────────────────────────────

  /** Sound helpers (also available via `gb.apu`). */
  enableSound(): void {
    this.apu.enableSound();
  }

  mute(): void {
    this.muted = true;
    this.apu.mute();
  }

  unMute(): void {
    this.muted = false;
    if (!this.speedMuted) this.apu.unMute();
  }

  /** Toggle mute; returns whether muted after the call. */
  toggleMute(): boolean {
    if (this.muted) this.unMute();
    else this.mute();
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(v: number): void {
    this.apu.setVolume(v);
  }

  getVolume(): number {
    return this.apu.getVolume();
  }

  // ── Speed / turbo ───────────────────────────────────────────────────────

  setSpeed(multiplier: number): void {
    this.speedMultiplier = clampSpeed(multiplier);
    this.applySpeedAudio();
  }

  getSpeed(): number {
    return this.speedMultiplier;
  }

  /** Effective host speed (turbo multiplier when turbo is on). */
  getEffectiveSpeed(): number {
    return this.turboEnabled ? this.turboMultiplier : this.speedMultiplier;
  }

  setTurboEnabled(enabled: boolean): void {
    this.turboEnabled = enabled;
    this.applySpeedAudio();
  }

  isTurboEnabled(): boolean {
    return this.turboEnabled;
  }

  toggleTurbo(): boolean {
    this.setTurboEnabled(!this.turboEnabled);
    return this.turboEnabled;
  }

  setTurboMultiplier(n: number): void {
    this.turboMultiplier = clampSpeed(n);
    this.applySpeedAudio();
  }

  getTurboMultiplier(): number {
    return this.turboMultiplier;
  }

  // ── Input facade ────────────────────────────────────────────────────────

  pressButton(button: Button): void {
    this.joypad.triggerButton(button, true);
  }

  releaseButton(button: Button): void {
    this.joypad.triggerButton(button, false);
  }

  releaseAllButtons(): void {
    this.joypad.releaseAllButtons();
  }

  isButtonPressed(button: Button): boolean {
    return this.joypad.isButtonPressed(button);
  }

  attachKeyboard(target?: Window | HTMLElement): void {
    this.joypad.attachKeyboard(target);
  }

  detachKeyboard(): void {
    this.joypad.detachKeyboard();
  }

  attachVirtualPad(root: ParentNode): void {
    this.joypad.attachVirtualPad(root);
  }

  detachVirtualPad(): void {
    this.joypad.detachVirtualPad();
  }

  attachGamepad(options?: Partial<GamepadButtonMap>): void {
    this.joypad.attachGamepad(options);
  }

  detachGamepad(): void {
    this.joypad.detachGamepad();
  }

  setKeyMapping(code: string, button: Button): void {
    this.joypad.setKeyMapping(code, button);
  }

  setGamepadMap(map: Partial<GamepadButtonMap>): void {
    this.joypad.setGamepadMap(map);
  }

  onGamepadConnected(cb: ((pad: Gamepad) => void) | null): void {
    this.gamepadConnectedCb = cb;
  }

  onGamepadDisconnected(cb: ((pad: Gamepad) => void) | null): void {
    this.gamepadDisconnectedCb = cb;
  }

  /** Currently polled gamepad (USB or Bluetooth), if any. */
  getActiveGamepad(): Gamepad | null {
    return this.joypad.getActiveGamepad();
  }

  getGamepads(): (Gamepad | null)[] {
    return this.joypad.getGamepads();
  }

  // ── Auto-save / ROM id ──────────────────────────────────────────────────

  /** Enable localStorage battery auto-save (debounced). */
  enableAutoSave(prefix = "gbc-sav:"): void {
    this.autoSave = true;
    this.autoSavePrefix = prefix;
    this.wireAutoSave();
  }

  disableAutoSave(): void {
    this.autoSave = false;
    if (this.saveCb === this.autoSaveHandler) this.saveCb = null;
  }

  getRomId(): string {
    return this.romId;
  }

  setRomId(id: string): void {
    this.romId = id || "rom";
  }

  loadAutoSave(): boolean {
    const data = loadLocalBase64(this.saveStorageKey());
    if (!data || !this.hasBatterySave()) return false;
    try {
      this.loadSave(data);
      return true;
    } catch (err) {
      console.warn("[GameBoy] loadAutoSave failed:", err);
      this.events.emit("error", err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  // ── ROM / lifecycle ─────────────────────────────────────────────────────

  async loadRomFromFile(file: File): Promise<void> {
    this.pause();
    this.setRomId(romIdFromFilename(file.name));
    const bytes = await readFileBytes(file);
    this.loadRom(bytes);
    try {
      this.enableSound();
    } catch (err) {
      this.events.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
    try {
      if (this.autoSave) this.loadAutoSave();
    } catch (err) {
      this.events.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
    if (this.muted) this.mute();
    else this.unMute();
    // Always start after a file load (pause() above guarantees we are stopped).
    this.run();
  }

  loadRom(rom: Uint8Array): void {
    this.romBytes = rom.slice();
    const cart = createCartridge(rom);
    this.cgbMode = (cart.info.cgbFlag & 0x80) !== 0;
    this.bus.loadCartridge(cart);
    if (this.useBootRom) {
      this.bus.setBootRom(selectBootRom(this.cgbMode));
    } else {
      this.bus.setBootRom(null);
    }
    this.reset();
    this.events.emit("romloaded", cart.info.title);
  }

  reload(): void {
    if (!this.romBytes) return;
    const sav = this.hasBatterySave() ? this.getSave() : null;
    this.loadRom(this.romBytes);
    if (sav) this.loadSave(sav);
    if (this.muted) this.mute();
    else this.unMute();
    if (!this.running) this.run();
  }

  /**
   * Stop emulation and unload the current ROM.
   * Keeps keyboard/pad/gamepad attachments; ready for the next `loadRom`.
   */
  unloadRom(): void {
    this.pause();
    this.joypad.reset();
    this.apu.clearAudioBuffer();
    this.apu.mute();
    this.romBytes = null;
    this.bus.cartridge = null;
    this.cgbMode = false;
    this.ppu.reset();
    this.screen.clear();
    this.cyclesThisFrame = 0;
    this.lcdPhase = 0;
    if (this.fpsEl) this.fpsEl.textContent = "FPS: —";
  }

  /** Alias of `unloadRom` for backward compatibility. */
  quit(): void {
    this.unloadRom();
  }

  hasRom(): boolean {
    return this.romBytes !== null;
  }

  isLoaded(): boolean {
    return this.hasRom();
  }

  reset(): void {
    const boot = this.useBootRom && !!this.bus.bootRom;
    this.bus.reset(this.cgbMode, boot);
    this.cpu.reset(this.cgbMode, boot);
    this.ppu.reset();
    this.timer.reset();
    this.joypad.reset();
    this.apu.reset();
    this.cyclesThisFrame = 0;
    this.lcdPhase = 0;
    this.events.emit("reset");
  }

  /** Start or continue the main run loop. */
  start(): void {
    this.run();
  }

  pause(): void {
    if (!this.running) {
      this.flushSaveSync();
      return;
    }
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.flushSaveSync();
    this.events.emit("pause");
  }

  /** Alias of `run`. */
  resume(): void {
    this.run();
  }

  /** Pause emulation but keep the ROM loaded. */
  stop(): void {
    this.pause();
  }

  /**
   * Tear down host attachments and unload. After destroy, create a new GameBoy.
   */
  destroy(): void {
    this.pause();
    this.detachKeyboard();
    this.detachVirtualPad();
    this.detachGamepad();
    this.detachScreen();
    this.apu.clearAudioBuffer();
    this.apu.mute();
    this.fpsEl = null;
    this.frameCb = null;
    this.saveCb = null;
    this.events.clear();
    this.breakpoints.clear();
    this.romBytes = null;
    this.bus.cartridge = null;
    this.cgbMode = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  isPaused(): boolean {
    return !this.running;
  }

  getFps(): number {
    return this.fps;
  }

  getFrameCount(): number {
    return this.totalFrames;
  }

  getCycles(): number {
    return this.totalCycles;
  }

  getTitle(): string | null {
    return this.bus.cartridge?.info.title ?? null;
  }

  isColorGame(): boolean {
    return this.cgbMode;
  }

  getRomInfo(): CartridgeInfo | null {
    return this.bus.cartridge?.info ?? null;
  }

  getCartridgeType(): number | null {
    return this.bus.cartridge?.info.type ?? null;
  }

  getSystemName(): string {
    return this.cgbMode ? "Game Boy Color" : "Game Boy";
  }

  getVersion(): string {
    return PACKAGE_VERSION;
  }

  // ── Stepping ────────────────────────────────────────────────────────────

  /** Execute one CPU instruction (+ peripherals). Returns T-cycles. */
  step(): number {
    return this.stepOnce().cycles;
  }

  /** Alias of `step`. */
  stepInstruction(): number {
    return this.step();
  }

  /** Run until the next completed frame. Returns cycles executed. */
  stepFrame(): number {
    let total = 0;
    for (let guard = 0; guard < 1_000_000; guard++) {
      const hit = this.stepOnce();
      total += hit.cycles;
      this.totalCycles += hit.cycles;
      if (hit.frameDone) {
        this.totalFrames++;
        this.presentFrame();
        this.cyclesThisFrame = 0;
        break;
      }
      if (hit.breakpoint) break;
    }
    return total;
  }

  /** Run until LY increments (or wraps). Returns cycles executed. */
  stepScanline(): number {
    const startLy = this.ppu.ly;
    let total = 0;
    for (let guard = 0; guard < 100_000; guard++) {
      const hit = this.stepOnce();
      total += hit.cycles;
      this.totalCycles += hit.cycles;
      if (hit.frameDone) {
        this.totalFrames++;
        this.presentFrame();
        this.cyclesThisFrame = 0;
      }
      if (this.ppu.ly !== startLy || hit.breakpoint) break;
    }
    return total;
  }

  // ── Saves / states ──────────────────────────────────────────────────────

  onFrameFinished(cb: (frame: ImageData, fps: number) => void): void {
    if (this.frameCb) this.events.off("frame", this.frameCb);
    this.frameCb = cb;
    this.events.on("frame", cb);
  }

  hasBatterySave(): boolean {
    return this.bus.cartridge?.info.hasBattery === true && (this.bus.cartridge.sram.length > 0 || this.bus.cartridge.info.hasRtc);
  }

  isSaveDirty(): boolean {
    return this.saveDirty;
  }

  getSave(): Uint8Array | null {
    const cart = this.bus.cartridge;
    if (!cart || !cart.info.hasBattery) return null;
    const rtc = cart.rtc
      ? { s: cart.rtc.s, m: cart.rtc.m, h: cart.rtc.h, dl: cart.rtc.dl, dh: cart.rtc.dh, lastUnixMs: cart.rtc.lastUnixMs }
      : null;
    return serializeSave(cart.sram, rtc);
  }

  loadSave(data: Uint8Array): void {
    const cart = this.bus.cartridge;
    if (!cart) throw new Error("No cartridge loaded");
    const { sram, rtc } = deserializeSave(data);
    if (sram.length && cart.sram.length) {
      cart.sram.set(sram.subarray(0, cart.sram.length));
    }
    if (rtc && cart.rtc) {
      cart.rtc.s = rtc.s;
      cart.rtc.m = rtc.m;
      cart.rtc.h = rtc.h;
      cart.rtc.dl = rtc.dl;
      cart.rtc.dh = rtc.dh;
      cart.rtc.lastUnixMs = rtc.lastUnixMs;
    }
    this.saveDirty = false;
  }

  onSaveRamUpdated(cb: (data: Uint8Array) => void): void {
    this.saveCb = cb;
    this.autoSave = false;
  }

  /** Set MBC3 RTC wall-clock base. No-op if cart has no RTC. */
  setRtc(date: Date): void {
    const rtc = this.bus.cartridge?.rtc;
    if (!rtc) return;
    rtc.lastUnixMs = date.getTime();
    rtc.s = date.getUTCSeconds() & 0xff;
    rtc.m = date.getUTCMinutes() & 0xff;
    rtc.h = date.getUTCHours() & 0xff;
    const day = Math.floor(date.getTime() / 86_400_000) % 512;
    rtc.dl = day & 0xff;
    rtc.dh = (rtc.dh & 0xfe) | ((day >> 8) & 1);
  }

  /** Download current battery `.sav` (no-op if none). */
  downloadSave(filename?: string): boolean {
    const data = this.getSave();
    if (!data) return false;
    downloadBytes(filename ?? `${this.romId}.sav`, data);
    return true;
  }

  /** Upload a battery save from a File input. */
  async loadSaveFromFile(file: File): Promise<void> {
    this.loadSave(await readFileBytes(file));
    if (this.autoSave) {
      const sav = this.getSave();
      if (sav) persistLocalBase64(this.saveStorageKey(), sav);
    }
  }

  /** Download a full savestate blob. */
  downloadState(filename?: string): void {
    if (!this.romBytes) return;
    downloadBytes(filename ?? `${this.romId}.state`, this.createState());
  }

  async loadStateFromFile(file: File): Promise<void> {
    const data = await readFileBytes(file);
    requestAnimationFrame(() => this.loadState(data));
  }

  /** In-memory + localStorage savestate slot (1-based). */
  saveStateSlot(slot: number): void {
    if (!this.romBytes) return;
    const state = this.createState();
    this.stateSlots[slot] = state;
    persistLocalBase64(this.stateStorageKey(slot), state);
  }

  loadStateSlot(slot: number): boolean {
    let data = this.stateSlots[slot] ?? null;
    if (!data) data = loadLocalBase64(this.stateStorageKey(slot));
    if (!data) return false;
    this.stateSlots[slot] = data;
    requestAnimationFrame(() => this.loadState(data!));
    return true;
  }

  createState(): Uint8Array {
    return createSavestate(this);
  }

  loadState(data: Uint8Array): void {
    loadSavestate(this, data);
    this.apu.clearAudioBuffer();
  }

  // ── Debug ───────────────────────────────────────────────────────────────

  readByte(address: number): number {
    return this.bus.read(address & 0xffff);
  }

  writeByte(address: number, value: number): void {
    this.bus.write(address & 0xffff, value & 0xff);
  }

  readMemory(address: number, length: number): Uint8Array {
    const out = new Uint8Array(Math.max(0, length));
    for (let i = 0; i < out.length; i++) {
      out[i] = this.bus.read((address + i) & 0xffff);
    }
    return out;
  }

  writeMemory(address: number, data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      this.bus.write((address + i) & 0xffff, data[i]!);
    }
  }

  getCpuRegisters(): CpuRegisterState {
    const r = this.cpu.registers;
    return {
      a: r.a,
      f: r.f,
      b: r.b,
      c: r.c,
      d: r.d,
      e: r.e,
      h: r.h,
      l: r.l,
      af: r.af,
      bc: r.bc,
      de: r.de,
      hl: r.hl,
      sp: r.sp,
      pc: r.pc,
      z: r.z,
      n: r.n,
      hFlag: r.hFlag,
      cy: r.cy,
      ime: this.cpu.ime,
      halted: this.cpu.halted,
      stopped: this.cpu.stopped,
    };
  }

  getPpuState(): PpuDebugState {
    const s = this.ppu.getDebugState();
    return {
      ...s,
      width: this.ppu.width,
      height: this.ppu.height,
    };
  }

  getTimerState(): TimerDebugState {
    return {
      div: this.timer.div,
      tima: this.timer.tima,
      tma: this.timer.tma,
      tac: this.timer.tac,
    };
  }

  getInterruptState(): InterruptDebugState {
    return {
      ie: this.bus.ie,
      if: this.bus.getIf(),
      ime: this.cpu.ime,
      imeScheduled: this.cpu.imeScheduled,
    };
  }

  setBreakpoint(address: number): void {
    this.breakpoints.add(address);
  }

  removeBreakpoint(address: number): void {
    this.breakpoints.remove(address);
  }

  clearBreakpoints(): void {
    this.breakpoints.clear();
  }

  getBreakpoints(): number[] {
    return this.breakpoints.list();
  }

  disassemble(address: number, count = 1): DisasmLine[] {
    return disassembleRange((a) => this.bus.read(a), address, count);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Private
  // ══════════════════════════════════════════════════════════════════════════
  // Run the gameboy
  private run(): void {
    if (this.running) return;
    if (!this.romBytes) return;
    this.running = true;
    this.lastTime = performance.now();
    this.fpsTimer = this.lastTime;
    const loop = (now: number) => {
      if (!this.running) return;
      // Floor dt so the first RAF tick still advances some cycles.
      const dt = Math.min(Math.max(now - this.lastTime, 1), 50);
      this.lastTime = now;

      const hwSpeed = this.bus.doubleSpeed ? 2 : 1;
      const hostSpeed = this.getEffectiveSpeed();
      const budget = (CYCLES_PER_FRAME * hwSpeed * hostSpeed * dt) / (1000 / 60);
      let cycles = 0;
      while (cycles < budget) {
        const hit = this.stepOnce();
        cycles += hit.cycles;
        this.cyclesThisFrame += hit.cycles;
        this.totalCycles += hit.cycles;
        if (hit.frameDone) {
          this.frames++;
          this.totalFrames++;
          this.presentFrame();
          this.cyclesThisFrame = 0;
        }
        if (hit.breakpoint) break;
      }

      if (now - this.fpsTimer >= 1000) {
        this.fps = this.frames;
        this.frames = 0;
        this.fpsTimer = now;
      }

      if (this.running) this.rafId = requestAnimationFrame(loop);
    };
    // Schedule the loop before emitting so a listener throw cannot skip RAF.
    this.rafId = requestAnimationFrame(loop);
    this.events.emit("resume");
  }

  // Step the CPU once
  private stepOnce(): { cycles: number; frameDone: boolean; breakpoint: boolean } {
    const beforePc = this.cpu.registers.pc;
    const c = this.cpu.step();
    const frameDone = this.advancePeripherals(c);
    let breakpoint = false;
    const pc = this.cpu.registers.pc;
    if (this.breakpoints.size > 0 && this.breakpoints.has(pc) && pc !== beforePc) {
      breakpoint = true;
      this.pause();
      this.events.emit("breakpoint", pc);
    }
    return { cycles: c, frameDone, breakpoint };
  }

  // Apply the speed of the audio
  private applySpeedAudio(): void {
    const fast = this.getEffectiveSpeed() > 1;
    if (fast && !this.speedMuted) {
      this.speedMuted = true;
      this.apu.mute();
    } else if (!fast && this.speedMuted) {
      this.speedMuted = false;
      if (!this.muted) this.apu.unMute();
    }
  }

  // Get the storage key for the save
  private saveStorageKey(): string {
    return `${this.autoSavePrefix}${this.romId}`;
  }

  // Get the storage key for the state
  private stateStorageKey(slot: number): string {
    return `gbc-state:${this.romId}:${slot}`;
  }

  // Handle the auto save
  private autoSaveHandler = (data: Uint8Array): void => {
    persistLocalBase64(this.saveStorageKey(), data);
  };

  // Wire the auto save
  private wireAutoSave(): void {
    this.saveCb = this.autoSaveHandler;
  }

  // Advance the peripherals
  private advancePeripherals(cpuCycles: number): boolean {
    this.timer.tick(cpuCycles);
    let lcdDots = cpuCycles;
    if (this.bus.doubleSpeed) {
      const total = cpuCycles + this.lcdPhase;
      lcdDots = total >> 1;
      this.lcdPhase = total & 1;
    }
    this.apu.tick(lcdDots);
    return this.ppu.tick(lcdDots);
  }

  // Present the frame
  private presentFrame(): void {
    let frame = this.ppu.frameBuffer;
    if (this.colorCorrection && this.cgbMode) {
      if (!this.presentScratch || this.presentScratch.data.length !== frame.data.length) {
        const data = new Uint8ClampedArray(frame.data.length);
        this.presentScratch =
          typeof ImageData !== "undefined"
            ? new ImageData(data, frame.width, frame.height)
            : ({ data, width: frame.width, height: frame.height } as ImageData);
      }
      this.presentScratch.data.set(frame.data);
      applyColorCorrection(this.presentScratch);
      frame = this.presentScratch;
    }
    if (this.screenAttached) this.screen.present(frame);
    if (this.fpsEl) this.fpsEl.textContent = `FPS: ${this.fps}`;
    this.events.emit("frame", frame, this.fps);
  }

  // Schedule the save flush
  private scheduleSaveFlush(): void {
    if (!this.hasBatterySave()) return;
    this.saveDirty = true;
    if (this.saveFlushTimer !== null) return;
    this.saveFlushTimer = setTimeout(() => {
      this.saveFlushTimer = null;
      this.flushSaveAsync();
    }, 250);
  }

  // Flush the save asynchronously
  private flushSaveAsync(): void {
    if (!this.saveDirty) return;
    this.saveDirty = false;
    const data = this.getSave();
    if (!data) return;
    const copy = data.slice();
    const cb = this.saveCb;
    queueMicrotask(() => {
      if (cb) cb(copy);
      this.events.emit("save", copy);
    });
  }

  // Flush the save synchronously
  private flushSaveSync(): void {
    if (this.saveFlushTimer !== null) {
      clearTimeout(this.saveFlushTimer);
      this.saveFlushTimer = null;
    }
    if (!this.saveDirty) return;
    this.saveDirty = false;
    const data = this.getSave();
    if (!data) return;
    if (this.saveCb) this.saveCb(data);
    this.events.emit("save", data);
  }
}
