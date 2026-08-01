import { createCartridge, parseHeader } from "@/cartridge/cartridge";
import { serializeSave, deserializeSave } from "@/cartridge/saveData";

function makeRom(type: number, ramCode: number, size = 0x8000): Uint8Array {
  const rom = new Uint8Array(size);
  rom[0x134] = 0x54;
  rom[0x135] = 0x45;
  rom[0x136] = 0x53;
  rom[0x137] = 0x54;
  rom[0x147] = type;
  rom[0x148] = size > 0x8000 ? 0x01 : 0x00;
  rom[0x149] = ramCode;
  return rom;
}

describe("Cartridge / saves", () => {
  test("parseHeader extracts title and type", () => {
    const info = parseHeader(makeRom(0x13, 0x03));
    expect(info.title).toContain("TEST");
    expect(info.type).toBe(0x13);
    expect(info.hasBattery).toBe(true);
  });

  test("MBC1 ROM banking", () => {
    const rom = makeRom(0x01, 0x00, 0x10000);
    rom[0x4000] = 0xaa;
    rom[0x8000] = 0xbb;
    const cart = createCartridge(rom);
    expect(cart.read(0x4000)).toBe(0xaa);
    cart.write(0x2000, 0x02);
    expect(cart.read(0x4000)).toBe(0xbb);
  });

  test("MBC3 SRAM write/read", () => {
    const cart = createCartridge(makeRom(0x13, 0x02));
    cart.write(0x0000, 0x0a); // enable ram
    cart.write(0xa000, 0x42);
    expect(cart.read(0xa000)).toBe(0x42);
  });

  test("battery save round-trip", () => {
    const sram = new Uint8Array([1, 2, 3, 4]);
    const rtc = { s: 10, m: 20, h: 5, dl: 1, dh: 0, lastUnixMs: 1_700_000_000_000 };
    const blob = serializeSave(sram, rtc);
    const out = deserializeSave(blob);
    expect([...out.sram]).toEqual([1, 2, 3, 4]);
    expect(out.rtc?.s).toBe(10);
    expect(out.rtc?.m).toBe(20);
    expect(out.rtc?.lastUnixMs).toBe(1_700_000_000_000);
  });
});
