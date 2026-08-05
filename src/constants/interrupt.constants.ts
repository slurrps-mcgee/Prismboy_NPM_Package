/** Interrupt bits */
export const INT = {
  VBLANK: 0x01,
  STAT: 0x02,
  TIMER: 0x04,
  SERIAL: 0x08,
  JOYPAD: 0x10,
} as const;

/** Interrupt vectors */
export const INT_VECTORS = {
  [INT.VBLANK]: 0x40,
  [INT.STAT]: 0x48,
  [INT.TIMER]: 0x50,
  [INT.SERIAL]: 0x58,
  [INT.JOYPAD]: 0x60,
} as const;
