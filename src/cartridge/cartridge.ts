// RTC state
export interface RtcState {
  s: number;
  m: number;
  h: number;
  dl: number;
  dh: number;
  latched: boolean;
  latchS: number;
  latchM: number;
  latchH: number;
  latchDl: number;
  latchDh: number;
  lastUnixMs: number;
}

// Cartridge information
export interface CartridgeInfo {
  title: string;
  type: number;
  romSize: number;
  ramSize: number;
  cgbFlag: number;
  hasBattery: boolean;
  hasRtc: boolean;
}

// Cartridge interface
export interface Cartridge {
  readonly info: CartridgeInfo;
  readonly rom: Uint8Array;
  sram: Uint8Array;
  rtc: RtcState | null;

  read(addr: number): number;
  write(addr: number, value: number): void;
  reset(): void;
  exportState(): Uint8Array;
  importState(data: Uint8Array, offset?: number): number;
  onSramWrite?: (() => void) | undefined;
}

// Parse the header of the cartridge
export function parseHeader(rom: Uint8Array): CartridgeInfo {
  let title = "";
  for (let i = 0x134; i <= 0x143; i++) {
    const c = rom[i] ?? 0;
    if (c === 0) break;
    title += String.fromCharCode(c);
  }
  const type = rom[0x147] ?? 0;
  const romSizeCode = rom[0x148] ?? 0;
  const ramSizeCode = rom[0x149] ?? 0;
  const cgbFlag = rom[0x143] ?? 0;

  const romBanks = romSizeCode <= 8 ? 2 << romSizeCode : 2;
  const romSize = romBanks * 0x4000;

  const ramSizes = [0, 0x800, 0x2000, 0x8000, 0x20000, 0x10000];
  let ramSize = ramSizes[ramSizeCode] ?? 0;

  const hasBattery = [0x03, 0x06, 0x09, 0x0d, 0x0f, 0x10, 0x13, 0x1b, 0x1e, 0xff].includes(type);
  const hasRtc = [0x0f, 0x10].includes(type);

  // MBC2 has built-in 512×4-bit RAM regardless of header RAM size code
  if (type === 0x05 || type === 0x06) ramSize = 0x200;

  return { title: title.trim(), type, romSize, ramSize, cgbFlag, hasBattery, hasRtc };
}

// Create an RTC state
function createRtc(): RtcState {
  return {
    s: 0,
    m: 0,
    h: 0,
    dl: 0,
    dh: 0,
    latched: false,
    latchS: 0,
    latchM: 0,
    latchH: 0,
    latchDl: 0,
    latchDh: 0,
    lastUnixMs: Date.now(),
  };
}

// Tick the RTC
function tickRtc(rtc: RtcState): void {
  if (rtc.dh & 0x40) return; // halt
  const now = Date.now();
  let delta = Math.floor((now - rtc.lastUnixMs) / 1000);
  rtc.lastUnixMs = now;
  if (delta <= 0) return;

  rtc.s += delta;
  while (rtc.s >= 60) {
    rtc.s -= 60;
    rtc.m++;
  }
  while (rtc.m >= 60) {
    rtc.m -= 60;
    rtc.h++;
  }
  while (rtc.h >= 24) {
    rtc.h -= 24;
    const day = ((rtc.dh & 1) << 8) | rtc.dl;
    const next = (day + 1) & 0x1ff;
    rtc.dl = next & 0xff;
    rtc.dh = (rtc.dh & 0xfe) | ((next >> 8) & 1);
    if (next === 0) rtc.dh |= 0x80; // carry
  }
}

// MBC base class
abstract class MbcBase implements Cartridge {
  // Properties
  readonly info: CartridgeInfo;
  readonly rom: Uint8Array;
  sram: Uint8Array;
  rtc: RtcState | null;
  onSramWrite?: (() => void) | undefined;

  // Constructor
  constructor(rom: Uint8Array, info: CartridgeInfo) {
    this.rom = rom;
    this.info = info;
    this.sram = new Uint8Array(info.ramSize);
    this.rtc = info.hasRtc ? createRtc() : null;
  }

  // ── Public ──────────────────────────────────────────────────────────────

  // Read from the cartridge
  abstract read(addr: number): number;

  // Write to the cartridge
  abstract write(addr: number, value: number): void;

