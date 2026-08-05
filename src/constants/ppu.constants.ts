// LCDC constants
export const LCDC = {
  BG_ENABLE: 0x01,
  OBJ_ENABLE: 0x02,
  OBJ_SIZE: 0x04,
  BG_TILEMAP: 0x08,
  TILE_DATA: 0x10,
  WINDOW_ENABLE: 0x20,
  WINDOW_TILEMAP: 0x40,
  LCD_ENABLE: 0x80,
} as const;

// STAT constants
export const STAT = {
  MODE: 0x03,
  LYC_EQ: 0x04,
  HBLANK_INT: 0x08,
  VBLANK_INT: 0x10,
  OAM_INT: 0x20,
  LYC_INT: 0x40,
} as const;

// PPU mode constants
export const PPU_MODE = {
  HBLANK: 0,
  VBLANK: 1,
  OAM: 2,
  TRANSFER: 3,
} as const;

// Classic DMG greyscale (RGBA)
export const DMG_COLORS: [number, number, number, number][] = [
  [224, 248, 208, 255],
  [136, 192, 112, 255],
  [52, 104, 86, 255],
  [8, 24, 32, 255],
];
