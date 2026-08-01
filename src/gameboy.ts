import { Bus } from "@/bus/bus";
import { CPU } from "@/cpu/cpu";
import { Ppu } from "@/ppu/ppu";
import { Timer } from "@/timer/timer";
import { Joypad, Button, VirtualPadMapping } from "@/input/joypad";
import type { GamepadButtonMap } from "@/input/joypad";
import { Apu } from "@/apu/apu";
import { Screen, type ScaleMode, type ScreenOptions } from "@/display/screen";
import { createCartridge } from "@/cartridge/cartridge";
import { serializeSave, deserializeSave } from "@/cartridge/saveData";
import { createSavestate, loadSavestate } from "@/state/savestate";
import { CYCLES_PER_FRAME } from "@/constants/memory.constants";
import { selectBootRom } from "@/boot";
import {
  downloadBytes,
  loadLocalBase64,
  persistLocalBase64,
  readFileBytes,
  romIdFromFilename,
} from "@/host/files";

export { Button, VirtualPadMapping };
export type { Cartridge, CartridgeInfo } from "@/cartridge/cartridge";
export type { ScaleMode, ScreenOptions, GamepadButtonMap };
export { DMG_BOOT, CGB_BOOT } from "@/boot";

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
  private autoSave = false;
  private autoSavePrefix = "gbc-sav:";
  private stateSlots: (Uint8Array | null)[] = [];
  private fpsEl: HTMLElement | null = null;

  constructor(options?: { useBootRom?: boolean; autoSave?: boolean; autoSavePrefix?: string }) {
    if (options?.useBootRom !== undefined) this.useBootRom = options.useBootRom;
    if (options?.autoSave) this.autoSave = true;
    if (options?.autoSavePrefix) this.autoSavePrefix = options.autoSavePrefix;
    this.bus.joypad = this.joypad;
    this.bus.timer = this.timer;
    this.bus.ppu = this.ppu;
    this.bus.apu = this.apu;
    this.bus.onSramWrite = () => this.scheduleSaveFlush();
    if (this.autoSave) this.wireAutoSave();
  }

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

  /**
   * Attach a host canvas. The package paints each frame automatically.
   * Optional `onFrameFinished` still fires for FPS overlays / post-process.
   */
  attachScreen(canvas: HTMLCanvasElement, options?: ScreenOptions): void {
    this.screen.attach(canvas, options);
    this.screenAttached = true;
  }

  /** Update an element’s textContent with `FPS: N` each second. */
  attachFpsElement(el: HTMLElement): void {
    this.fpsEl = el;
  }

  setScale(n: number): void {
    this.screen.setScale(n);
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
    this.apu.unMute();
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

  private saveStorageKey(): string {
    return `${this.autoSavePrefix}${this.romId}`;
  }

  private stateStorageKey(slot: number): string {
    return `gbc-state:${this.romId}:${slot}`;
  }

  private autoSaveHandler = (data: Uint8Array): void => {
    persistLocalBase64(this.saveStorageKey(), data);
  };

  private wireAutoSave(): void {
    this.saveCb = this.autoSaveHandler;
  }

  /** Load battery save from localStorage for the current rom id (if any). */
  loadAutoSave(): boolean {
    const data = loadLocalBase64(this.saveStorageKey());
    if (!data || !this.bus.cartridge) return false;
    try {
      this.loadSave(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load a ROM from a File input, restore auto-save, enable sound, and run.
   * Typical host: `romInput.onchange = () => file && gb.loadRomFromFile(file)`
   */
  async loadRomFromFile(file: File): Promise<void> {
    this.pause();
    this.setRomId(romIdFromFilename(file.name));
    const rom = await readFileBytes(file);
    this.loadRom(rom);
    this.enableSound();
    if (this.muted) this.mute();
    else this.unMute();
    if (this.autoSave) this.loadAutoSave();
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
  }

  /** Soft reboot current ROM (keeps battery SRAM). */
  reload(): void {
    if (!this.romBytes) return;
    const sram = this.bus.cartridge?.sram.slice();
    const rtc = this.bus.cartridge?.rtc
      ? { ...this.bus.cartridge.rtc }
      : null;
    this.loadRom(this.romBytes);
    if (sram && this.bus.cartridge && sram.length === this.bus.cartridge.sram.length) {
      this.bus.cartridge.sram.set(sram);
    }
    if (rtc && this.bus.cartridge?.rtc) {
      Object.assign(this.bus.cartridge.rtc, rtc);
    }
    this.enableSound();
    if (this.muted) this.mute();
    else this.unMute();
    if (!this.running) this.run();
  }

  /**
   * Stop emulation and unload the current ROM.
   * Keeps keyboard/pad/gamepad attachments; ready for the next `loadRom`.
   */
  quit(): void {
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

  hasRom(): boolean {
    return this.romBytes !== null;
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
  }

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

  private presentFrame(): void {
    if (this.screenAttached) this.screen.present(this.ppu.frameBuffer);
    if (this.fpsEl) this.fpsEl.textContent = `FPS: ${this.fps}`;
    this.frameCb?.(this.ppu.frameBuffer, this.fps);
  }

  run(): void {
    if (this.running) return;
    if (!this.romBytes) return;
    this.running = true;
    this.lastTime = performance.now();
    this.fpsTimer = this.lastTime;
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(now - this.lastTime, 50);
      this.lastTime = now;

      const speed = this.bus.doubleSpeed ? 2 : 1;
      const budget = (CYCLES_PER_FRAME * speed * dt) / (1000 / 60);
      let cycles = 0;
      while (cycles < budget) {
        const c = this.cpu.step();
        const frameDone = this.advancePeripherals(c);
        cycles += c;
        this.cyclesThisFrame += c;
        if (frameDone) {
          this.frames++;
          this.presentFrame();
          this.cyclesThisFrame = 0;
        }
      }

      if (now - this.fpsTimer >= 1000) {
        this.fps = this.frames;
        this.frames = 0;
        this.fpsTimer = now;
      }

      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  pause(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.flushSaveSync();
  }

  step(): number {
    const c = this.cpu.step();
    const frameDone = this.advancePeripherals(c);
    if (frameDone) this.presentFrame();
    return c;
  }

  onFrameFinished(cb: (frame: ImageData, fps: number) => void): void {
    this.frameCb = cb;
  }

  hasBatterySave(): boolean {
    return this.bus.cartridge?.info.hasBattery === true && (this.bus.cartridge.sram.length > 0 || this.bus.cartridge.info.hasRtc);
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
  }

  onSaveRamUpdated(cb: (data: Uint8Array) => void): void {
    this.saveCb = cb;
    this.autoSave = false;
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

  private scheduleSaveFlush(): void {
    if (!this.saveCb || !this.hasBatterySave()) return;
    this.saveDirty = true;
    if (this.saveFlushTimer !== null) return;
    this.saveFlushTimer = setTimeout(() => {
      this.saveFlushTimer = null;
      this.flushSaveAsync();
    }, 250);
  }

  private flushSaveAsync(): void {
    if (!this.saveDirty || !this.saveCb) return;
    this.saveDirty = false;
    const data = this.getSave();
    if (!data) return;
    const copy = data.slice();
    const cb = this.saveCb;
    queueMicrotask(() => cb(copy));
  }

  private flushSaveSync(): void {
    if (this.saveFlushTimer !== null) {
      clearTimeout(this.saveFlushTimer);
      this.saveFlushTimer = null;
    }
    if (!this.saveDirty || !this.saveCb) return;
    this.saveDirty = false;
    const data = this.getSave();
    if (data) this.saveCb(data);
  }

  createState(): Uint8Array {
    return createSavestate(this);
  }

  loadState(data: Uint8Array): void {
    loadSavestate(this, data);
    this.apu.clearAudioBuffer();
  }
}
