import { GameBoy, Button } from "@/gameboy";

function makeRom(opts?: { cgb?: boolean; type?: number; ram?: number; title?: string }): Uint8Array {
  const rom = new Uint8Array(0x8000);
  rom[0x147] = opts?.type ?? 0x00;
  rom[0x149] = opts?.ram ?? 0x00;
  if (opts?.cgb) rom[0x143] = 0x80;
  const title = opts?.title ?? "TESTROM";
  for (let i = 0; i < title.length && i < 15; i++) {
    rom[0x134 + i] = title.charCodeAt(i);
  }
  // NOP sled at entry so stepping is safe
  rom[0x100] = 0x00;
  rom[0x101] = 0x00;
  rom[0x102] = 0xc3; // JP 0x0150
  rom[0x103] = 0x50;
  rom[0x104] = 0x01;
  rom[0x150] = 0x00; // NOP
  rom[0x151] = 0x18; // JR -2 (loop)
  rom[0x152] = 0xfe;
  return rom;
}

describe("GameBoy host API", () => {
  test("status / info after loadRom", () => {
    const gb = new GameBoy({ useBootRom: false });
    expect(gb.isLoaded()).toBe(false);
    expect(gb.isPaused()).toBe(true);
    gb.loadRom(makeRom({ title: "HOSTAPI", cgb: true }));
    expect(gb.isLoaded()).toBe(true);
    expect(gb.hasRom()).toBe(true);
    expect(gb.getTitle()).toBe("HOSTAPI");
    expect(gb.isColorGame()).toBe(true);
    expect(gb.getSystemName()).toBe("Game Boy Color");
    expect(gb.getVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(gb.getRomInfo()?.title).toBe("HOSTAPI");
    expect(gb.getWidth()).toBe(160);
    expect(gb.getHeight()).toBe(144);
  });

  test("speed / turbo clamp and effective speed", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.setSpeed(2);
    expect(gb.getSpeed()).toBe(2);
    expect(gb.getEffectiveSpeed()).toBe(2);
    gb.setTurboMultiplier(4);
    gb.setTurboEnabled(true);
    expect(gb.isTurboEnabled()).toBe(true);
    expect(gb.getEffectiveSpeed()).toBe(4);
    expect(gb.toggleTurbo()).toBe(false);
    expect(gb.getEffectiveSpeed()).toBe(2);
    gb.setSpeed(100);
    expect(gb.getSpeed()).toBe(8);
    gb.setSpeed(0);
    expect(gb.getSpeed()).toBe(0.25);
  });

  test("input facade press / release / releaseAll", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(makeRom());
    gb.pressButton(Button.A);
    expect(gb.isButtonPressed(Button.A)).toBe(true);
    gb.releaseButton(Button.A);
    expect(gb.isButtonPressed(Button.A)).toBe(false);
    gb.pressButton(Button.Start);
    gb.pressButton(Button.B);
    gb.releaseAllButtons();
    expect(gb.isButtonPressed(Button.Start)).toBe(false);
    expect(gb.isButtonPressed(Button.B)).toBe(false);
  });

  test("events: romloaded, reset, frame via stepFrame", () => {
    const gb = new GameBoy({ useBootRom: false });
    const titles: string[] = [];
    let resets = 0;
    let frames = 0;
    gb.on("romloaded", (t) => titles.push(t));
    gb.on("reset", () => resets++);
    gb.on("frame", () => frames++);
    gb.loadRom(makeRom({ title: "EVT" }));
    expect(titles).toEqual(["EVT"]);
    expect(resets).toBeGreaterThanOrEqual(1);
    const cycles = gb.stepFrame();
    expect(cycles).toBeGreaterThan(0);
    expect(frames).toBe(1);
    expect(gb.getFrameCount()).toBe(1);
  });

  test("breakpoint pauses and emits", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(makeRom());
    // After JP at 0x100, PC lands at 0x0150
    const hits: number[] = [];
    gb.on("breakpoint", (a) => hits.push(a));
    gb.setBreakpoint(0x0150);
    // Step past entry JP
    for (let i = 0; i < 8; i++) {
      gb.step();
      if (hits.length) break;
    }
    expect(hits).toContain(0x0150);
    expect(gb.isPaused()).toBe(true);
    expect(gb.getBreakpoints()).toEqual([0x0150]);
    gb.clearBreakpoints();
    expect(gb.getBreakpoints()).toEqual([]);
  });

  test("debug memory and disassemble", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(makeRom());
    gb.writeByte(0xc000, 0x42);
    expect(gb.readByte(0xc000)).toBe(0x42);
    const block = gb.readMemory(0xc000, 2);
    expect(block[0]).toBe(0x42);
    const lines = gb.disassemble(0x0100, 2);
    expect(lines.length).toBe(2);
    expect(lines[0]!.mnemonic).toBe("NOP");
    const regs = gb.getCpuRegisters();
    expect(typeof regs.pc).toBe("number");
    expect(gb.getPpuState().width).toBe(160);
    expect(gb.getTimerState()).toHaveProperty("div");
    expect(gb.getInterruptState()).toHaveProperty("ie");
  });

  test("palette override and screenshot", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(makeRom());
    const mono: [[number, number, number, number], [number, number, number, number], [number, number, number, number], [number, number, number, number]] = [
      [255, 255, 255, 255],
      [170, 170, 170, 255],
      [85, 85, 85, 255],
      [0, 0, 0, 255],
    ];
    gb.setPalette(mono);
    expect(gb.getPalette()[3]).toEqual([0, 0, 0, 255]);
    gb.stepFrame();
    const shot = gb.takeScreenshot();
    expect(shot.width).toBe(160);
    expect(shot.height).toBe(144);
    expect(shot.data.length).toBe(160 * 144 * 4);
  });

  test("unloadRom / destroy / isSaveDirty with battery cart", async () => {
    const gb = new GameBoy({ useBootRom: false });
    const rom = makeRom({ type: 0x13, ram: 0x02 });
    gb.loadRom(rom);
    expect(gb.hasBatterySave()).toBe(true);
    expect(gb.isSaveDirty()).toBe(false);
    gb.bus.cartridge!.write(0x0000, 0x0a);
    gb.bus.cartridge!.write(0xa000, 0x55);
    expect(gb.isSaveDirty()).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    gb.unloadRom();
    expect(gb.isLoaded()).toBe(false);
    gb.destroy();
    expect(gb.isRunning()).toBe(false);
  });

  test("setRtc on MBC3+RTC cart", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(makeRom({ type: 0x0f, ram: 0x00 })); // MBC3+TIMER+BATTERY
    expect(gb.bus.cartridge?.rtc).not.toBeNull();
    const d = new Date("2020-06-15T12:30:45Z");
    gb.setRtc(d);
    expect(gb.bus.cartridge!.rtc!.lastUnixMs).toBe(d.getTime());
    expect(gb.bus.cartridge!.rtc!.s).toBe(45);
    expect(gb.bus.cartridge!.rtc!.m).toBe(30);
    expect(gb.bus.cartridge!.rtc!.h).toBe(12);
  });

  test("stepScanline advances LY", () => {
    const gb = new GameBoy({ useBootRom: false });
    gb.loadRom(makeRom());
    const start = gb.ppu.ly;
    const c = gb.stepScanline();
    expect(c).toBeGreaterThan(0);
    expect(gb.ppu.ly).not.toBe(start);
  });
});
