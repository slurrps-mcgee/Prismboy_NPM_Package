import { GameBoy } from "@/gameboy";

describe("Savestate", () => {
  test("create → mutate → load restores CPU registers", () => {
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x00;
    rom[0x100] = 0x00;
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(rom);

    gb.cpu.registers.a = 0x12;
    gb.cpu.registers.bc = 0x3456;
    gb.cpu.registers.pc = 0x0200;
    gb.bus.write(0xc000, 0xab);

    const state = gb.createState();

    gb.cpu.registers.a = 0;
    gb.cpu.registers.bc = 0;
    gb.cpu.registers.pc = 0x0100;
    gb.bus.write(0xc000, 0x00);

    gb.loadState(state);

    expect(gb.cpu.registers.a).toBe(0x12);
    expect(gb.cpu.registers.bc).toBe(0x3456);
    expect(gb.cpu.registers.pc).toBe(0x0200);
    expect(gb.bus.read(0xc000)).toBe(0xab);
  });

  test("rejects invalid magic", () => {
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x00;
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(rom);
    expect(() => gb.loadState(new Uint8Array([1, 2, 3, 4, 5, 1]))).toThrow(/magic/);
  });
});
