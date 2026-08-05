import type { Cartridge } from "@/cartridge/cartridge";
import { IO, VRAM_SIZE, OAM_SIZE, HRAM_SIZE, BOOT_ROM_DISABLE } from "@/constants/memory.constants";
import type { Joypad } from "@/input/joypad";
import type { Timer } from "@/timer/timer";
import type { Ppu } from "@/ppu/ppu";
import type { Apu } from "@/apu/apu";

/** Memory map + IO routing (cart, VRAM/WRAM banks, DMA/HDMA, boot ROM). */
export class Bus {
  cartridge: Cartridge | null = null;
  joypad: Joypad | null = null;
  timer: Timer | null = null;
  ppu: Ppu | null = null;
  apu: Apu | null = null;

  vram = [new Uint8Array(VRAM_SIZE), new Uint8Array(VRAM_SIZE)];
  wram = Array.from({ length: 8 }, () => new Uint8Array(0x1000));
  oam = new Uint8Array(OAM_SIZE);
  hram = new Uint8Array(HRAM_SIZE);
  io = new Uint8Array(0x80);
  ie = 0;

  vramBank = 0;
  wramBank = 1;
  cgbMode = false;
  doubleSpeed = false;
  key1 = 0;

  /** CGB palette RAM */
  bgPalette = new Uint8Array(64);
  objPalette = new Uint8Array(64);
  bcps = 0;
  ocps = 0;

  /** HDMA */
  hdmaSrc = 0;
  hdmaDst = 0;
  hdmaLength = 0;
  hdmaActive = false;

  /** Boot ROM (SameBoy open-source DMG/CGB). Unmapped by write to FF50. */
  bootRom: Uint8Array | null = null;
  bootRomEnabled = false;

  onSramWrite: (() => void) | null = null;

  // ── Public ──────────────────────────────────────────────────────────────

  // Reset the bus
  reset(cgb: boolean, useBootRom: boolean): void {
    this.cgbMode = cgb;
    this.vram = [new Uint8Array(VRAM_SIZE), new Uint8Array(VRAM_SIZE)];
    this.wram = Array.from({ length: 8 }, () => new Uint8Array(0x1000));
    this.oam.fill(0);
    this.hram.fill(0);
    this.io.fill(0);
    this.ie = 0;
    this.vramBank = 0;
    this.wramBank = 1;
    this.doubleSpeed = false;
    this.key1 = 0;
    this.bgPalette.fill(0xff);
    this.objPalette.fill(0xff);
    this.bcps = 0;
    this.ocps = 0;
    this.hdmaActive = false;
    this.hdmaLength = 0;
    this.hdmaSrc = 0;
    this.hdmaDst = 0;
    this.io[IO.HDMA5 - 0xff00] = 0xff;
    this.bootRomEnabled = useBootRom && !!this.bootRom;

    if (!useBootRom) {
      // Post-boot IO defaults (skip boot ROM path)
      this.io[IO.NR10 - 0xff00] = 0x80;
      this.io[IO.NR11 - 0xff00] = 0xbf;
      this.io[IO.NR12 - 0xff00] = 0xf3;
      this.io[IO.NR14 - 0xff00] = 0xbf;
      this.io[IO.NR21 - 0xff00] = 0x3f;
      this.io[IO.NR24 - 0xff00] = 0xbf;
      this.io[IO.NR30 - 0xff00] = 0x7f;
      this.io[IO.NR31 - 0xff00] = 0xff;
      this.io[IO.NR32 - 0xff00] = 0x9f;
      this.io[IO.NR34 - 0xff00] = 0xbf;
      this.io[IO.NR41 - 0xff00] = 0xff;
      this.io[IO.NR44 - 0xff00] = 0xbf;
      this.io[IO.NR50 - 0xff00] = 0x77;
      this.io[IO.NR51 - 0xff00] = 0xf3;
      this.io[IO.NR52 - 0xff00] = 0xf1;
      this.io[IO.LCDC - 0xff00] = 0x91;
      this.io[IO.STAT - 0xff00] = 0x85;
      this.io[IO.BGP - 0xff00] = 0xfc;
      this.io[IO.IF - 0xff00] = 0xe1;
      this.io[BOOT_ROM_DISABLE - 0xff00] = 0xff;
    } else {
      this.io[BOOT_ROM_DISABLE - 0xff00] = 0x00;
    }
  }

  // Set the boot ROM
  setBootRom(rom: Uint8Array | null): void {
    this.bootRom = rom;
  }

