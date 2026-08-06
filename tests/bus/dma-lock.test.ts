import { GameBoy } from "@/gameboy";
import { IO } from "@/constants/memory.constants";
import { PPU_MODE } from "@/constants/ppu.constants";

function blankRom(): Uint8Array {
  const rom = new Uint8Array(0x8000);
  rom[0x147] = 0x00;
  return rom;
}

describe("OAM DMA", () => {
  test("copies 160 bytes at 1 byte per 4 T-cycles", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    // Source in WRAM
    for (let i = 0; i < 160; i++) gb.bus.wram[0]![i] = (i + 1) & 0xff;
    gb.bus.write(IO.DMA, 0xc0); // DMA from 0xC000
    expect(gb.bus.dmaActive).toBe(true);
    expect(gb.bus.dmaBytesLeft).toBe(160);

    // 40 bytes after 160 T-cycles
    gb.bus.tickDma(160);
    expect(gb.bus.dmaBytesLeft).toBe(120);
    expect(gb.bus.oam[0]).toBe(1);
    expect(gb.bus.oam[39]).toBe(40);

    // Finish remaining 120 bytes = 480 T-cycles
    gb.bus.tickDma(480);
    expect(gb.bus.dmaActive).toBe(false);
    expect(gb.bus.oam[159]).toBe(160);
  });

  test("CPU OAM writes ignored and reads return last DMA byte while active", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    gb.bus.wram[0]![0] = 0x55;
    gb.bus.write(IO.DMA, 0xc0);
    gb.bus.tickDma(4); // copy first byte
    expect(gb.bus.read(0xfe00)).toBe(0x55); // last transferred
    gb.bus.write(0xfe00, 0x99);
    expect(gb.bus.oam[0]).toBe(0x55); // write ignored
  });

  test("HRAM still writable during DMA", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    gb.bus.write(IO.DMA, 0xc0);
    gb.bus.write(0xff80, 0x42);
    expect(gb.bus.read(0xff80)).toBe(0x42);
  });

  test("advancePeripherals ticks DMA", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    for (let i = 0; i < 160; i++) gb.bus.wram[0]![i] = 0xaa;
    gb.bus.write(IO.DMA, 0xc0);
    // Each NOP is 4 cycles; 160 bytes need 640 T-cycles = 160 NOPs
    // step() runs CPU + peripherals
    let guard = 0;
    while (gb.bus.dmaActive && guard++ < 1000) gb.step();
    expect(gb.bus.dmaActive).toBe(false);
    expect(gb.bus.oam[0]).toBe(0xaa);
  });
});

describe("VRAM/OAM locking", () => {
  test("DMG VRAM reads 0xff in mode 3", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    gb.bus.vram[0]![0] = 0x12;
    // Force LCD on + mode 3
    gb.bus.io[IO.LCDC - 0xff00] = 0x80;
    gb.ppu.mode = PPU_MODE.TRANSFER;
    expect(gb.bus.read(0x8000)).toBe(0xff);
    gb.bus.write(0x8000, 0x34);
    expect(gb.bus.vram[0]![0]).toBe(0x12); // write ignored
  });

  test("CGB allows VRAM access in mode 3", () => {
    const gb = new GameBoy({ useBootRom: false });
    const rom = blankRom();
    rom[0x143] = 0x80; // CGB flag
    gb.loadRom(rom);
    expect(gb.bus.cgbMode).toBe(true);
    gb.bus.vram[0]![0] = 0x12;
    gb.bus.io[IO.LCDC - 0xff00] = 0x80;
    gb.ppu.mode = PPU_MODE.TRANSFER;
    expect(gb.bus.read(0x8000)).toBe(0x12);
    gb.bus.write(0x8000, 0x34);
    expect(gb.bus.vram[0]![0]).toBe(0x34);
  });
});