  // Reset the cartridge
  abstract reset(): void;

  // Export the state of the cartridge
  exportState(): Uint8Array {
    const rtcBytes = this.rtc ? 48 : 0;
    const buf = new Uint8Array(8 + this.sram.length + rtcBytes);
    const view = new DataView(buf.buffer);
    view.setUint32(0, this.sram.length, true);
    view.setUint32(4, rtcBytes, true);
    buf.set(this.sram, 8);
    if (this.rtc) {
      const o = 8 + this.sram.length;
      const r = this.rtc;
      const vals = [
        r.s, r.m, r.h, r.dl, r.dh,
        r.latched ? 1 : 0,
        r.latchS, r.latchM, r.latchH, r.latchDl, r.latchDh,
      ];
      for (let i = 0; i < vals.length; i++) buf[o + i] = vals[i]! & 0xff;
      view.setFloat64(o + 16, r.lastUnixMs, true);
    }
    return buf;
  }

  // Import the state of the cartridge
  importState(data: Uint8Array, offset = 0): number {
    const view = new DataView(data.buffer, data.byteOffset + offset);
    const sramLen = view.getUint32(0, true);
    const rtcBytes = view.getUint32(4, true);
    this.sram = data.slice(offset + 8, offset + 8 + sramLen);
    if (rtcBytes && this.rtc) {
      const o = offset + 8 + sramLen;
      const r = this.rtc;
      r.s = data[o]!;
      r.m = data[o + 1]!;
      r.h = data[o + 2]!;
      r.dl = data[o + 3]!;
      r.dh = data[o + 4]!;
      r.latched = data[o + 5]! !== 0;
      r.latchS = data[o + 6]!;
      r.latchM = data[o + 7]!;
      r.latchH = data[o + 8]!;
      r.latchDl = data[o + 9]!;
      r.latchDh = data[o + 10]!;
      r.lastUnixMs = new DataView(data.buffer, data.byteOffset + o + 16).getFloat64(0, true);
    }
    return 8 + sramLen + rtcBytes;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  // Notify the cartridge that the SRAM has been written to
  protected notifySram(): void {
    this.onSramWrite?.();
  }
}

// MBC0 class
class Mbc0 extends MbcBase {
  // ── Public ──────────────────────────────────────────────────────────────
  // Reset the cartridge
  reset(): void {}

  // Read from the cartridge
  read(addr: number): number {
    if (addr < 0x8000) return this.rom[addr] ?? 0xff;
    if (addr >= 0xa000 && addr < 0xc000 && this.sram.length)
      return this.sram[addr - 0xa000] ?? 0xff;
    return 0xff;
  }

  // Write to the cartridge
  write(addr: number, value: number): void {
    if (addr >= 0xa000 && addr < 0xc000 && this.sram.length) {
      this.sram[addr - 0xa000] = value & 0xff;
      this.notifySram();
    }
  }
}

// MBC1 class
class Mbc1 extends MbcBase {
  private romBank = 1;
  private ramBank = 0;
  private ramEnable = false;
  private mode = 0;

  // ── Public ──────────────────────────────────────────────────────────────

  // Reset the cartridge
  reset(): void {
    this.romBank = 1;
    this.ramBank = 0;
    this.ramEnable = false;
    this.mode = 0;
  }

  // Read from the cartridge
  read(addr: number): number {
    if (addr < 0x4000) {
      const bank = this.mode === 1 ? (this.ramBank & 3) << 5 : 0;
      const max = Math.max(1, this.rom.length / 0x4000);
      const b = bank % max;
      return this.rom[b * 0x4000 + addr] ?? 0xff;
    }
    if (addr < 0x8000) {
      const b = this.effectiveRomBank();
      return this.rom[b * 0x4000 + (addr - 0x4000)] ?? 0xff;
    }
    if (addr >= 0xa000 && addr < 0xc000 && this.ramEnable && this.sram.length) {
      const bank = this.mode === 1 ? this.ramBank & 3 : 0;
      const off = (bank * 0x2000 + (addr - 0xa000)) % this.sram.length;
      return this.sram[off] ?? 0xff;
    }
    return 0xff;
  }

