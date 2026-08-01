import { DMG_BOOT } from "./dmg_boot";
import { CGB_BOOT } from "./cgb_boot";

export { DMG_BOOT, CGB_BOOT };

export function selectBootRom(cgb: boolean): Uint8Array {
  return cgb ? CGB_BOOT : DMG_BOOT;
}
