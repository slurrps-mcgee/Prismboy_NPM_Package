import { GameBoy } from "@/gameboy";
import { FLAG_Z, FLAG_C, FLAG_H, FLAG_N } from "@/constants/cpu.constants";

function makeGb(program: number[], at = 0x0100): GameBoy {
  const rom = new Uint8Array(0x8000);
  // Minimal header
  rom[0x100] = 0x00; // will overwrite with program
  rom[0x134] = 0x54; // T
  rom[0x147] = 0x00; // ROM only
  rom[0x148] = 0x00;
  rom[0x149] = 0x00;
  rom.set(program, at);
  const gb = new GameBoy({ useBootRom: false });
  gb.loadRom(rom);
  gb.cpu.registers.pc = at;
  return gb;
}

describe("CPU opcodes", () => {
  test("NOP advances PC by 1 and takes 4 cycles", () => {
    const gb = makeGb([0x00]);
    const c = gb.step();
    expect(c).toBe(4);
    expect(gb.cpu.registers.pc).toBe(0x0101);
  });

  test("LD A,d8", () => {
    const gb = makeGb([0x3e, 0x42]);
    gb.step();
    expect(gb.cpu.registers.a).toBe(0x42);
  });

  test("ADD A,r sets flags", () => {
    const gb = makeGb([0x3e, 0x0f, 0x06, 0x01, 0x80]); // LD A,0F; LD B,01; ADD A,B
    gb.step();
    gb.step();
    gb.step();
    expect(gb.cpu.registers.a).toBe(0x10);
    expect(gb.cpu.registers.f & FLAG_H).toBe(FLAG_H);
    expect(gb.cpu.registers.f & FLAG_Z).toBe(0);
    expect(gb.cpu.registers.f & FLAG_N).toBe(0);
  });

  test("XOR A clears A and sets Z", () => {
    const gb = makeGb([0x3e, 0xff, 0xaf]);
    gb.step();
    gb.step();
    expect(gb.cpu.registers.a).toBe(0);
    expect(gb.cpu.registers.f & FLAG_Z).toBe(FLAG_Z);
  });

  test("JR NZ taken / not taken", () => {
    const gb = makeGb([0xaf, 0x20, 0x02, 0x3e, 0x99, 0x3e, 0x55]);
    // XOR A (Z=1), JR NZ +2 should NOT jump
    gb.step();
    gb.step();
    expect(gb.cpu.registers.pc).toBe(0x0103);
  });

  test("PUSH/POP BC", () => {
    const gb = makeGb([0x01, 0x34, 0x12, 0xc5, 0x01, 0x00, 0x00, 0xc1]);
    gb.step(); // LD BC,1234
    gb.step(); // PUSH BC
    gb.step(); // LD BC,0000
    expect(gb.cpu.registers.bc).toBe(0);
    gb.step(); // POP BC
    expect(gb.cpu.registers.bc).toBe(0x1234);
  });

  test("CB BIT / RES / SET", () => {
    const gb = makeGb([0x3e, 0x00, 0xcb, 0xc7, 0xcb, 0x47, 0xcb, 0x87]);
    // LD A,0; SET 0,A; BIT 0,A; RES 0,A
    gb.step();
    gb.step();
    expect(gb.cpu.registers.a).toBe(0x01);
    gb.step();
    expect(gb.cpu.registers.f & FLAG_Z).toBe(0);
    gb.step();
    expect(gb.cpu.registers.a).toBe(0);
  });

  test("INC B half-carry", () => {
    const gb = makeGb([0x06, 0x0f, 0x04]);
    gb.step();
    gb.step();
    expect(gb.cpu.registers.b).toBe(0x10);
    expect(gb.cpu.registers.f & FLAG_H).toBe(FLAG_H);
  });

  test("CALL and RET", () => {
    // at 100: CALL 0106; HALT-ish NOP; at 106: RET
    const gb = makeGb([0xcd, 0x06, 0x01, 0x00, 0x00, 0x00, 0xc9]);
    gb.step();
    expect(gb.cpu.registers.pc).toBe(0x0106);
    gb.step();
    expect(gb.cpu.registers.pc).toBe(0x0103);
  });

  test("ADC with carry", () => {
    const gb = makeGb([0x37, 0x3e, 0x01, 0xce, 0x01]); // SCF; LD A,1; ADC A,1
    gb.step();
    gb.step();
    gb.step();
    expect(gb.cpu.registers.a).toBe(0x03);
    expect(gb.cpu.registers.f & FLAG_C).toBe(0);
  });
});