  // Load the cartridge
  loadCartridge(cart: Cartridge): void {
    this.cartridge = cart;
    cart.onSramWrite = () => this.onSramWrite?.();
  }

  // Read from the bus
  read(addr: number): number {
    addr &= 0xffff;
    if (addr < 0x8000) return this.readBootOrCart(addr);
    if (addr < 0xa000) return this.vram[this.vramBank]![addr - 0x8000]!;
    if (addr < 0xc000) return this.cartridge?.read(addr) ?? 0xff;
    if (addr < 0xd000) return this.wram[0]![addr - 0xc000]!;
    if (addr < 0xe000) return this.wram[this.wramBank]![addr - 0xd000]!;
    if (addr < 0xfe00) {
      // Echo RAM → WRAM (direct, avoid recursive read)
      const echo = addr - 0x2000;
      return echo < 0xd000
        ? this.wram[0]![echo - 0xc000]!
        : this.wram[this.wramBank]![echo - 0xd000]!;
    }
    if (addr < 0xfea0) return this.oam[addr - 0xfe00]!;
    if (addr < 0xff00) return 0xff;
    if (addr < 0xff80) return this.readIo(addr);
    if (addr < 0xffff) return this.hram[addr - 0xff80]!;
    return this.ie;
  }

  // Write to the bus
  write(addr: number, value: number): void {
    addr &= 0xffff;
    value &= 0xff;
    if (addr < 0x8000) {
      this.cartridge?.write(addr, value);
      return;
    }
    if (addr < 0xa000) {
      this.vram[this.vramBank]![addr - 0x8000] = value;
      return;
    }
    if (addr < 0xc000) {
      this.cartridge?.write(addr, value);
      return;
    }
    if (addr < 0xd000) {
      this.wram[0]![addr - 0xc000] = value;
      return;
    }
    if (addr < 0xe000) {
      this.wram[this.wramBank]![addr - 0xd000] = value;
      return;
    }
    if (addr < 0xfe00) {
      // Echo RAM → WRAM (direct, avoid recursive write)
      const echo = addr - 0x2000;
      if (echo < 0xd000) this.wram[0]![echo - 0xc000] = value;
      else this.wram[this.wramBank]![echo - 0xd000] = value;
      return;
    }
    if (addr < 0xfea0) {
      this.oam[addr - 0xfe00] = value;
      return;
    }
    if (addr < 0xff00) return;
    if (addr < 0xff80) {
      this.writeIo(addr, value);
      return;
    }
    if (addr < 0xffff) {
      this.hram[addr - 0xff80] = value;
      return;
    }
    this.ie = value;
  }

  // Transfer one 16-byte block during HBlank (LY=0..143).
  tickHdma(): void {
    if (!this.hdmaActive || this.hdmaLength <= 0) return;
    const copied = this.copyVramDma(16);
    this.hdmaLength -= 16;
    // Destination overflow ends the transfer early
    if (this.hdmaLength <= 0 || copied < 16) {
      this.hdmaActive = false;
      this.hdmaLength = 0;
      this.io[IO.HDMA5 - 0xff00] = 0xff;
    } else {
      this.io[IO.HDMA5 - 0xff00] = (Math.floor(this.hdmaLength / 16) - 1) & 0x7f;
    }
  }

  // Request an interrupt
  requestInterrupt(bit: number): void {
    this.io[IO.IF - 0xff00] = (this.io[IO.IF - 0xff00]! | bit) | 0xe0;
  }

  // Get the interrupt flag
  getIf(): number {
    return this.io[IO.IF - 0xff00]!;
  }

  // Set the interrupt flag
  setIf(v: number): void {
    this.io[IO.IF - 0xff00] = v | 0xe0;
  }

