/** Screen / PPU */
export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 144;
export const DOTS_PER_LINE = 456;
export const LINES_PER_FRAME = 154;
export const VBLANK_START = 144;

/** Clock */
export const CPU_HZ = 4_194_304;
export const CYCLES_PER_FRAME = 70_224;

/** Boot ROM unmap */
export const BOOT_ROM_DISABLE = 0xff50;

/** Memory map */
export const ROM0_START = 0x0000;
export const ROMX_START = 0x4000;
export const VRAM_START = 0x8000;
export const ERAM_START = 0xa000;
export const WRAM_START = 0xc000;
export const WRAM_BANK_START = 0xd000;
export const ECHO_START = 0xe000;
export const OAM_START = 0xfe00;
export const IO_START = 0xff00;
export const HRAM_START = 0xff80;
export const IE_ADDR = 0xffff;

export const VRAM_SIZE = 0x2000;
export const WRAM_SIZE = 0x2000;
export const OAM_SIZE = 0xa0;
export const IO_SIZE = 0x80;
export const HRAM_SIZE = 0x7f;

/** IO registers */
export const IO = {
  P1: 0xff00,
  SB: 0xff01,
  SC: 0xff02,
  DIV: 0xff04,
  TIMA: 0xff05,
  TMA: 0xff06,
  TAC: 0xff07,
  IF: 0xff0f,
  NR10: 0xff10,
  NR11: 0xff11,
  NR12: 0xff12,
  NR13: 0xff13,
  NR14: 0xff14,
  NR21: 0xff16,
  NR22: 0xff17,
  NR23: 0xff18,
  NR24: 0xff19,
  NR30: 0xff1a,
  NR31: 0xff1b,
  NR32: 0xff1c,
  NR33: 0xff1d,
  NR34: 0xff1e,
  NR41: 0xff20,
  NR42: 0xff21,
  NR43: 0xff22,
  NR44: 0xff23,
  NR50: 0xff24,
  NR51: 0xff25,
  NR52: 0xff26,
  WAVE_RAM: 0xff30,
  LCDC: 0xff40,
  STAT: 0xff41,
  SCY: 0xff42,
  SCX: 0xff43,
  LY: 0xff44,
  LYC: 0xff45,
  DMA: 0xff46,
  BGP: 0xff47,
  OBP0: 0xff48,
  OBP1: 0xff49,
  WY: 0xff4a,
  WX: 0xff4b,
  KEY1: 0xff4d,
  VBK: 0xff4f,
  HDMA1: 0xff51,
  HDMA2: 0xff52,
  HDMA3: 0xff53,
  HDMA4: 0xff54,
  HDMA5: 0xff55,
  RP: 0xff56,
  BCPS: 0xff68,
  BCPD: 0xff69,
  OCPS: 0xff6a,
  OCPD: 0xff6b,
  SVBK: 0xff70,
} as const;