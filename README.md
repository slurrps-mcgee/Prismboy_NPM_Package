# @slurrps/PrismBoy

A Game Boy / Game Boy Color emulator written in TypeScript with **no runtime dependencies**.

The package owns screen painting, scaling, sound, keyboard, on-screen pad, and gamepad polling — hosts mostly attach DOM nodes and call public APIs.

## Install

```bash
npm install @slurrps/PrismBoy
```

## Quick start

```ts
import { GameBoy } from "@slurrps/PrismBoy";

const gb = new GameBoy({ autoSave: true });
const canvas = document.querySelector("canvas")!;
const pad = document.getElementById("pad")!;

gb.attachScreen(canvas, { scale: 3, mode: "integer" });
gb.attachFpsElement(document.getElementById("fps")!);
gb.joypad.attachKeyboard();
gb.joypad.attachVirtualPad(pad);
gb.joypad.attachGamepad();

romInput.addEventListener("change", () => {
  const file = romInput.files?.[0];
  if (file) void gb.loadRomFromFile(file);
});

reloadBtn.onclick = () => gb.reload();
quitBtn.onclick = () => gb.quit();
muteBtn.onclick = () => {
  muteBtn.textContent = gb.toggleMute() ? "Unmute" : "Mute";
};
```

The host page only wires DOM events to package methods — painting, pad, gamepad, scaling, and battery auto-save live in the package.

### On-screen pad HTML

```html
<div id="pad">
  <button type="button" data-btn="Up">▲</button>
  <button type="button" data-btn="A">A</button>
  <!-- Left Right Down B Start Select -->
</div>
```

## Boot ROM

Bundled [SameBoy](https://github.com/LIJI32/SameBoy) open-source boots (Expat/MIT) — recommended for Pokémon Crystal.

```ts
const gb = new GameBoy({ useBootRom: true }); // default
gb.setBootRom(myCgbBootRomBytes);             // optional personal dump
```

Official Nintendo dumps are copyrighted — don’t redistribute them.

## Saves

| Kind | API | Use case |
|------|-----|----------|
| Auto battery | `{ autoSave: true }` / `enableAutoSave()` | localStorage `gbc-sav:{romId}` |
| Battery file | `downloadSave` / `loadSaveFromFile` | `.sav` download/upload |
| Savestate file | `downloadState` / `loadStateFromFile` | `.state` download/upload |
| Savestate slots | `saveStateSlot(n)` / `loadStateSlot(n)` | In-memory + localStorage |
| Low-level | `getSave` / `loadSave` / `createState` / `loadState` | Custom hosts |

`onSaveRamUpdated` is still available if you want a custom persistence backend (disables the built-in auto-save callback).

## Default keyboard map

| Key | Button |
|-----|--------|
| Arrow keys | D-pad |
| Z | A |
| X | B |
| Enter | Start |
| Shift | Select |

Remap with `gb.joypad.setKeyMapping("KeyA", Button.A)`.

## Gamepad

`attachGamepad()` listens for connect/disconnect and polls the first pad:

- D-pad / left stick → D-pad  
- Button 0 → B, 1 → A, 8 → Select, 9 → Start  

```ts
gb.joypad.onGamepadConnected((pad) => console.log(pad.id));
gb.joypad.setGamepadMap({ buttons: { 0: Button.B, 1: Button.A } });
```

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

## License

MIT
