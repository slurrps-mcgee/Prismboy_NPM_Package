import { GameBoy } from "@/gameboy";
import { IO } from "@/constants/memory.constants";
import { INT } from "@/constants/interrupt.constants";

function blankRom(): Uint8Array {
  const rom = new Uint8Array(0x8000);
  rom[0x147] = 0x00;
  return rom;
}

describe("Timer", () => {
  test("DIV increments every 256 cycles", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    gb.timer.write(IO.DIV, 0); // reset divSystem
    gb.timer.tick(256);
    expect(gb.timer.div).toBe(1);
    gb.timer.tick(256 * 2);
    expect(gb.timer.div).toBe(3);
  });

  test("DIV write resets system counter", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    gb.timer.div = 0x80;
    gb.timer.write(IO.DIV, 0);
    expect(gb.timer.div).toBe(0);
    expect(gb.timer.divSystem).toBe(0);
  });

  test("TIMA overflow requests interrupt and loads TMA (with reload delay)", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    gb.timer.write(IO.DIV, 0);
    gb.timer.tima = 0xff;
    gb.timer.tma = 0xab;
    gb.timer.tac = 0x05; // enable + freq 01 → bit 3, every 16 T-cycles
    // Falling edge of bit 3 after 16 cycles → overflow
    gb.timer.tick(16);
    expect(gb.timer.tima).toBe(0); // still in reload delay
    // ~1 M-cycle (4 T) later: reload + IF
    gb.timer.tick(4);
    expect(gb.timer.tima).toBe(0xab);
    expect(gb.bus.getIf() & INT.TIMER).toBe(INT.TIMER);
  });

  test("DIV write causes TIMA increment when selected bit falls", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    gb.timer.write(IO.DIV, 0);
    // Advance so bit 3 is high (cycles 8..15)
    gb.timer.tick(8);
    expect((gb.timer.divSystem >> 3) & 1).toBe(1);
    gb.timer.tima = 0x10;
    gb.timer.tac = 0x05; // enable, bit 3
    // Resetting DIV clears bit 3 → falling edge
    gb.timer.write(IO.DIV, 0);
    expect(gb.timer.tima).toBe(0x11);
  });

  test("TAC disable falling-edge increments TIMA", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(blankRom());
    gb.timer.write(IO.DIV, 0);
    gb.timer.tick(8); // bit 3 high
    gb.timer.tima = 0x20;
    gb.timer.tac = 0x05;
    // Disable timer while bit is high → falling edge of AND signal
    gb.timer.write(IO.TAC, 0x01);
    expect(gb.timer.tima).toBe(0x21);
  });
});
