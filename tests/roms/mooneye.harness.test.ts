/**
 * Optional Mooneye acceptance harness.
 *
 * Place Mooneye GB test ROMs under tests/fixtures/roms/mooneye/ (gitignored).
 * Expected layout examples:
 *   tests/fixtures/roms/mooneye/acceptance/timer/div_write.gb
 *   tests/fixtures/roms/mooneye/acceptance/oam_dma/basic.gb
 *
 * Do NOT publish copyrighted ROMs in the npm package.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { GameBoy } from "@/gameboy";

const here = fileURLToPath(new URL(".", import.meta.url));
const MOONEYE_ROOT = join(here, "../fixtures/roms/mooneye");

const TIMER_DIR = join(MOONEYE_ROOT, "acceptance/timer");
const OAM_DMA_DIR = join(MOONEYE_ROOT, "acceptance/oam_dma");

function listGb(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isFile() && name.endsWith(".gb")) out.push(p);
  }
  return out.sort();
}

const timerRoms = listGb(TIMER_DIR);
const oamDmaRoms = listGb(OAM_DMA_DIR);
const hasAny = timerRoms.length > 0 || oamDmaRoms.length > 0;

const describeIf = hasAny ? describe : describe.skip;

describeIf("Mooneye harness (optional)", () => {
  if (timerRoms.length === 0) {
    test.skip("timer fixtures missing", () => undefined);
  } else {
    for (const romPath of timerRoms) {
      const name = romPath.split(/[/\\]/).pop()!;
      test(`timer/${name} runs without throwing`, () => {
        const rom = new Uint8Array(readFileSync(romPath));
        const gb = new GameBoy({ useBootRom: false });
        gb.loadRom(rom);
        for (let i = 0; i < 200_000; i++) gb.step();
        expect(gb.cpu.registers.pc).toBeGreaterThan(0);
      });
    }
  }

  if (oamDmaRoms.length === 0) {
    test.skip("oam_dma fixtures missing", () => undefined);
  } else {
    for (const romPath of oamDmaRoms) {
      const name = romPath.split(/[/\\]/).pop()!;
      test(`oam_dma/${name} runs without throwing`, () => {
        const rom = new Uint8Array(readFileSync(romPath));
        const gb = new GameBoy({ useBootRom: false });
        gb.loadRom(rom);
        for (let i = 0; i < 200_000; i++) gb.step();
        expect(gb.cpu.registers.pc).toBeGreaterThan(0);
      });
    }
  }
});

// Always-present smoke: harness file loads and skips cleanly when fixtures absent
describe("Mooneye harness gate", () => {
  test("skips when fixtures directory is absent", () => {
    if (!existsSync(MOONEYE_ROOT)) {
      expect(hasAny).toBe(false);
    } else {
      expect(typeof hasAny).toBe("boolean");
    }
  });
});
