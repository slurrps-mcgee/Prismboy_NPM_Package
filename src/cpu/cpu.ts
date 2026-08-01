import type { Bus } from "@/bus/bus";
import { Registers } from "@/cpu/registers";
import { INT, INT_VECTORS } from "@/constants/memory.constants";
import { executeOpcode } from "@/cpu/opcodes/opcodes";

export class CPU {
  registers = new Registers();
  ime = false;
  imeScheduled = false;
  halted = false;
  stopped = false;
  haltBug = false;

  constructor(readonly bus: Bus) {}

  reset(cgb: boolean, useBootRom = false): void {
    this.registers.reset(cgb, useBootRom);
    this.ime = false;
    this.imeScheduled = false;
    this.halted = false;
    this.stopped = false;
    this.haltBug = false;
  }

  /** Execute one instruction (or interrupt). Returns T-cycles. */
  step(): number {
    if (this.imeScheduled) {
      this.ime = true;
      this.imeScheduled = false;
    }

    const interruptCycles = this.handleInterrupts();
    if (interruptCycles > 0) return interruptCycles;

    if (this.stopped) return 4;

    if (this.halted) {
      if ((this.bus.getIf() & this.bus.ie & 0x1f) !== 0) {
        this.halted = false;
      } else {
        return 4;
      }
    }

    const opcode = this.fetch8();
    if (this.haltBug) {
      this.registers.pc = (this.registers.pc - 1) & 0xffff;
      this.haltBug = false;
    }
    return executeOpcode(this, opcode);
  }

  private handleInterrupts(): number {
    const pending = this.bus.getIf() & this.bus.ie & 0x1f;
    if (!pending) return 0;

    this.halted = false;
    this.stopped = false;

    if (!this.ime) return 0;

    for (const bit of [INT.VBLANK, INT.STAT, INT.TIMER, INT.SERIAL, INT.JOYPAD]) {
      if (pending & bit) {
        this.ime = false;
        this.bus.setIf(this.bus.getIf() & ~bit);
        this.push16(this.registers.pc);
        this.registers.pc = INT_VECTORS[bit as keyof typeof INT_VECTORS];
        return 20;
      }
    }
    return 0;
  }

  fetch8(): number {
    const v = this.bus.read(this.registers.pc);
    this.registers.pc = (this.registers.pc + 1) & 0xffff;
    return v;
  }

  fetch16(): number {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return (hi << 8) | lo;
  }

  push16(v: number): void {
    this.registers.sp = (this.registers.sp - 1) & 0xffff;
    this.bus.write(this.registers.sp, (v >> 8) & 0xff);
    this.registers.sp = (this.registers.sp - 1) & 0xffff;
    this.bus.write(this.registers.sp, v & 0xff);
  }

  pop16(): number {
    const lo = this.bus.read(this.registers.sp);
    this.registers.sp = (this.registers.sp + 1) & 0xffff;
    const hi = this.bus.read(this.registers.sp);
    this.registers.sp = (this.registers.sp + 1) & 0xffff;
    return (hi << 8) | lo;
  }

  getR8(i: number): number {
    const r = this.registers;
    switch (i) {
      case 0: return r.b;
      case 1: return r.c;
      case 2: return r.d;
      case 3: return r.e;
      case 4: return r.h;
      case 5: return r.l;
      case 6: return this.bus.read(r.hl);
      case 7: return r.a;
      default: return 0;
    }
  }

  setR8(i: number, v: number): void {
    const r = this.registers;
    v &= 0xff;
    switch (i) {
      case 0: r.b = v; break;
      case 1: r.c = v; break;
      case 2: r.d = v; break;
      case 3: r.e = v; break;
      case 4: r.h = v; break;
      case 5: r.l = v; break;
      case 6: this.bus.write(r.hl, v); break;
      case 7: r.a = v; break;
    }
  }

  signed8(n: number): number {
    return n < 0x80 ? n : n - 0x100;
  }

  jr(cond: boolean): number {
    const offset = this.signed8(this.fetch8());
    if (!cond) return 8;
    this.registers.pc = (this.registers.pc + offset) & 0xffff;
    return 12;
  }