  // Write to the cartridge
  write(addr: number, value: number): void {
    if (addr < 0x2000) {
      this.ramEnable = (value & 0x0f) === 0x0a;
    } else if (addr < 0x4000) {
      this.romBank = value & 0x1f;
      if ((this.romBank & 0x1f) === 0) this.romBank = 1;
    } else if (addr < 0x6000) {
      this.ramBank = value & 3;
    } else if (addr < 0x8000) {
      this.mode = value & 1;
    } else if (addr >= 0xa000 && addr < 0xc000 && this.ramEnable && this.sram.length) {
      const bank = this.mode === 1 ? this.ramBank & 3 : 0;
      const off = (bank * 0x2000 + (addr - 0xa000)) % this.sram.length;
      this.sram[off] = value & 0xff;
      this.notifySram();
    }
  }

  // Export the state of the cartridge
  override exportState(): Uint8Array {
    const base = super.exportState();
    const extra = new Uint8Array(4);
    extra[0] = this.romBank;
    extra[1] = this.ramBank;
    extra[2] = this.ramEnable ? 1 : 0;
    extra[3] = this.mode;
    const out = new Uint8Array(base.length + 4);
    out.set(base);
    out.set(extra, base.length);
    return out;
  }

  // Import the state of the cartridge
  override importState(data: Uint8Array, offset = 0): number {
    const n = super.importState(data, offset);
    this.romBank = data[offset + n] ?? 1;
    this.ramBank = data[offset + n + 1] ?? 0;
    this.ramEnable = (data[offset + n + 2] ?? 0) !== 0;
    this.mode = data[offset + n + 3] ?? 0;
    return n + 4;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  // Calculate the effective ROM bank
  private effectiveRomBank(): number {
    let bank = this.romBank & 0x1f;
    if (this.mode === 0) bank |= (this.ramBank & 3) << 5;
    if ((bank & 0x1f) === 0) bank |= 1;
    const max = Math.max(1, this.rom.length / 0x4000);
    return bank % max;
  }
}

// MBC3 class
class Mbc3 extends MbcBase {
  private romBank = 1;
  private ramBank = 0;
  private ramEnable = false;
  private latchReg = 0xff;

  // ── Public ──────────────────────────────────────────────────────────────

  // Reset the cartridge
  reset(): void {
    this.romBank = 1;
    this.ramBank = 0;
    this.ramEnable = false;
    this.latchReg = 0xff;
  }

  // Read from the cartridge
  read(addr: number): number {
    if (addr < 0x4000) return this.rom[addr] ?? 0xff;
    if (addr < 0x8000) {
      const max = Math.max(1, this.rom.length / 0x4000);
      const b = (this.romBank || 1) % max;
      return this.rom[b * 0x4000 + (addr - 0x4000)] ?? 0xff;
    }
    if (addr >= 0xa000 && addr < 0xc000 && this.ramEnable) {
      if (this.ramBank <= 3 && this.sram.length) {
        const off = (this.ramBank * 0x2000 + (addr - 0xa000)) % this.sram.length;
        return this.sram[off] ?? 0xff;
      }
      if (this.rtc && this.ramBank >= 0x08 && this.ramBank <= 0x0c) {
        tickRtc(this.rtc);
        const r = this.rtc.latched
          ? { s: this.rtc.latchS, m: this.rtc.latchM, h: this.rtc.latchH, dl: this.rtc.latchDl, dh: this.rtc.latchDh }
          : this.rtc;
        switch (this.ramBank) {
          case 0x08: return r.s;
          case 0x09: return r.m;
          case 0x0a: return r.h;
          case 0x0b: return r.dl;
          case 0x0c: return r.dh;
        }
      }
    }
    return 0xff;
  }

