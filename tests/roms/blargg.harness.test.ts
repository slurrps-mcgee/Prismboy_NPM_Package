/**
 * Optional ROM acceptance harness.
 *
 * Place Blargg / Mooneye ROMs under tests/fixtures/roms/ (gitignored) and they will run.
 * Do NOT publish copyrighted ROMs in the npm package.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { GameBoy } from "@/gameboy";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROM = join(here, "../fixtures/roms/blargg/cpu_instrs/cpu_instrs.gb");

const describeIfRom = existsSync(ROM) ? describe : describe.skip;

describeIfRom("Blargg cpu_instrs (optional)", () => {
  test("runs without throwing for several frames", () => {
    const rom = new Uint8Array(readFileSync(ROM));
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(rom);
    for (let i = 0; i < 100_000; i++) gb.step();
    expect(gb.cpu.registers.pc).toBeGreaterThan(0);
  });
});
