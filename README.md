# @slurrps/PrismBoy

A Game Boy / Game Boy Color emulator written in TypeScript with **no runtime dependencies**.

The package owns screen painting, scaling, sound, keyboard, on-screen pad, and gamepad polling. Host apps call the **`GameBoy` facade** — every public method lives on that class (`src/gameboy.ts`). Nested fields (`gb.cpu`, `gb.ppu`, `gb.joypad`, …) remain available for advanced/debug access but are not required for normal hosts.

## Install

```bash
npm install @slurrps/PrismBoy
```

## Quick start

```ts
import { GameBoy, Button } from "@slurrps/PrismBoy";

const gb = new GameBoy({ autoSave: true });
gb.attachScreen(document.querySelector("canvas")!, { scale: 3, mode: "integer" });
gb.attachFpsElement(document.getElementById("fps")!);
gb.attachKeyboard();
gb.attachVirtualPad(document.getElementById("pad")!);
gb.attachGamepad();

romInput.addEventListener("change", () => {
  const file = romInput.files?.[0];
  if (file) void gb.loadRomFromFile(file);
});

turboBtn.onclick = () => {
  turboBtn.textContent = gb.toggleTurbo() ? "Turbo on" : "Turbo off";
};
muteBtn.onclick = () => {
  muteBtn.textContent = gb.toggleMute() ? "Unmute" : "Mute";
};
```

---

## Public API reference

All methods below are on `GameBoy`. Examples assume `const gb = new GameBoy()`.

### Constructor

| Method | Description |
|--------|-------------|
| `new GameBoy(options?)` | Create an emulator. Options: `useBootRom?: boolean` (default `true`), `autoSave?: boolean`, `autoSavePrefix?: string`. |

```ts
const gb = new GameBoy({ useBootRom: true, autoSave: true });
```

### Boot / configuration

| Method | Description |
|--------|-------------|
| `setUseBootRom(enabled)` | Prefer bundled SameBoy boots (`true`) or skip to cart entry (`false`). |
| `setBootRom(rom \| null)` | Install a custom boot ROM, or `null` to clear and use bundled boots on next load. |

```ts
gb.setUseBootRom(true);
gb.setBootRom(myCgbBootRomBytes); // personal dump only
gb.setBootRom(null);
```

### Lifecycle / ROM

| Method | Description |
|--------|-------------|
| `loadRom(rom)` | Load a `Uint8Array` ROM, reset hardware, emit `romloaded`. |
| `loadRomFromFile(file)` | Pause → load from `File` → enable sound → auto-save → `run()`. |
| `reload()` | Soft reboot; preserves battery SRAM/RTC when present. |
| `unloadRom()` | Pause, unload ROM, clear screen; keeps input attachments. |
| `quit()` | Alias of `unloadRom()`. |
| `hasRom()` / `isLoaded()` | Whether a ROM is currently loaded. |
| `reset()` | Soft-reset CPU/PPU/APU/timer/joypad (keeps cart). Emits `reset`. |
| `run()` / `start()` | Start the `requestAnimationFrame` run loop. Emits `resume`. |
| `pause()` / `stop()` | Stop the run loop; flush dirty saves. Emits `pause`. |
| `resume()` | Alias of `run()`. |
| `destroy()` | Detach input/screen, clear listeners, unload ROM. Create a new instance afterward. |

```ts
gb.loadRom(romBytes);
await gb.loadRomFromFile(file);
gb.reload();
gb.pause();
gb.resume();
gb.unloadRom();
gb.destroy();
```

### Execution / stepping

| Method | Description |
|--------|-------------|
| `step()` / `stepInstruction()` | Execute one instruction (+ peripherals). Returns T-cycles. |
| `stepFrame()` | Run until the next completed LCD frame. |
| `stepScanline()` | Run until LY changes (debug). |

```ts
gb.pause();
gb.stepInstruction();
gb.stepScanline();
gb.stepFrame();
```

### Status / information

| Method | Description |
|--------|-------------|
| `isRunning()` | `true` while the RAF loop is active. |
| `isPaused()` | Inverse of `isRunning()`. |
| `getFps()` | Last measured frames-per-second. |
| `getFrameCount()` | Total frames presented since create. |
| `getCycles()` | Total CPU T-cycles since create. |
| `getTitle()` | Cartridge title, or `null`. |
| `isColorGame()` | `true` when running in CGB mode. |
| `getRomInfo()` | Full `CartridgeInfo`, or `null`. |
| `getCartridgeType()` | Header cart type byte, or `null`. |
| `getSystemName()` | `"Game Boy"` or `"Game Boy Color"`. |
| `getVersion()` | Package version string. |
| `getRomId()` / `setRomId(id)` | Identity key used for localStorage saves/slots. |