  jp(cond: boolean): number {
    const addr = this.fetch16();
    if (!cond) return 12;
    this.registers.pc = addr;
    return 16;
  }

  call(cond: boolean): number {
    const addr = this.fetch16();
    if (!cond) return 12;
    this.push16(this.registers.pc);
    this.registers.pc = addr;
    return 24;
  }

  ret(cond: boolean): number {
    if (!cond) return 8;
    this.registers.pc = this.pop16();
    return 20;
  }

  rst(addr: number): number {
    this.push16(this.registers.pc);
    this.registers.pc = addr;
    return 16;
  }

  inc8(v: number): number {
    const result = (v + 1) & 0xff;
    this.registers.setFlags(result === 0, false, (v & 0x0f) === 0x0f, null);
    return result;
  }

  dec8(v: number): number {
    const result = (v - 1) & 0xff;
    this.registers.setFlags(result === 0, true, (v & 0x0f) === 0, null);
    return result;
  }

  add(v: number): void {
    const a = this.registers.a;
    const result = a + v;
    this.registers.a = result & 0xff;
    this.registers.setFlags(
      (result & 0xff) === 0,
      false,
      ((a & 0xf) + (v & 0xf)) > 0xf,
      result > 0xff,
    );
  }

  adc(v: number): void {
    const a = this.registers.a;
    const c = this.registers.cy ? 1 : 0;
    const result = a + v + c;
    this.registers.a = result & 0xff;
    this.registers.setFlags(
      (result & 0xff) === 0,
      false,
      ((a & 0xf) + (v & 0xf) + c) > 0xf,
      result > 0xff,
    );
  }

  sub(v: number): void {
    const a = this.registers.a;
    const result = a - v;
    this.registers.a = result & 0xff;
    this.registers.setFlags(
      (result & 0xff) === 0,
      true,
      (a & 0xf) < (v & 0xf),
      result < 0,
    );
  }

  sbc(v: number): void {
    const a = this.registers.a;
    const c = this.registers.cy ? 1 : 0;
    const result = a - v - c;
    this.registers.a = result & 0xff;
    this.registers.setFlags(
      (result & 0xff) === 0,
      true,
      (a & 0xf) < (v & 0xf) + c,
      result < 0,
    );
  }

  and(v: number): void {
    this.registers.a &= v;
    this.registers.setFlags(this.registers.a === 0, false, true, false);
  }

  or(v: number): void {
    this.registers.a |= v;
    this.registers.setFlags(this.registers.a === 0, false, false, false);
  }

  xor(v: number): void {
    this.registers.a ^= v;
    this.registers.setFlags(this.registers.a === 0, false, false, false);
  }

  cp(v: number): void {
    const a = this.registers.a;
    const result = a - v;
    this.registers.setFlags(
      (result & 0xff) === 0,
      true,
      (a & 0xf) < (v & 0xf),
      result < 0,
    );
  }

  addHl(v: number): void {
    const hl = this.registers.hl;
    const result = hl + v;
    this.registers.hl = result & 0xffff;
    this.registers.setFlags(
      null,
      false,
      ((hl & 0xfff) + (v & 0xfff)) > 0xfff,
      result > 0xffff,
    );
  }

  addSp(n8: number): void {
    const n = this.signed8(n8);
    const sp = this.registers.sp;
    const result = (sp + n) & 0xffff;
    this.registers.setFlags(
      false,
      false,
      ((sp ^ n ^ result) & 0x10) !== 0,
      ((sp ^ n ^ result) & 0x100) !== 0,
    );
    this.registers.sp = result;
  }

  rlca(): void {
    const a = this.registers.a;
    const c = (a >> 7) & 1;
    this.registers.a = ((a << 1) | c) & 0xff;
    this.registers.setFlags(false, false, false, c === 1);
  }

  rrca(): void {
    const a = this.registers.a;
    const c = a & 1;
    this.registers.a = ((a >> 1) | (c << 7)) & 0xff;
    this.registers.setFlags(false, false, false, c === 1);
  }