  // Write to the cartridge
  write(addr: number, value: number): void {
    if (addr < 0x2000) {
      this.ramEnable = (value & 0x0f) === 0x0a;
    } else if (addr < 0x4000) {
      this.romBank = value & 0x7f;
      if (this.romBank === 0) this.romBank = 1;
    } else if (addr < 0x6000) {
      this.ramBank = value;
    } else if (addr < 0x8000 && this.rtc) {
      if (this.latchReg === 0 && value === 1) {
        tickRtc(this.rtc);
        this.rtc.latchS = this.rtc.s;
        this.rtc.latchM = this.rtc.m;
        this.rtc.latchH = this.rtc.h;
        this.rtc.latchDl = this.rtc.dl;
        this.rtc.latchDh = this.rtc.dh;
        this.rtc.latched = true;
      }
      this.latchReg = value;
    } else if (addr >= 0xa000 && addr < 0xc000 && this.ramEnable) {
      if (this.ramBank <= 3 && this.sram.length) {
        const off = (this.ramBank * 0x2000 + (addr - 0xa000)) % this.sram.length;
        this.sram[off] = value & 0xff;
        this.notifySram();
      } else if (this.rtc && this.ramBank >= 0x08 && this.ramBank <= 0x0c) {
        tickRtc(this.rtc);
        switch (this.ramBank) {
          case 0x08: this.rtc.s = value % 60; break;
          case 0x09: this.rtc.m = value % 60; break;
          case 0x0a: this.rtc.h = value % 24; break;
          case 0x0b: this.rtc.dl = value; break;
          case 0x0c: this.rtc.dh = value; break;
        }
        this.notifySram();
      }
    }
  }

  // Export the state of the cartridge
  override exportState(): Uint8Array {
    const base = super.exportState();
    const extra = new Uint8Array(4);
    extra[0] = this.romBank;
    extra[1] = this.ramBank;
    extra[2] = this.ramEnable ? 1 : 0;
    extra[3] = this.latchReg;
    const out = new Uint8Array(base.length + 4);
    out.set(base);
    out.set(extra, base.length);
    return out;
  }

  // Import the state of the cartridge
  override importState(data: Uint8Array, offset = 0): number {
    const n = super.importState(data, offset);
    this.romBank = data[offset + n] ?? 1;
    this.ramBank = data[offset + n + 1] ?? 0;
    this.ramEnable = (data[offset + n + 2] ?? 0) !== 0;
    this.latchReg = data[offset + n + 3] ?? 0xff;
    return n + 4;
  }
}

// MBC5 class
class Mbc5 extends MbcBase {
  private romBank = 1;
  private ramBank = 0;
  private ramEnable = false;

  // ── Public ──────────────────────────────────────────────────────────────

  // Reset the cartridge
  reset(): void {
    this.romBank = 1;
    this.ramBank = 0;
    this.ramEnable = false;
  }

  // Read from the cartridge
  read(addr: number): number {
    if (addr < 0x4000) return this.rom[addr] ?? 0xff;
    if (addr < 0x8000) {
      const max = Math.max(1, this.rom.length / 0x4000);
      const b = this.romBank % max;
      return this.rom[b * 0x4000 + (addr - 0x4000)] ?? 0xff;
    }
    if (addr >= 0xa000 && addr < 0xc000 && this.ramEnable && this.sram.length) {
      const off = (this.ramBank * 0x2000 + (addr - 0xa000)) % this.sram.length;
      return this.sram[off] ?? 0xff;
    }
    return 0xff;
  }

  // Write to the cartridge
  write(addr: number, value: number): void {
    if (addr < 0x2000) {
      this.ramEnable = (value & 0x0f) === 0x0a;
    } else if (addr < 0x3000) {
      this.romBank = (this.romBank & 0x100) | value;
    } else if (addr < 0x4000) {
      this.romBank = (this.romBank & 0xff) | ((value & 1) << 8);
    } else if (addr < 0x6000) {
      this.ramBank = value & 0x0f;
    } else if (addr >= 0xa000 && addr < 0xc000 && this.ramEnable && this.sram.length) {
      const off = (this.ramBank * 0x2000 + (addr - 0xa000)) % this.sram.length;
      this.sram[off] = value & 0xff;
      this.notifySram();
    }
  }

  // Export the state of the cartridge
  override exportState(): Uint8Array {
    const base = super.exportState();
    const extra = new Uint8Array(4);
    const view = new DataView(extra.buffer);
    view.setUint16(0, this.romBank, true);
    extra[2] = this.ramBank;
    extra[3] = this.ramEnable ? 1 : 0;
    const out = new Uint8Array(base.length + 4);
    out.set(base);
    out.set(extra, base.length);
    return out;
  }

