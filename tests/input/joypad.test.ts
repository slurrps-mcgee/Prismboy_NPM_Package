import { GameBoy, Button } from "@/gameboy";

describe("Joypad", () => {
  function setup() {
    const gb = new GameBoy({ useBootRom: false });
    const rom = new Uint8Array(0x8000);
    rom[0x147] = 0x00;
    gb.loadRom(rom);
    return gb;
  }

  test("triggerButton updates P1 when d-pad selected", () => {
    const gb = setup();
    gb.joypad.writeP1(0x20); // select d-pad (bit4=0)
    expect(gb.joypad.readP1() & 0x0f).toBe(0x0f);
    gb.joypad.triggerButton(Button.Right, true);
    expect(gb.joypad.readP1() & 0x01).toBe(0);
    expect(gb.joypad.isButtonPressed(Button.Right)).toBe(true);
  });

  test("keyboard mapping and triggerButton are equivalent", () => {
    const gb = setup();
    gb.joypad.writeP1(0x10); // select buttons
    gb.joypad.triggerButton(Button.A, true);
    const viaTrigger = gb.joypad.readP1();

    gb.joypad.triggerButton(Button.A, false);
    // Simulate key path
    gb.joypad.setKeyMapping("KeyZ", Button.A);
    gb.joypad.triggerButton(gb.joypad.KeyboardMapping["KeyZ"]!, true);
    expect(gb.joypad.readP1()).toBe(viaTrigger);
  });

  test("button press requests joypad interrupt when selected", () => {
    const gb = setup();
    gb.joypad.writeP1(0x10); // select buttons
    const before = gb.bus.getIf();
    gb.joypad.triggerButton(Button.Start, true);
    expect(gb.bus.getIf() & 0x10).toBe(0x10);
    expect(gb.bus.getIf()).not.toBe(before & ~0x10);
  });
});
