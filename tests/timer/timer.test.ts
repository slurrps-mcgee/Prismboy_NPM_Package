import { GameBoy } from "@/gameboy";
import { IO } from "@/constants/memory.constants";
import { INT } from "@/constants/interrupt.constants";

describe("Timer", () => {
  test("DIV increments every 256 cycles", () => {
    const gb = new GameBoy({ useBootRom: false });
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x00;
    gb.loadRom(rom);
    gb.timer.write(IO.DIV, 0); // reset div + counter
    gb.timer.tick(256);
    expect(gb.timer.div).toBe(1);
    gb.timer.tick(256 * 2);
    expect(gb.timer.div).toBe(3);
  });

  test("DIV write resets", () => {
    const gb = new GameBoy({ useBootRom: false });
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x00;
    gb.loadRom(rom);
    gb.timer.div = 0x80;
    gb.timer.write(IO.DIV, 0);
    expect(gb.timer.div).toBe(0);
  });

  test("TIMA overflow requests interrupt and loads TMA", () => {
    const gb = new GameBoy({ useBootRom: false });
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x00;
    gb.loadRom(rom);
    gb.timer.tima = 0xff;
    gb.timer.tma = 0xab;
    gb.timer.tac = 0x05; // enable, freq 16
    gb.timer.tick(16);
    expect(gb.timer.tima).toBe(0xab);
    expect(gb.bus.getIf() & INT.TIMER).toBe(INT.TIMER);
  });
});