  // Import the state of the cartridge
  override importState(data: Uint8Array, offset = 0): number {
    const n = super.importState(data, offset);
    const view = new DataView(data.buffer, data.byteOffset + offset + n);
    this.romBank = view.getUint16(0, true);
    this.ramBank = data[offset + n + 2] ?? 0;
    this.ramEnable = (data[offset + n + 3] ?? 0) !== 0;
    return n + 4;
  }
}

// MBC2: 512×4-bit built-in RAM; ROM bank via A8=1 writes; RAM enable via A8=0.
class Mbc2 extends MbcBase {
  private romBank = 1;
  private ramEnable = false;

  reset(): void {
    this.romBank = 1;
    this.ramEnable = false;
  }

  read(addr: number): number {
    if (addr < 0x4000) return this.rom[addr] ?? 0xff;
    if (addr < 0x8000) {
      const max = Math.max(1, this.rom.length / 0x4000);
      const b = (this.romBank || 1) % max;
      return this.rom[b * 0x4000 + (addr - 0x4000)] ?? 0xff;
    }
    if (addr >= 0xa000 && addr < 0xa200 && this.ramEnable && this.sram.length) {
      // Only lower nibble is valid
      return (this.sram[addr - 0xa000]! & 0x0f) | 0xf0;
    }
    return 0xff;
  }

  write(addr: number, value: number): void {
    if (addr < 0x4000) {
      if (addr & 0x100) {
        // Bit 8 set → ROM bank (low 4 bits); 0 maps to 1
        this.romBank = value & 0x0f;
        if (this.romBank === 0) this.romBank = 1;
      } else {
        // Bit 8 clear → RAM enable
        this.ramEnable = (value & 0x0f) === 0x0a;
      }
      return;
    }
    if (addr >= 0xa000 && addr < 0xa200 && this.ramEnable && this.sram.length) {
      this.sram[addr - 0xa000] = value & 0x0f;
      this.notifySram();
    }
  }

  override exportState(): Uint8Array {
    const base = super.exportState();
    const extra = new Uint8Array(2);
    extra[0] = this.romBank;
    extra[1] = this.ramEnable ? 1 : 0;
    const out = new Uint8Array(base.length + 2);
    out.set(base);
    out.set(extra, base.length);
    return out;
  }

  override importState(data: Uint8Array, offset = 0): number {
    const n = super.importState(data, offset);
    this.romBank = data[offset + n] ?? 1;
    this.ramEnable = (data[offset + n + 1] ?? 0) !== 0;
    return n + 2;
  }
}

/**
 * MMM01 (types 0x0B–0x0D): uncommon mapper. Implemented as MBC1-like fallback.
 * Real MMM01 has a more complex multiplexed banking scheme used by few titles.
 */
class Mmm01 extends Mbc1 {}

/**
 * HuC1 (0xFF) / HuC3 (0xFE): treat like MBC1.
 * HuC1 IR port writes are ignored; HuC3 RTC/IR not emulated beyond MBC1 banking.
 */
class HuC1 extends Mbc1 {
  override write(addr: number, value: number): void {
    // HuC1 IR enable lives in the RAM-bank register range — ignore IR side effects
    if (addr >= 0x4000 && addr < 0x6000) {
      // Still accept bank bits like MBC1; IR mode bit is a no-op here
      super.write(addr, value & 0x03);
      return;
    }
    super.write(addr, value);
  }
}

class HuC3 extends Mbc1 {}

// Create a cartridge
export function createCartridge(rom: Uint8Array): Cartridge {
  const info = parseHeader(rom);
  const t = info.type;
  if (t === 0x00 || t === 0x08 || t === 0x09) return new Mbc0(rom, info);
  if (t >= 0x01 && t <= 0x03) return new Mbc1(rom, info);
  if (t === 0x05 || t === 0x06) return new Mbc2(rom, info);
  if (t >= 0x0b && t <= 0x0d) return new Mmm01(rom, info);
  if ((t >= 0x0f && t <= 0x13) || t === 0x10) return new Mbc3(rom, info);
  if (t >= 0x19 && t <= 0x1e) return new Mbc5(rom, info);
  if (t === 0xff) return new HuC1(rom, info);
  if (t === 0xfe) return new HuC3(rom, info);
  // Fallback: try MBC1 for unknown types
  if (rom.length > 0x8000) return new Mbc1(rom, info);
  return new Mbc0(rom, info);
}