```ts
if (gb.isLoaded() && !gb.isRunning()) gb.start();
console.log(gb.getTitle(), gb.getSystemName(), gb.getFps());
```

### Speed / turbo

Host speed is independent of CGB hardware double-speed. Values clamp to `0.25…8`. Audio is muted automatically while effective speed &gt; 1×.

| Method | Description |
|--------|-------------|
| `setSpeed(n)` / `getSpeed()` | Base speed multiplier (default `1`). |
| `setTurboEnabled(on)` / `isTurboEnabled()` | Hold-to-fast-forward style turbo flag. |
| `toggleTurbo()` | Toggle turbo; returns new state. |
| `setTurboMultiplier(n)` / `getTurboMultiplier()` | Turbo speed when enabled (default `4`). |
| `getEffectiveSpeed()` | Turbo multiplier if turbo on, else `getSpeed()`. |

```ts
gb.setSpeed(2);
window.addEventListener("keydown", (e) => {
  if (e.code === "Tab") { e.preventDefault(); gb.setTurboEnabled(true); }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Tab") gb.setTurboEnabled(false);
});
```

### Audio

| Method | Description |
|--------|-------------|
| `enableSound()` | Resume/create Web Audio context (call after a user gesture). |
| `mute()` / `unMute()` / `toggleMute()` / `isMuted()` | User mute preference. |
| `setVolume(v)` / `getVolume()` | Linear gain `0…1`. |

```ts
gb.enableSound();
gb.setVolume(0.35);
muteBtn.textContent = gb.toggleMute() ? "Unmute" : "Mute";
```

### Video / display

| Method | Description |
|--------|-------------|
| `attachScreen(canvas, options?)` | Bind canvas; package paints each frame. |
| `detachScreen()` / `clearScreen()` | Unbind / clear canvas. |
| `attachFpsElement(el)` | Write `FPS: N` into an element each second. |
| `setScale(n)` / `getScale()` | Integer scale when mode is `integer`. |
| `setScaleMode(mode)` / `getScaleMode()` | `integer` \| `fit` \| `stretch` \| `fullscreen`. |
| `toggleFullscreen()` | Toggle Fullscreen API. |
| `getFrameBuffer()` | Live `ImageData` (160×144). |
| `getWidth()` / `getHeight()` | `160` / `144`. |
| `takeScreenshot()` | Cloned `ImageData` of the current frame. |
| `setPalette(colors)` / `getPalette()` / `resetPalette()` | Override DMG greyscale shades (RGBA×4). |
| `setColorCorrection(on)` / `isColorCorrectionEnabled()` | Mild CGB present-path correction (off by default). |

```ts
gb.attachScreen(canvas, { scale: 3, mode: "integer", container: wrap });
gb.setPalette([
  [255, 255, 255, 255],
  [170, 170, 170, 255],
  [85, 85, 85, 255],
  [0, 0, 0, 255],
]);
const shot = gb.takeScreenshot();
```

### Input

| Method | Description |
|--------|-------------|
| `pressButton(button)` / `releaseButton(button)` | Digital button press/release (`Button` enum). |
| `releaseAllButtons()` | Release every button. |
| `isButtonPressed(button)` | Current pressed state. |
| `attachKeyboard(target?)` / `detachKeyboard()` | Bind keyboard (default `window`). |
| `attachVirtualPad(root)` / `detachVirtualPad()` | Bind `[data-btn]` on-screen pad. |
| `attachGamepad(options?)` / `detachGamepad()` | Gamepad API polling. |
| `setKeyMapping(code, button)` | Remap a `KeyboardEvent.code`. |
| `setGamepadMap(map)` | Remap gamepad buttons/axes. |
| `onGamepadConnected(cb)` / `onGamepadDisconnected(cb)` | Gamepad plug callbacks (also emit events). |

```ts
gb.attachKeyboard();
gb.attachVirtualPad(document.getElementById("pad")!);
gb.pressButton(Button.A);
gb.releaseButton(Button.A);
gb.setKeyMapping("KeyA", Button.A);
```

#### Default keyboard map

| Key | Button |
|-----|--------|
| Arrow keys | D-pad |
| Z | A |
| X | B |
| Enter | Start |
| Shift | Select |

### Battery saves

