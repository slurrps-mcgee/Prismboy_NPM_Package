import type { CPU } from "@/cpu/cpu";
import { executeCb } from "@/cpu/opcodes/cbOpcodes";

/** Main SM83 opcode dispatch. Returns T-cycles. */
export function executeOpcode(cpu: CPU, op: number): number {
    const r = cpu.registers;
    const bus = cpu.bus;

    // Execute the opcode returning the number of cycles
    switch (op) {
      case 0x00: return 4; // NOP
      case 0x01: r.bc = cpu.fetch16(); return 12;
      case 0x02: bus.write(r.bc, r.a); return 8;
      case 0x03: r.bc = (r.bc + 1) & 0xffff; return 8;
      case 0x04: r.b = cpu.inc8(r.b); return 4;
      case 0x05: r.b = cpu.dec8(r.b); return 4;
      case 0x06: r.b = cpu.fetch8(); return 8;
      case 0x07: cpu.rlca(); return 4;
      case 0x08: {
        const a = cpu.fetch16();
        bus.write(a, r.sp & 0xff);
        bus.write((a + 1) & 0xffff, (r.sp >> 8) & 0xff);
        return 20;
      }
      case 0x09: cpu.addHl(r.bc); return 8;
      case 0x0a: r.a = bus.read(r.bc); return 8;
      case 0x0b: r.bc = (r.bc - 1) & 0xffff; return 8;
      case 0x0c: r.c = cpu.inc8(r.c); return 4;
      case 0x0d: r.c = cpu.dec8(r.c); return 4;
      case 0x0e: r.c = cpu.fetch8(); return 8;
      case 0x0f: cpu.rrca(); return 4;

      case 0x10: cpu.fetch8(); cpu.stopped = true; cpu.halted = false;
        if (cpu.bus.cgbMode && (cpu.bus.key1 & 1)) {
          cpu.bus.doubleSpeed = !cpu.bus.doubleSpeed;
          cpu.bus.key1 = 0;
          cpu.stopped = false;
        }
        return 4;
      case 0x11: r.de = cpu.fetch16(); return 12;
      case 0x12: bus.write(r.de, r.a); return 8;
      case 0x13: r.de = (r.de + 1) & 0xffff; return 8;
      case 0x14: r.d = cpu.inc8(r.d); return 4;
      case 0x15: r.d = cpu.dec8(r.d); return 4;
      case 0x16: r.d = cpu.fetch8(); return 8;
      case 0x17: cpu.rla(); return 4;
      case 0x18: return cpu.jr(true);
      case 0x19: cpu.addHl(r.de); return 8;
      case 0x1a: r.a = bus.read(r.de); return 8;
      case 0x1b: r.de = (r.de - 1) & 0xffff; return 8;
      case 0x1c: r.e = cpu.inc8(r.e); return 4;
      case 0x1d: r.e = cpu.dec8(r.e); return 4;
      case 0x1e: r.e = cpu.fetch8(); return 8;
      case 0x1f: cpu.rra(); return 4;

      case 0x20: return cpu.jr(!r.z);
      case 0x21: r.hl = cpu.fetch16(); return 12;
      case 0x22: bus.write(r.hl, r.a); r.hl = (r.hl + 1) & 0xffff; return 8;
      case 0x23: r.hl = (r.hl + 1) & 0xffff; return 8;
      case 0x24: r.h = cpu.inc8(r.h); return 4;
      case 0x25: r.h = cpu.dec8(r.h); return 4;
      case 0x26: r.h = cpu.fetch8(); return 8;
      case 0x27: cpu.daa(); return 4;
      case 0x28: return cpu.jr(r.z);
      case 0x29: cpu.addHl(r.hl); return 8;
      case 0x2a: r.a = bus.read(r.hl); r.hl = (r.hl + 1) & 0xffff; return 8;
      case 0x2b: r.hl = (r.hl - 1) & 0xffff; return 8;
      case 0x2c: r.l = cpu.inc8(r.l); return 4;
      case 0x2d: r.l = cpu.dec8(r.l); return 4;
      case 0x2e: r.l = cpu.fetch8(); return 8;
      case 0x2f: r.a ^= 0xff; r.setFlags(null, true, true, null); return 4;

      case 0x30: return cpu.jr(!r.cy);
      case 0x31: r.sp = cpu.fetch16(); return 12;
      case 0x32: bus.write(r.hl, r.a); r.hl = (r.hl - 1) & 0xffff; return 8;
      case 0x33: r.sp = (r.sp + 1) & 0xffff; return 8;
      case 0x34: {
        const v = cpu.inc8(bus.read(r.hl));
        bus.write(r.hl, v);
        return 12;
      }
      case 0x35: {
        const v = cpu.dec8(bus.read(r.hl));
        bus.write(r.hl, v);
        return 12;
      }
      case 0x36: bus.write(r.hl, cpu.fetch8()); return 12;
      case 0x37: r.setFlags(null, false, false, true); return 4;
      case 0x38: return cpu.jr(r.cy);
      case 0x39: cpu.addHl(r.sp); return 8;
      case 0x3a: r.a = bus.read(r.hl); r.hl = (r.hl - 1) & 0xffff; return 8;
      case 0x3b: r.sp = (r.sp - 1) & 0xffff; return 8;
      case 0x3c: r.a = cpu.inc8(r.a); return 4;
      case 0x3d: r.a = cpu.dec8(r.a); return 4;
      case 0x3e: r.a = cpu.fetch8(); return 8;
      case 0x3f: r.setFlags(null, false, false, !r.cy); return 4;

      case 0x40: r.b = r.b; return 4;
      case 0x41: r.b = r.c; return 4;
      case 0x42: r.b = r.d; return 4;
      case 0x43: r.b = r.e; return 4;
      case 0x44: r.b = r.h; return 4;
      case 0x45: r.b = r.l; return 4;
      case 0x46: r.b = bus.read(r.hl); return 8;
      case 0x47: r.b = r.a; return 4;
      case 0x48: r.c = r.b; return 4;
      case 0x49: r.c = r.c; return 4;
      case 0x4a: r.c = r.d; return 4;
      case 0x4b: r.c = r.e; return 4;
      case 0x4c: r.c = r.h; return 4;
      case 0x4d: r.c = r.l; return 4;
      case 0x4e: r.c = bus.read(r.hl); return 8;
      case 0x4f: r.c = r.a; return 4;

      case 0x50: r.d = r.b; return 4;
      case 0x51: r.d = r.c; return 4;
      case 0x52: r.d = r.d; return 4;
      case 0x53: r.d = r.e; return 4;
      case 0x54: r.d = r.h; return 4;
      case 0x55: r.d = r.l; return 4;
      case 0x56: r.d = bus.read(r.hl); return 8;
      case 0x57: r.d = r.a; return 4;
      case 0x58: r.e = r.b; return 4;
      case 0x59: r.e = r.c; return 4;
      case 0x5a: r.e = r.d; return 4;
      case 0x5b: r.e = r.e; return 4;
      case 0x5c: r.e = r.h; return 4;
      case 0x5d: r.e = r.l; return 4;
      case 0x5e: r.e = bus.read(r.hl); return 8;
      case 0x5f: r.e = r.a; return 4;

      case 0x60: r.h = r.b; return 4;
      case 0x61: r.h = r.c; return 4;
      case 0x62: r.h = r.d; return 4;
      case 0x63: r.h = r.e; return 4;
      case 0x64: r.h = r.h; return 4;
      case 0x65: r.h = r.l; return 4;
      case 0x66: r.h = bus.read(r.hl); return 8;
      case 0x67: r.h = r.a; return 4;
      case 0x68: r.l = r.b; return 4;
      case 0x69: r.l = r.c; return 4;
      case 0x6a: r.l = r.d; return 4;
      case 0x6b: r.l = r.e; return 4;
      case 0x6c: r.l = r.h; return 4;
      case 0x6d: r.l = r.l; return 4;
      case 0x6e: r.l = bus.read(r.hl); return 8;
      case 0x6f: r.l = r.a; return 4;

      case 0x70: bus.write(r.hl, r.b); return 8;
      case 0x71: bus.write(r.hl, r.c); return 8;
      case 0x72: bus.write(r.hl, r.d); return 8;
      case 0x73: bus.write(r.hl, r.e); return 8;
      case 0x74: bus.write(r.hl, r.h); return 8;
      case 0x75: bus.write(r.hl, r.l); return 8;
      case 0x76:
        if ((bus.getIf() & bus.ie & 0x1f) !== 0 && !cpu.ime) {
          cpu.haltBug = true;
        } else {
          cpu.halted = true;
        }
        return 4;
      case 0x77: bus.write(r.hl, r.a); return 8;
      case 0x78: r.a = r.b; return 4;
      case 0x79: r.a = r.c; return 4;
      case 0x7a: r.a = r.d; return 4;
      case 0x7b: r.a = r.e; return 4;
      case 0x7c: r.a = r.h; return 4;
      case 0x7d: r.a = r.l; return 4;
      case 0x7e: r.a = bus.read(r.hl); return 8;
      case 0x7f: r.a = r.a; return 4;

      case 0x80: cpu.add(r.b); return 4;
      case 0x81: cpu.add(r.c); return 4;
      case 0x82: cpu.add(r.d); return 4;
      case 0x83: cpu.add(r.e); return 4;
      case 0x84: cpu.add(r.h); return 4;
      case 0x85: cpu.add(r.l); return 4;
      case 0x86: cpu.add(bus.read(r.hl)); return 8;
      case 0x87: cpu.add(r.a); return 4;
      case 0x88: cpu.adc(r.b); return 4;
      case 0x89: cpu.adc(r.c); return 4;
      case 0x8a: cpu.adc(r.d); return 4;
      case 0x8b: cpu.adc(r.e); return 4;
      case 0x8c: cpu.adc(r.h); return 4;
      case 0x8d: cpu.adc(r.l); return 4;
      case 0x8e: cpu.adc(bus.read(r.hl)); return 8;
      case 0x8f: cpu.adc(r.a); return 4;

      case 0x90: cpu.sub(r.b); return 4;
      case 0x91: cpu.sub(r.c); return 4;
      case 0x92: cpu.sub(r.d); return 4;
      case 0x93: cpu.sub(r.e); return 4;
      case 0x94: cpu.sub(r.h); return 4;
      case 0x95: cpu.sub(r.l); return 4;
      case 0x96: cpu.sub(bus.read(r.hl)); return 8;
      case 0x97: cpu.sub(r.a); return 4;
      case 0x98: cpu.sbc(r.b); return 4;
      case 0x99: cpu.sbc(r.c); return 4;
      case 0x9a: cpu.sbc(r.d); return 4;
      case 0x9b: cpu.sbc(r.e); return 4;
      case 0x9c: cpu.sbc(r.h); return 4;
      case 0x9d: cpu.sbc(r.l); return 4;
      case 0x9e: cpu.sbc(bus.read(r.hl)); return 8;
      case 0x9f: cpu.sbc(r.a); return 4;

      case 0xa0: cpu.and(r.b); return 4;
      case 0xa1: cpu.and(r.c); return 4;
      case 0xa2: cpu.and(r.d); return 4;
      case 0xa3: cpu.and(r.e); return 4;
      case 0xa4: cpu.and(r.h); return 4;
      case 0xa5: cpu.and(r.l); return 4;
      case 0xa6: cpu.and(bus.read(r.hl)); return 8;
      case 0xa7: cpu.and(r.a); return 4;
      case 0xa8: cpu.xor(r.b); return 4;
      case 0xa9: cpu.xor(r.c); return 4;
      case 0xaa: cpu.xor(r.d); return 4;
      case 0xab: cpu.xor(r.e); return 4;
      case 0xac: cpu.xor(r.h); return 4;
      case 0xad: cpu.xor(r.l); return 4;
      case 0xae: cpu.xor(bus.read(r.hl)); return 8;
      case 0xaf: cpu.xor(r.a); return 4;

      case 0xb0: cpu.or(r.b); return 4;
      case 0xb1: cpu.or(r.c); return 4;
      case 0xb2: cpu.or(r.d); return 4;
      case 0xb3: cpu.or(r.e); return 4;
      case 0xb4: cpu.or(r.h); return 4;
      case 0xb5: cpu.or(r.l); return 4;
      case 0xb6: cpu.or(bus.read(r.hl)); return 8;
      case 0xb7: cpu.or(r.a); return 4;
      case 0xb8: cpu.cp(r.b); return 4;
      case 0xb9: cpu.cp(r.c); return 4;
      case 0xba: cpu.cp(r.d); return 4;
      case 0xbb: cpu.cp(r.e); return 4;
      case 0xbc: cpu.cp(r.h); return 4;
      case 0xbd: cpu.cp(r.l); return 4;
      case 0xbe: cpu.cp(bus.read(r.hl)); return 8;
      case 0xbf: cpu.cp(r.a); return 4;

      case 0xc0: return cpu.ret(!r.z);
      case 0xc1: r.bc = cpu.pop16(); return 12;
      case 0xc2: return cpu.jp(!r.z);
      case 0xc3: r.pc = cpu.fetch16(); return 16;
      case 0xc4: return cpu.call(!r.z);
      case 0xc5: cpu.push16(r.bc); return 16;
      case 0xc6: cpu.add(cpu.fetch8()); return 8;
      case 0xc7: return cpu.rst(0x00);
      case 0xc8: return cpu.ret(r.z);
      case 0xc9: r.pc = cpu.pop16(); return 16;
      case 0xca: return cpu.jp(r.z);
      case 0xcb: return executeCb(cpu, cpu.fetch8());
      case 0xcc: return cpu.call(r.z);
      case 0xcd: return cpu.call(true);
      case 0xce: cpu.adc(cpu.fetch8()); return 8;
      case 0xcf: return cpu.rst(0x08);

      case 0xd0: return cpu.ret(!r.cy);
      case 0xd1: r.de = cpu.pop16(); return 12;
      case 0xd2: return cpu.jp(!r.cy);
      case 0xd4: return cpu.call(!r.cy);
      case 0xd5: cpu.push16(r.de); return 16;
      case 0xd6: cpu.sub(cpu.fetch8()); return 8;
      case 0xd7: return cpu.rst(0x10);
      case 0xd8: return cpu.ret(r.cy);
      case 0xd9: r.pc = cpu.pop16(); cpu.ime = true; return 16;
      case 0xda: return cpu.jp(r.cy);
      case 0xdc: return cpu.call(r.cy);
      case 0xde: cpu.sbc(cpu.fetch8()); return 8;
      case 0xdf: return cpu.rst(0x18);

      case 0xe0: bus.write(0xff00 + cpu.fetch8(), r.a); return 12;
      case 0xe1: r.hl = cpu.pop16(); return 12;
      case 0xe2: bus.write(0xff00 + r.c, r.a); return 8;
      case 0xe5: cpu.push16(r.hl); return 16;
      case 0xe6: cpu.and(cpu.fetch8()); return 8;
      case 0xe7: return cpu.rst(0x20);
      case 0xe8: cpu.addSp(cpu.fetch8()); return 16;
      case 0xe9: r.pc = r.hl; return 4;
      case 0xea: bus.write(cpu.fetch16(), r.a); return 16;
      case 0xee: cpu.xor(cpu.fetch8()); return 8;
      case 0xef: return cpu.rst(0x28);

      case 0xf0: r.a = bus.read(0xff00 + cpu.fetch8()); return 12;
      case 0xf1: r.af = cpu.pop16() & 0xfff0; return 12;
      case 0xf2: r.a = bus.read(0xff00 + r.c); return 8;
      case 0xf3: cpu.ime = false; cpu.imeScheduled = false; return 4;
      case 0xf5: cpu.push16(r.af); return 16;
      case 0xf6: cpu.or(cpu.fetch8()); return 8;
      case 0xf7: return cpu.rst(0x30);
      case 0xf8: {
        const n = cpu.signed8(cpu.fetch8());
        const sp = r.sp;
        const result = (sp + n) & 0xffff;
        r.setFlags(false, false, ((sp ^ n ^ result) & 0x10) !== 0, ((sp ^ n ^ result) & 0x100) !== 0);
        r.hl = result;
        return 12;
      }
      case 0xf9: r.sp = r.hl; return 8;
      case 0xfa: r.a = bus.read(cpu.fetch16()); return 16;
      case 0xfb: cpu.imeScheduled = true; return 4;
      case 0xfe: cpu.cp(cpu.fetch8()); return 8;
      case 0xff: return cpu.rst(0x38);

      // Invalid opcodes
      case 0xd3: case 0xdb: case 0xdd: case 0xe3: case 0xe4:
      case 0xeb: case 0xec: case 0xed: case 0xf4: case 0xfc: case 0xfd:
        return 4;

      default:
        return 4;
    }
  }

