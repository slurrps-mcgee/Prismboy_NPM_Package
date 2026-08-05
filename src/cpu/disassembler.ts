/**
 * SM83 disassembler for debug hosts. Not used on the emulation hot path.
 * Tables cover the main opcode space and CB-prefix bit ops.
 */

const R8 = ["B", "C", "D", "E", "H", "L", "(HL)", "A"] as const;
const R16 = ["BC", "DE", "HL", "SP"] as const;
const R16_STACK = ["BC", "DE", "HL", "AF"] as const;
const CC = ["NZ", "Z", "NC", "C"] as const;
const ALU = ["ADD A,", "ADC A,", "SUB ", "SBC A,", "AND ", "XOR ", "OR ", "CP "] as const;
const CB_ROT = ["RLC", "RRC", "RL", "RR", "SLA", "SRA", "SWAP", "SRL"] as const;

function hex8(n: number): string {
  return `$${n.toString(16).padStart(2, "0")}`;
}

function hex16(n: number): string {
  return `$${n.toString(16).padStart(4, "0")}`;
}

/** Decode one instruction at `addr` using a memory read callback. */
export function disassembleAt(
  read: (addr: number) => number,
  addr: number,
): { size: number; mnemonic: string; bytes: number[] } {
  const a = addr & 0xffff;
  const op = read(a) & 0xff;
  const bytes = [op];

  const take8 = (): number => {
    const v = read((a + bytes.length) & 0xffff) & 0xff;
    bytes.push(v);
    return v;
  };
  const take16 = (): number => {
    const lo = take8();
    const hi = take8();
    return lo | (hi << 8);
  };

  // CB prefix
  if (op === 0xcb) {
    const cb = take8();
    const reg = R8[cb & 7]!;
    if (cb < 0x40) {
      return { size: bytes.length, mnemonic: `${CB_ROT[cb >> 3]!} ${reg}`, bytes };
    }
    if (cb < 0x80) {
      return { size: bytes.length, mnemonic: `BIT ${ (cb >> 3) & 7 },${reg}`, bytes };
    }
    if (cb < 0xc0) {
      return { size: bytes.length, mnemonic: `RES ${ (cb >> 3) & 7 },${reg}`, bytes };
    }
    return { size: bytes.length, mnemonic: `SET ${ (cb >> 3) & 7 },${reg}`, bytes };
  }

  // Sparse exact matches + patterned groups
  switch (op) {
    case 0x00: return { size: 1, mnemonic: "NOP", bytes };
    case 0x07: return { size: 1, mnemonic: "RLCA", bytes };
    case 0x08: return { size: 3, mnemonic: `LD (${hex16(take16())}),SP`, bytes };
    case 0x0f: return { size: 1, mnemonic: "RRCA", bytes };
    case 0x10: take8(); return { size: 2, mnemonic: "STOP", bytes };
    case 0x17: return { size: 1, mnemonic: "RLA", bytes };
    case 0x18: {
      const off = take8();
      const rel = (off << 24) >> 24;
      return { size: 2, mnemonic: `JR ${hex16((a + 2 + rel) & 0xffff)}`, bytes };
    }
    case 0x1f: return { size: 1, mnemonic: "RRA", bytes };
    case 0x22: return { size: 1, mnemonic: "LD (HL+),A", bytes };
    case 0x27: return { size: 1, mnemonic: "DAA", bytes };
    case 0x2a: return { size: 1, mnemonic: "LD A,(HL+)", bytes };
    case 0x2f: return { size: 1, mnemonic: "CPL", bytes };
    case 0x32: return { size: 1, mnemonic: "LD (HL-),A", bytes };
    case 0x37: return { size: 1, mnemonic: "SCF", bytes };
    case 0x3a: return { size: 1, mnemonic: "LD A,(HL-)", bytes };
    case 0x3f: return { size: 1, mnemonic: "CCF", bytes };
    case 0x76: return { size: 1, mnemonic: "HALT", bytes };
    case 0xc3: return { size: 3, mnemonic: `JP ${hex16(take16())}`, bytes };
    case 0xc9: return { size: 1, mnemonic: "RET", bytes };
    case 0xcd: return { size: 3, mnemonic: `CALL ${hex16(take16())}`, bytes };
    case 0xd9: return { size: 1, mnemonic: "RETI", bytes };
    case 0xe0: return { size: 2, mnemonic: `LDH (${hex8(take8())}),A`, bytes };
    case 0xe2: return { size: 1, mnemonic: "LD (C),A", bytes };
    case 0xe8: return { size: 2, mnemonic: `ADD SP,${hex8(take8())}`, bytes };
    case 0xe9: return { size: 1, mnemonic: "JP HL", bytes };
    case 0xea: return { size: 3, mnemonic: `LD (${hex16(take16())}),A`, bytes };
    case 0xf0: return { size: 2, mnemonic: `LDH A,(${hex8(take8())})`, bytes };
    case 0xf2: return { size: 1, mnemonic: "LD A,(C)", bytes };
    case 0xf3: return { size: 1, mnemonic: "DI", bytes };
    case 0xf8: return { size: 2, mnemonic: `LD HL,SP+${hex8(take8())}`, bytes };
    case 0xf9: return { size: 1, mnemonic: "LD SP,HL", bytes };
    case 0xfa: return { size: 3, mnemonic: `LD A,(${hex16(take16())})`, bytes };
    case 0xfb: return { size: 1, mnemonic: "EI", bytes };
    default:
      break;
  }

  // LD r16,d16 / INC r16 / DEC r16 / ADD HL,r16 / LD (r16),A / LD A,(r16)
  if ((op & 0xcf) === 0x01) {
    return { size: 3, mnemonic: `LD ${R16[(op >> 4) & 3]!},${hex16(take16())}`, bytes };
  }
  if ((op & 0xcf) === 0x03) {
    return { size: 1, mnemonic: `INC ${R16[(op >> 4) & 3]!}`, bytes };
  }
  if ((op & 0xcf) === 0x0b) {
    return { size: 1, mnemonic: `DEC ${R16[(op >> 4) & 3]!}`, bytes };
  }
  if ((op & 0xcf) === 0x09) {
    return { size: 1, mnemonic: `ADD HL,${R16[(op >> 4) & 3]!}`, bytes };
  }
  if ((op & 0xcf) === 0x02) {
    return { size: 1, mnemonic: `LD (${R16[(op >> 4) & 3]!}),A`, bytes };
  }
  if ((op & 0xcf) === 0x0a) {
    return { size: 1, mnemonic: `LD A,(${R16[(op >> 4) & 3]!})`, bytes };
  }

  // INC/DEC r8
  if ((op & 0xc7) === 0x04) {
    return { size: 1, mnemonic: `INC ${R8[(op >> 3) & 7]!}`, bytes };
  }
  if ((op & 0xc7) === 0x05) {
    return { size: 1, mnemonic: `DEC ${R8[(op >> 3) & 7]!}`, bytes };
  }
  if ((op & 0xc7) === 0x06) {
    return { size: 2, mnemonic: `LD ${R8[(op >> 3) & 7]!},${hex8(take8())}`, bytes };
  }

  // JR cc,e
  if ((op & 0xe7) === 0x20) {
    const off = take8();
    const rel = (off << 24) >> 24;
    return { size: 2, mnemonic: `JR ${CC[(op >> 3) & 3]!},${hex16((a + 2 + rel) & 0xffff)}`, bytes };
  }

  // LD r,r
  if (op >= 0x40 && op <= 0x7f && op !== 0x76) {
    return { size: 1, mnemonic: `LD ${R8[(op >> 3) & 7]!},${R8[op & 7]!}`, bytes };
  }

  // ALU r
  if (op >= 0x80 && op <= 0xbf) {
    return { size: 1, mnemonic: `${ALU[(op >> 3) & 7]!}${R8[op & 7]!}`, bytes };
  }

  // RET cc / JP cc / CALL cc / PUSH / POP / RST
  if ((op & 0xc7) === 0xc0) {
    return { size: 1, mnemonic: `RET ${CC[(op >> 3) & 3]!}`, bytes };
  }
  if ((op & 0xc7) === 0xc2) {
    return { size: 3, mnemonic: `JP ${CC[(op >> 3) & 3]!},${hex16(take16())}`, bytes };
  }
  if ((op & 0xc7) === 0xc4) {
    return { size: 3, mnemonic: `CALL ${CC[(op >> 3) & 3]!},${hex16(take16())}`, bytes };
  }
  if ((op & 0xcf) === 0xc1) {
    return { size: 1, mnemonic: `POP ${R16_STACK[(op >> 4) & 3]!}`, bytes };
  }
  if ((op & 0xcf) === 0xc5) {
    return { size: 1, mnemonic: `PUSH ${R16_STACK[(op >> 4) & 3]!}`, bytes };
  }
  if ((op & 0xc7) === 0xc6) {
    return { size: 2, mnemonic: `${ALU[(op >> 3) & 7]!}${hex8(take8())}`, bytes };
  }
  if ((op & 0xc7) === 0xc7) {
    return { size: 1, mnemonic: `RST ${hex8(op & 0x38)}`, bytes };
  }

  return { size: 1, mnemonic: `DB ${hex8(op)}`, bytes };
}

/** Disassemble `count` instructions starting at `address`. */
export function disassembleRange(
  read: (addr: number) => number,
  address: number,
  count: number,
): { address: number; bytes: number[]; mnemonic: string }[] {
  const out: { address: number; bytes: number[]; mnemonic: string }[] = [];
  let pc = address & 0xffff;
  for (let i = 0; i < count; i++) {
    const line = disassembleAt(read, pc);
    out.push({ address: pc, bytes: line.bytes, mnemonic: line.mnemonic });
    pc = (pc + line.size) & 0xffff;
  }
  return out;
}
