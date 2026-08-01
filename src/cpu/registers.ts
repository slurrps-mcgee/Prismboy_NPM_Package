import { FLAG_C, FLAG_H, FLAG_N, FLAG_Z, BOOT_REGS, BOOT_REGS_CGB } from "@/constants/cpu.constants";

export class Registers {
  a = 0;
  f = 0;
  b = 0;
  c = 0;
  d = 0;
  e = 0;
  h = 0;
  l = 0;
  sp = 0;
  pc = 0;

  get af(): number {
    return ((this.a & 0xff) << 8) | (this.f & 0xf0);
  }
  set af(v: number) {
    this.a = (v >> 8) & 0xff;
    this.f = v & 0xf0;
  }

  get bc(): number {
    return ((this.b & 0xff) << 8) | (this.c & 0xff);
  }
  set bc(v: number) {
    this.b = (v >> 8) & 0xff;
    this.c = v & 0xff;
  }

  get de(): number {
    return ((this.d & 0xff) << 8) | (this.e & 0xff);
  }
  set de(v: number) {
    this.d = (v >> 8) & 0xff;
    this.e = v & 0xff;
  }

  get hl(): number {
    return ((this.h & 0xff) << 8) | (this.l & 0xff);
  }
  set hl(v: number) {
    this.h = (v >> 8) & 0xff;
    this.l = v & 0xff;
  }

  get z(): boolean {
    return (this.f & FLAG_Z) !== 0;
  }
  set z(v: boolean) {
    this.f = v ? this.f | FLAG_Z : this.f & ~FLAG_Z;
  }

  get n(): boolean {
    return (this.f & FLAG_N) !== 0;
  }
  set n(v: boolean) {
    this.f = v ? this.f | FLAG_N : this.f & ~FLAG_N;
  }

  get hFlag(): boolean {
    return (this.f & FLAG_H) !== 0;
  }
  set hFlag(v: boolean) {
    this.f = v ? this.f | FLAG_H : this.f & ~FLAG_H;
  }

  get cy(): boolean {
    return (this.f & FLAG_C) !== 0;
  }
  set cy(v: boolean) {
    this.f = v ? this.f | FLAG_C : this.f & ~FLAG_C;
  }

  setFlags(z: boolean | null, n: boolean | null, h: boolean | null, c: boolean | null): void {
    if (z !== null) this.z = z;
    if (n !== null) this.n = n;
    if (h !== null) this.hFlag = h;
    if (c !== null) this.cy = c;
  }

  reset(cgb: boolean, useBootRom = false): void {
    if (useBootRom) {
      this.a = 0;
      this.f = 0;
      this.b = 0;
      this.c = 0;
      this.d = 0;
      this.e = 0;
      this.h = 0;
      this.l = 0;
      this.sp = 0xfffe;
      this.pc = 0x0000;
      return;
    }
    const b = cgb ? BOOT_REGS_CGB : BOOT_REGS;
    this.a = b.a;
    this.f = b.f;
    this.b = b.b;
    this.c = b.c;
    this.d = b.d;
    this.e = b.e;
    this.h = b.h;
    this.l = b.l;
    this.sp = b.sp;
    this.pc = b.pc;
  }

  exportState(): Uint8Array {
    const buf = new Uint8Array(12);
    const v = new DataView(buf.buffer);
    buf[0] = this.a;
    buf[1] = this.f;
    buf[2] = this.b;
    buf[3] = this.c;
    buf[4] = this.d;
    buf[5] = this.e;
    buf[6] = this.h;
    buf[7] = this.l;
    v.setUint16(8, this.sp, true);
    v.setUint16(10, this.pc, true);
    return buf;
  }

  importState(data: Uint8Array, offset = 0): number {
    const v = new DataView(data.buffer, data.byteOffset + offset);
    this.a = data[offset]!;
    this.f = data[offset + 1]!;
    this.b = data[offset + 2]!;
    this.c = data[offset + 3]!;
    this.d = data[offset + 4]!;
    this.e = data[offset + 5]!;
    this.h = data[offset + 6]!;
    this.l = data[offset + 7]!;
    this.sp = v.getUint16(8, true);
    this.pc = v.getUint16(10, true);
    return 12;
  }
}
