import type { CPU } from "@/cpu/cpu";

/** CB-prefix opcode handlers. */
export function executeCb(cpu: CPU, op: number): number {
    const r = cpu.registers;
    const bus = cpu.bus;
    const reg = op & 7;
    const isHl = reg === 6;
    let value = isHl ? bus.read(r.hl) : cpu.getR8(reg);
    const cycles = isHl ? 16 : 8;

    if (op < 0x40) {
      const group = op >> 3;
      switch (group) {
        case 0: value = cpu.rlc(value); break;
        case 1: value = cpu.rrc(value); break;
        case 2: value = cpu.rl(value); break;
        case 3: value = cpu.rr(value); break;
        case 4: value = cpu.sla(value); break;
        case 5: value = cpu.sra(value); break;
        case 6: value = cpu.swap(value); break;
        case 7: value = cpu.srl(value); break;
      }
      if (isHl) bus.write(r.hl, value);
      else cpu.setR8(reg, value);
      return isHl ? 16 : 8;
    }

    if (op < 0x80) {
      const bit = (op >> 3) & 7;
      cpu.bit(bit, value);
      return isHl ? 12 : 8;
    }

    if (op < 0xc0) {
      const bit = (op >> 3) & 7;
      value &= ~(1 << bit);
      if (isHl) bus.write(r.hl, value);
      else cpu.setR8(reg, value);
      return cycles;
    }

    const bit = (op >> 3) & 7;
    value |= 1 << bit;
    if (isHl) bus.write(r.hl, value);
    else cpu.setR8(reg, value);
    return cycles;
  }

