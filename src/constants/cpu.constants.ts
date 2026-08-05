// CPU constants
export const FLAG_Z = 0x80; // Zero flag
export const FLAG_N = 0x40; // Negative flag
export const FLAG_H = 0x20; // Half carry flag
export const FLAG_C = 0x10; // Carry flag

/** Post-boot DMG register values (skip boot ROM) */
export const BOOT_REGS = {
  a: 0x01,
  f: 0xb0,
  b: 0x00,
  c: 0x13,
  d: 0x00,
  e: 0xd8,
  h: 0x01,
  l: 0x4d,
  sp: 0xfffe,
  pc: 0x0100,
} as const;

/** Post-boot CGB register values */
export const BOOT_REGS_CGB = {
  a: 0x11,
  f: 0x80,
  b: 0x00,
  c: 0x00,
  d: 0xff,
  e: 0x56,
  h: 0x00,
  l: 0x0d,
  sp: 0xfffe,
  pc: 0x0100,
} as const;
