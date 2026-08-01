import { GameBoy } from "@/gameboy";
import { IO } from "@/constants/memory.constants";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "@/constants/memory.constants";

describe("PPU", () => {
  test("exposes 160x144 framebuffer", () => {
    const gb = new GameBoy({ useBootRom: false });
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x00;
    gb.loadRom(rom);
    expect(gb.ppu.width).toBe(SCREEN_WIDTH);
    expect(gb.ppu.height).toBe(SCREEN_HEIGHT);
    expect(gb.ppu.frameBuffer.data.length).toBe(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  });

  test("advances LY over a full line", () => {
    const gb = new GameBoy({ useBootRom: false });
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x00;
    gb.loadRom(rom);
    gb.bus.io[IO.LCDC - 0xff00] = 0x80;
    gb.ppu.writeLcdc(0x80);
    const start = gb.ppu.ly;
    gb.ppu.tick(456);
    expect(gb.ppu.ly).toBe((start + 1) % 154);
  });
});
