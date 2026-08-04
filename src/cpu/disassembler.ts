/** Lightweight disassembler for debugging. */
const MNEMONICS: Record<number, string> = {
  0x00: "NOP",
  0x01: "LD BC,d16",
  0xc3: "JP a16",
  0xcd: "CALL a16",
  0xc9: "RET",
  0xcb: "PREFIX CB",
  0x76: "HALT",
  0xf3: "DI",
  0xfb: "EI",
};

/**
 * Disassemble the opcode of the gameboy
 * @param opcode - The opcode of the gameboy
 * @param cb - The cb of the gameboy
 * @returns The disassembled opcode of the gameboy
 */
export function disassemble(opcode: number, cb?: number): string {
  if (opcode === 0xcb && cb !== undefined) return `CB ${cb.toString(16).padStart(2, "0")}`;
  return MNEMONICS[opcode] ?? `DB $${opcode.toString(16).padStart(2, "0")}`;
}
