/** Tile address helpers used by the PPU. */
export function tileAddress(tile: number, signed: boolean): number {
  if (signed) return 0x9000 + ((tile << 24) >> 24) * 16;
  return 0x8000 + tile * 16;
}