  // Export the state of the bus
  exportState(): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const bank of this.vram) parts.push(bank);
    for (const bank of this.wram) parts.push(bank);
    parts.push(this.oam, this.hram, this.io);
    const meta = new Uint8Array(16);
    meta[0] = this.ie;
    meta[1] = this.vramBank;
    meta[2] = this.wramBank;
    meta[3] = this.cgbMode ? 1 : 0;
    meta[4] = this.doubleSpeed ? 1 : 0;
    meta[5] = this.key1;
    meta[6] = this.bcps;
    meta[7] = this.ocps;
    meta[8] = this.hdmaActive ? 1 : 0;
    const view = new DataView(meta.buffer);
    view.setUint16(9, this.hdmaSrc, true);
    view.setUint16(11, this.hdmaDst, true);
    view.setUint16(13, this.hdmaLength, true);
    parts.push(meta, this.bgPalette, this.objPalette);
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  // Import the state of the bus
  importState(data: Uint8Array, offset = 0): number {
    let o = offset;
    for (let i = 0; i < 2; i++) {
      this.vram[i] = data.slice(o, o + VRAM_SIZE);
      o += VRAM_SIZE;
    }
    for (let i = 0; i < 8; i++) {
      this.wram[i] = data.slice(o, o + 0x1000);
      o += 0x1000;
    }
    this.oam = data.slice(o, o + OAM_SIZE);
    o += OAM_SIZE;
    this.hram = data.slice(o, o + HRAM_SIZE);
    o += HRAM_SIZE;
    this.io = data.slice(o, o + 0x80);
    o += 0x80;
    this.ie = data[o]!;
    this.vramBank = data[o + 1]!;
    this.wramBank = data[o + 2]!;
    this.cgbMode = data[o + 3]! !== 0;
    this.doubleSpeed = data[o + 4]! !== 0;
    this.key1 = data[o + 5]!;
    this.bcps = data[o + 6]!;
    this.ocps = data[o + 7]!;
    this.hdmaActive = data[o + 8]! !== 0;
    const view = new DataView(data.buffer, data.byteOffset + o);
    this.hdmaSrc = view.getUint16(9, true);
    this.hdmaDst = view.getUint16(11, true);
    this.hdmaLength = view.getUint16(13, true);
    o += 16;
    this.bgPalette = data.slice(o, o + 64);
    o += 64;
    this.objPalette = data.slice(o, o + 64);
    o += 64;
    return o - offset;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  // Read from the boot ROM or the cartridge
  private readBootOrCart(addr: number): number {
    if (this.bootRomEnabled && this.bootRom) {
      // DMG: 0000-00FF. CGB: 0000-00FF + 0200-08FF. Header 0100-01FF always cart.
      // See https://gbdev.io/pandocs/Memory_Map.html
      if (addr < 0x100) return this.bootRom[addr] ?? 0xff;
      if (this.cgbMode && addr >= 0x200 && addr < 0x900) {
        return this.bootRom[addr] ?? 0xff;
      }
    }
    return this.cartridge?.read(addr) ?? 0xff;
  }

  // Read from the IO
  private readIo(addr: number): number {
    switch (addr) {
      case IO.P1:
        return this.joypad?.readP1() ?? 0xff;
      case IO.DIV:
      case IO.TIMA:
      case IO.TMA:
      case IO.TAC:
        return this.timer?.read(addr) ?? this.io[addr - 0xff00]!;
      case IO.LY:
        return this.ppu?.ly ?? this.io[addr - 0xff00]!;
      case IO.STAT:
        return this.ppu?.readStat() ?? this.io[addr - 0xff00]!;
      case IO.VBK:
        return this.cgbMode ? (0xfe | this.vramBank) : 0xff;
      case IO.SVBK:
        return this.cgbMode ? (0xf8 | this.wramBank) : 0xff;
      case IO.KEY1:
        return this.cgbMode ? ((this.key1 & 0x7f) | (this.doubleSpeed ? 0x80 : 0)) : 0xff;
      case IO.BCPS:
        return this.bcps;
      case IO.BCPD:
        return this.bgPalette[this.bcps & 0x3f]!;
      case IO.OCPS:
        return this.ocps;
      case IO.OCPD:
        return this.objPalette[this.ocps & 0x3f]!;
      case IO.HDMA5:
        // Active: bit7=0 + remaining blocks-1. Idle after finish: $FF.
        // After abort: bit7=1 + remaining blocks-1 (not $FF).
        if (!this.cgbMode) return 0xff;
        if (this.hdmaActive) return this.io[IO.HDMA5 - 0xff00]! & 0x7f;
        return this.io[IO.HDMA5 - 0xff00]!;
      default:
        if (addr >= IO.NR10 && addr <= 0xff3f) return this.apu?.read(addr) ?? this.io[addr - 0xff00]!;
        return this.io[addr - 0xff00]!;
    }
  }

  // Write to the IO
  private writeIo(addr: number, value: number): void {
    switch (addr) {
      case BOOT_ROM_DISABLE:
        this.io[addr - 0xff00] = value;
        if (value !== 0) this.bootRomEnabled = false;
        return;
      case IO.P1:
        this.joypad?.writeP1(value);
        this.io[0] = value;
        return;
      case IO.DIV:
      case IO.TIMA:
      case IO.TMA:
      case IO.TAC:
        this.timer?.write(addr, value);
        return;
      case IO.DMA:
        this.io[addr - 0xff00] = value;
        this.startDma(value);
        return;
      case IO.LY:
        return; // read-only
      case IO.STAT:
        this.io[addr - 0xff00] = (value & 0x78) | (this.io[addr - 0xff00]! & 0x07);
        this.ppu?.writeStat(value);
        return;
      case IO.LCDC:
        this.io[addr - 0xff00] = value;
        this.ppu?.writeLcdc(value);
        return;
      case IO.WY:
        this.io[addr - 0xff00] = value;
        this.ppu?.onWyWrite();
        return;
      case IO.VBK:
        if (this.cgbMode) this.vramBank = value & 1;
        return;
      case IO.SVBK:
        if (this.cgbMode) {
          this.wramBank = value & 7;
          if (this.wramBank === 0) this.wramBank = 1;
        }
        return;
      case IO.KEY1:
        if (this.cgbMode) this.key1 = value & 1;
        return;
      case IO.BCPS:
        this.bcps = value;
        return;
      case IO.BCPD:
        this.bgPalette[this.bcps & 0x3f] = value;
        if (this.bcps & 0x80) this.bcps = (this.bcps & 0x80) | (((this.bcps & 0x3f) + 1) & 0x3f);
        return;
      case IO.OCPS:
        this.ocps = value;
        return;
      case IO.OCPD:
        this.objPalette[this.ocps & 0x3f] = value;
        if (this.ocps & 0x80) this.ocps = (this.ocps & 0x80) | (((this.ocps & 0x3f) + 1) & 0x3f);
        return;
      case IO.HDMA1:
        this.hdmaSrc = (this.hdmaSrc & 0x00ff) | (value << 8);
        return;
      case IO.HDMA2:
        this.hdmaSrc = (this.hdmaSrc & 0xff00) | (value & 0xf0);
        return;
      case IO.HDMA3:
        this.hdmaDst = (this.hdmaDst & 0x00ff) | ((value & 0x1f) << 8);
        return;
      case IO.HDMA4:
        this.hdmaDst = (this.hdmaDst & 0xff00) | (value & 0xf0);
        return;
      case IO.HDMA5:
        this.startHdma(value);
        return;
      default:
        if (addr >= IO.NR10 && addr <= 0xff3f) {
          this.apu?.write(addr, value);
          this.io[addr - 0xff00] = value;
          return;
        }
        this.io[addr - 0xff00] = value;
    }
  }

  // Instant OAM DMA copy from page<<8 (not cycle-accurate)
  private startDma(page: number): void {
    const src = page << 8;
    for (let i = 0; i < 0xa0; i++) {
      this.oam[i] = this.read(src + i);
    }
  }

  // Start the HDMA
  private startHdma(value: number): void {
    if (!this.cgbMode) return;

    // Terminate active HBlank DMA by writing bit7=0
    if (this.hdmaActive && (value & 0x80) === 0) {
      const remain = Math.max(0, Math.floor(this.hdmaLength / 16) - 1) & 0x7f;
      this.hdmaActive = false;
      this.hdmaLength = 0;
      this.io[IO.HDMA5 - 0xff00] = 0x80 | remain;
      return;
    }

    this.hdmaSrc &= 0xfff0;
    this.hdmaDst &= 0x1ff0;
    const length = ((value & 0x7f) + 1) * 0x10;
    const hblankMode = (value & 0x80) !== 0;

    if (!hblankMode) {
      // General-purpose DMA — copy immediately into current VRAM bank
      this.copyVramDma(length);
      this.hdmaActive = false;
      this.hdmaLength = 0;
      this.io[IO.HDMA5 - 0xff00] = 0xff;
    } else {
      this.hdmaLength = length;
      this.hdmaActive = true;
      // remaining blocks - 1 (bit7 clear = active)
      this.io[IO.HDMA5 - 0xff00] = value & 0x7f;
    }
  }

  // Copy `length` bytes from HDMA source into VRAM (current VBK). Returns bytes copied.
  private copyVramDma(length: number): number {
    const bank = this.vramBank;
    const max = Math.min(length, 0x2000 - (this.hdmaDst & 0x1fff));
    for (let i = 0; i < max; i++) {
      const srcAddr = (this.hdmaSrc + i) & 0xffff;
      const data = this.read(srcAddr);
      this.vram[bank]![(this.hdmaDst + i) & 0x1fff] = data;
    }
    this.hdmaSrc = (this.hdmaSrc + max) & 0xffff;
    this.hdmaDst = (this.hdmaDst + max) & 0x1fff;
    return max;
  }
}