  rla(): void {
    const a = this.registers.a;
    const oldC = this.registers.cy ? 1 : 0;
    const c = (a >> 7) & 1;
    this.registers.a = ((a << 1) | oldC) & 0xff;
    this.registers.setFlags(false, false, false, c === 1);
  }

  rra(): void {
    const a = this.registers.a;
    const oldC = this.registers.cy ? 1 : 0;
    const c = a & 1;
    this.registers.a = ((a >> 1) | (oldC << 7)) & 0xff;
    this.registers.setFlags(false, false, false, c === 1);
  }

  daa(): void {
    let a = this.registers.a;
    let adjust = 0;
    let c = this.registers.cy;
    if (!this.registers.n) {
      if (this.registers.cy || a > 0x99) {
        adjust |= 0x60;
        c = true;
      }
      if (this.registers.hFlag || (a & 0x0f) > 0x09) adjust |= 0x06;
      a = (a + adjust) & 0xff;
    } else {
      if (this.registers.cy) adjust |= 0x60;
      if (this.registers.hFlag) adjust |= 0x06;
      a = (a - adjust) & 0xff;
    }
    this.registers.a = a;
    this.registers.setFlags(a === 0, null, false, c);
  }

  rlc(v: number): number {
    const c = (v >> 7) & 1;
    const result = ((v << 1) | c) & 0xff;
    this.registers.setFlags(result === 0, false, false, c === 1);
    return result;
  }

  rrc(v: number): number {
    const c = v & 1;
    const result = ((v >> 1) | (c << 7)) & 0xff;
    this.registers.setFlags(result === 0, false, false, c === 1);
    return result;
  }

  rl(v: number): number {
    const oldC = this.registers.cy ? 1 : 0;
    const c = (v >> 7) & 1;
    const result = ((v << 1) | oldC) & 0xff;
    this.registers.setFlags(result === 0, false, false, c === 1);
    return result;
  }

  rr(v: number): number {
    const oldC = this.registers.cy ? 1 : 0;
    const c = v & 1;
    const result = ((v >> 1) | (oldC << 7)) & 0xff;
    this.registers.setFlags(result === 0, false, false, c === 1);
    return result;
  }

  sla(v: number): number {
    const c = (v >> 7) & 1;
    const result = (v << 1) & 0xff;
    this.registers.setFlags(result === 0, false, false, c === 1);
    return result;
  }

  sra(v: number): number {
    const c = v & 1;
    const result = ((v >> 1) | (v & 0x80)) & 0xff;
    this.registers.setFlags(result === 0, false, false, c === 1);
    return result;
  }

  srl(v: number): number {
    const c = v & 1;
    const result = (v >> 1) & 0xff;
    this.registers.setFlags(result === 0, false, false, c === 1);
    return result;
  }

  swap(v: number): number {
    const result = ((v & 0x0f) << 4) | ((v & 0xf0) >> 4);
    this.registers.setFlags(result === 0, false, false, false);
    return result;
  }

  bit(b: number, v: number): void {
    const z = (v & (1 << b)) === 0;
    this.registers.setFlags(z, false, true, null);
  }

  exportState(): Uint8Array {
    const regs = this.registers.exportState();
    const meta = new Uint8Array(4);
    meta[0] = this.ime ? 1 : 0;
    meta[1] = this.imeScheduled ? 1 : 0;
    meta[2] = this.halted ? 1 : 0;
    meta[3] = this.stopped ? 1 : 0;
    const out = new Uint8Array(regs.length + 4);
    out.set(regs);
    out.set(meta, regs.length);
    return out;
  }

  importState(data: Uint8Array, offset = 0): number {
    const n = this.registers.importState(data, offset);
    this.ime = data[offset + n]! !== 0;
    this.imeScheduled = data[offset + n + 1]! !== 0;
    this.halted = data[offset + n + 2]! !== 0;
    this.stopped = data[offset + n + 3]! !== 0;
    return n + 4;
  }
}
