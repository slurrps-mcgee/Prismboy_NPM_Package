import { GameBoy } from "@/gameboy";
import { deserializeSave } from "@/cartridge/saveData";

describe("GameBoy battery save API", () => {
  test("hasBatterySave / getSave / loadSave", () => {
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x13; // MBC3+RAM+BATTERY
    rom[0x149] = 0x02; // 8KB ram
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(rom);

    expect(gb.hasBatterySave()).toBe(true);
    gb.bus.cartridge!.write(0x0000, 0x0a);
    gb.bus.cartridge!.write(0xa000, 0x77);

    const sav = gb.getSave();
    expect(sav).not.toBeNull();

    gb.bus.cartridge!.write(0xa000, 0x00);
    gb.loadSave(sav!);
    expect(gb.bus.cartridge!.read(0xa000)).toBe(0x77);
  });

  test("onSaveRamUpdated fires on SRAM write", async () => {
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x13;
    rom[0x149] = 0x02;
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(rom);
    const updates: Uint8Array[] = [];
    gb.onSaveRamUpdated((d) => updates.push(d));

    gb.bus.cartridge!.write(0x0000, 0x0a);
    gb.bus.cartridge!.write(0xa000, 0x11);
    await new Promise((r) => setTimeout(r, 300));
    expect(updates.length).toBeGreaterThan(0);
    const round = deserializeSave(updates[updates.length - 1]!);
    expect(round.sram[0]).toBe(0x11);
  });
});
