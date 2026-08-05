export type { Button } from "@/constants/joypad.constants";
export type { Cartridge, CartridgeInfo } from "@/cartridge/cartridge";

/** Shared serialize contract for savestate chunks. */
export interface ExportableState {
  exportState(): Uint8Array;
  importState(data: Uint8Array, offset?: number): number;
}