| Method | Description |
|--------|-------------|
| `hasBatterySave()` | Cart has battery + SRAM and/or RTC. |
| `isSaveDirty()` | SRAM written since last flush. |
| `getSave()` / `loadSave(data)` | Serialize / deserialize `.sav` bytes. |
| `enableAutoSave(prefix?)` / `disableAutoSave()` | Debounced localStorage persistence. |
| `loadAutoSave()` | Load from localStorage for current `romId`. |
| `onSaveRamUpdated(cb)` | Custom persistence backend (disables built-in auto-save cb). |
| `downloadSave(filename?)` / `loadSaveFromFile(file)` | Browser download / upload. |
| `setRtc(date)` | Set MBC3 RTC from a `Date` (UTC fields; no-op without RTC). |

```ts
gb.enableAutoSave();
const sav = gb.getSave();
if (sav) gb.loadSave(sav);
gb.setRtc(new Date());
gb.downloadSave();
```

### Savestates

| Method | Description |
|--------|-------------|
| `createState()` / `loadState(data)` | Full-machine snapshot (`Uint8Array`). |
| `saveStateSlot(n)` / `loadStateSlot(n)` | In-memory + localStorage slot (1-based). |
| `downloadState(filename?)` / `loadStateFromFile(file)` | Browser download / upload. |

```ts
gb.saveStateSlot(1);
gb.loadStateSlot(1);
const blob = gb.createState();
gb.loadState(blob);
```

### Events

Multi-listener bus. Legacy helpers still work.

| Method | Description |
|--------|-------------|
| `on(event, handler)` / `off(event, handler)` | Subscribe / unsubscribe. |
| `onFrameFinished(cb)` | Convenience wrapper for `frame`. |
| `onSaveRamUpdated(cb)` | Legacy single save callback (see Saves). |

**Events:** `frame`, `save`, `pause`, `resume`, `reset`, `romloaded`, `error`, `breakpoint`, `gamepadconnected`, `gamepaddisconnected`.

```ts
const onFrame = (frame: ImageData, fps: number) => { /* … */ };
gb.on("frame", onFrame);
gb.on("romloaded", (title) => console.log(title));
gb.on("breakpoint", (addr) => console.log("hit", addr.toString(16)));
gb.off("frame", onFrame);
```

### Debug

| Method | Description |
|--------|-------------|
| `readByte(addr)` / `writeByte(addr, value)` | Peek / poke one byte. |
| `readMemory(addr, length)` / `writeMemory(addr, data)` | Block memory access. |
| `getCpuRegisters()` | AF/BC/DE/HL/SP/PC + flags + IME/HALT. |
| `getPpuState()` | LY, mode, LCDC/STAT, scroll, window. |
| `getTimerState()` | DIV/TIMA/TMA/TAC. |
| `getInterruptState()` | IE / IF / IME. |
| `setBreakpoint(addr)` / `removeBreakpoint(addr)` | PC breakpoints (pause + emit). |
| `clearBreakpoints()` / `getBreakpoints()` | Clear / list. |
| `disassemble(addr, count?)` | Disassemble `count` instructions (default 1). |

```ts
gb.pause();
gb.setBreakpoint(0x0150);
gb.run(); // pauses and emits when PC hits
console.log(gb.getCpuRegisters().pc.toString(16));
console.log(gb.disassemble(0x0100, 8));
```

### Package exports

```ts
import {
  GameBoy,
  Button,
  VirtualPadMapping,
  DMG_BOOT,
  CGB_BOOT,
} from "@slurrps/PrismBoy";
```

Types: `Cartridge`, `CartridgeInfo`, `ScaleMode`, `ScreenOptions`, `GamepadButtonMap`, `DmgPalette`, `Rgba`, `GameBoyEvents`, debug snapshot types.

---

## On-screen pad HTML

```html
<div id="pad">
  <button type="button" data-btn="Up">▲</button>
  <button type="button" data-btn="A">A</button>
  <!-- Left Right Down B Start Select -->
</div>
```

## Boot ROM

Bundled [SameBoy](https://github.com/LIJI32/SameBoy) open-source boots (Expat/MIT) — recommended for Pokémon Crystal.

Official Nintendo dumps are copyrighted — don’t redistribute them.

## Scale modes

| Mode | Behavior |
|------|----------|
| `integer` | Nearest integer multiple (default ×3 → 480×432), pixelated |
| `fit` | Largest size that fits the container, keep aspect |
| `stretch` | Fill container (may distort) |
| `fullscreen` | Fullscreen API + fit inside |

## Demo

```bash
npm install
npm run dev
```

Open the Vite URL, load a `.gb` / `.gbc` ROM you legally own.

## Build / test

```bash
npm test
npm run build
```

Published files: `dist/gameboy.js`, `dist/gameboy.d.ts`, `README.md`, `LICENSE`.
