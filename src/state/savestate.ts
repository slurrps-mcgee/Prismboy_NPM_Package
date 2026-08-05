import type { GameBoy } from "../gameboy";

const MAGIC = new TextEncoder().encode("GBCST");
const VERSION = 1;

// Concatenate the parts
function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += 4 + p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    new DataView(out.buffer).setUint32(o, p.length, true);
    o += 4;
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Read the chunk
function readChunk(data: Uint8Array, offset: number): { chunk: Uint8Array; next: number } {
  const len = new DataView(data.buffer, data.byteOffset + offset).getUint32(0, true);
  const chunk = data.slice(offset + 4, offset + 4 + len);
  return { chunk, next: offset + 4 + len };
}

// Create a versioned full-machine savestate blob.
export function createSavestate(gb: GameBoy): Uint8Array {
  const parts = [
    gb.cpu.exportState(),
    gb.bus.exportState(),
    gb.ppu.exportState(),
    gb.timer.exportState(),
    gb.joypad.exportState(),
    gb.apu.exportState(),
    gb.bus.cartridge?.exportState() ?? new Uint8Array(0),
  ];
  const body = concat(parts);
  const out = new Uint8Array(6 + body.length);
  out.set(MAGIC, 0);
  out[5] = VERSION;
  out.set(body, 6);
  return out;
}

// Load a savestate. ROM must already be loaded.
export function loadSavestate(gb: GameBoy, data: Uint8Array): void {
  for (let i = 0; i < 5; i++) {
    if (data[i] !== MAGIC[i]) throw new Error("Invalid savestate magic");
  }
  if (data[5] !== VERSION) throw new Error(`Unsupported savestate version ${data[5]}`);

  let o = 6;
  let r: { chunk: Uint8Array; next: number };

  r = readChunk(data, o); gb.cpu.importState(r.chunk); o = r.next;
  r = readChunk(data, o); gb.bus.importState(r.chunk); o = r.next;
  r = readChunk(data, o); gb.ppu.importState(r.chunk); o = r.next;
  r = readChunk(data, o); gb.timer.importState(r.chunk); o = r.next;
  r = readChunk(data, o); gb.joypad.importState(r.chunk); o = r.next;
  r = readChunk(data, o); gb.apu.importState(r.chunk); o = r.next;
  r = readChunk(data, o);
  if (gb.bus.cartridge && r.chunk.length) gb.bus.cartridge.importState(r.chunk);
}
