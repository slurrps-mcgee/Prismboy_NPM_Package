# @slurrps/prismboy — Internal Documentation

Thorough reference for developing, debugging, and extending the Game Boy / Game Boy Color emulator.  
For consumer-facing install/API notes, see [`README.md`](./README.md).

**Hardware reference:** [Pan Docs](https://gbdev.io/pandocs/)  
**Comparable JS reference used during development:** [gbcore](https://github.com/afska/gbcore)

---

## Table of contents

1. [Overview](#1-overview)
2. [Repository layout](#2-repository-layout)
3. [Build, demo, and tests](#3-build-demo-and-tests)
4. [High-level architecture](#4-high-level-architecture)
5. [Emulation flow (end-to-end)](#5-emulation-flow-end-to-end)
6. [Timing model (critical)](#6-timing-model-critical)
7. [Memory map and Bus](#7-memory-map-and-bus)
8. [Class / module reference](#8-class--module-reference)
9. [Constants](#9-constants)
10. [Cartridge, battery saves, savestates](#10-cartridge-battery-saves-savestates)
11. [Boot ROM](#11-boot-rom)
12. [Demo app wiring](#12-demo-app-wiring)
13. [Accuracy notes and known limitations](#13-accuracy-notes-and-known-limitations)
14. [Debugging playbook](#14-debugging-playbook)
15. [Extending the emulator](#15-extending-the-emulator)
16. [Changelog of hard-won fixes](#16-changelog-of-hard-won-fixes)

---

## 1. Overview

`@slurrps/prismboy` is a **zero-runtime-dependency** TypeScript emulator that:

- Emulates DMG (monochrome) and CGB (color) hardware
- Renders to a host-owned canvas (package paints via `attachScreen`)
- Scales the display (`integer` / `fit` / `stretch` / `fullscreen`)
- Outputs audio through the Web Audio API
- Owns keyboard, virtual pad (`[data-btn]`), and Gamepad API polling
- Supports battery saves (`.sav`) and full-machine savestates (`.state`)
- Ships MBC0 / MBC1 / MBC3(+RTC) / MBC5 cartridge backends

The public package entry is **`src/gameboy.ts`**, bundled by Webpack to **`dist/gameboy.js`** (+ `.d.ts`).

The package owns painting, scaling, sound, input attachment, **and** common web save persistence (`autoSave` → localStorage, download/upload helpers, state slots). The host page only provides DOM and event listeners that call `GameBoy` APIs.

See also personal (gitignored) deep dive: `PRIVATE_APP_REFERENCE.md` if present locally.

---

## 2. Repository layout

```
GBC/
├── documentation.md          ← this file
├── README.md                 ← consumer API
├── package.json
├── webpack.config.js         ← library build → dist/gameboy.js
├── vite.config.ts            ← demo (`npm run dev`)
├── jest.config.js
├── tsconfig.json             ← library (excludes example.ts)
├── tsconfig.test.json
├── index.html / styles.css   ← demo shell
├── src/
│   ├── gameboy.ts            ← public facade + run loop (PACKAGE ENTRY)
│   ├── example.ts            ← Vite demo only (not in npm build)
│   ├── display/screen.ts     ← canvas paint + scale modes
│   ├── bus/bus.ts
│   ├── cpu/                  ← SM83 CPU; opcodes in opcodes/opcodes.ts + cbOpcodes.ts
│   ├── ppu/                  ← scanline renderer
│   ├── apu/                  ← 4-channel audio
│   ├── timer/timer.ts
│   ├── input/                ← joypad, virtualPad, gamepad
│   ├── cartridge/            ← MBC + battery save format
│   ├── state/savestate.ts    ← full-machine snapshot format
│   ├── boot/                 ← SameBoy DMG/CGB boot ROMs
│   ├── constants/            ← IO map, LCDC/STAT, flags, buttons
│   └── types/index.ts
└── tests/                    ← Jest suites
```

**Path alias:** `@/` → `src/` (Webpack, Vite, Jest).

---

## 3. Build, demo, and tests

| Command | What it does |
|---------|----------------|
| `npm run dev` | Vite demo at `index.html` → `src/example.ts` |
| `npm run build` | Webpack ESM library → `dist/gameboy.js` |
| `npm test` | Jest (`node --experimental-vm-modules`) |
| `npm run test:watch` | Jest watch mode |

**Package exports** (`package.json`):

- `main` / `exports["."].import` → `./dist/gameboy.js`
- `types` → `./dist/gameboy.d.ts`
- Published files: `dist/`, `LICENSE`, `README.md` (not this internal doc unless you add it)

**Public surface re-exported from `gameboy.ts`:**

- `GameBoy`, `Button`
- Types: `Cartridge`, `CartridgeInfo`
- Boot arrays: `DMG_BOOT`, `CGB_BOOT`

### Publishing to npm

Workflow: [`.github/workflows/npm.yml`](.github/workflows/npm.yml) (`workflow_dispatch`). Auth uses **npm Trusted Publishing (OIDC)** — no `NPM_TOKEN` / OTP.

One-time setup on [npmjs.com package settings](https://www.npmjs.com/package/@slurrps/prismboy) → **Trusted Publisher**:

| Field | Value |
|-------|--------|
| Provider | GitHub Actions |
| Organization / user | `slurrps-mcgee` |
| Repository | `Prismboy_NPM_Package` |
| Workflow filename | `npm.yml` |
| Environment | *(empty)* |

Allow **`npm publish`**. Bump `package.json` `version` before re-running the workflow if that version is already on the registry.

---

## 4. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         GameBoy                             │
│  run loop (rAF) · frame/save callbacks · timing split       │
│  loadRom / reload / reset / step / saves / savestates       │
└──────────┬──────────────────────────────────────────────────┘
           │ owns + wires
     ┌─────┴─────┬─────────┬─────────┬──────────┬──────────┐
     ▼           ▼         ▼         ▼          ▼          ▼
   CPU         Bus       Ppu      Timer      Joypad      Apu
     │           │         │         │          │          │
     └────read/write───────┘         │          │          │
                 │                   │          │          │
                 ├◄── LCDC/STAT/LY ──┤          │          │
                 ├◄── DIV/TIMA ──────┘          │          │
                 ├◄── P1 ───────────────────────┘          │
                 ├◄── NR10–wave ───────────────────────────┘
                 └─► Cartridge (MBC / SRAM / RTC)
```

**Ownership rule:** `GameBoy` constructs every subsystem and injects cross-links onto `Bus` (`joypad`, `timer`, `ppu`, `apu`, `onSramWrite`). Subsystems talk to memory through `Bus.read` / `Bus.write` (except PPU, which often reads `vram` / `oam` arrays directly for speed).

---

## 5. Emulation flow (end-to-end)

### 5.1 Load

```
loadRom(romBytes)
  1. Keep a private copy of the ROM (for reload)
  2. createCartridge(rom) → parse header, pick MBC class
  3. cgbMode = (cart.info.cgbFlag & 0x80) !== 0
  4. bus.loadCartridge(cart)
  5. Attach SameBoy boot ROM (or null if useBootRom=false)
  6. reset()
```

### 5.2 Reset

```
reset()
  boot = useBootRom && bootRom present
  bus.reset(cgbMode, boot)
  cpu.reset(cgbMode, boot)   → PC=0 if boot, else post-boot regs @ 0x0100
  ppu / timer / joypad / apu reset
  lcdPhase = 0               → clear double-speed fractional carry
```

### 5.3 Run loop (`GameBoy.run`)

Each `requestAnimationFrame`:

1. Clamp `dt` to ≤ 50 ms (avoid spiral-of-death after tab suspend).
2. Compute cycle **budget**:
   ```
   speed  = bus.doubleSpeed ? 2 : 1
   budget = CYCLES_PER_FRAME * speed * dt / (1000/60)
   ```
   So in double-speed, the CPU gets ~140 448 T-cycles per wall-clock frame, while the LCD still advances 70 224 dots (see [§6](#6-timing-model-critical)).
3. Until budget exhausted:
   - `c = cpu.step()` — one instruction (or interrupt entry), returns **T-cycles**
   - `advancePeripherals(c)` — timer full rate; PPU+APU LCD rate
   - If PPU reports frame complete → `onFrameFinished(frameBuffer, fps)`

### 5.4 Single step

`step()` runs one CPU instruction + peripherals. Useful for tests and debuggers. Does **not** drive rAF.

### 5.5 Pause

Cancels rAF and **synchronously flushes** any pending battery-save callback so the host does not lose SRAM on tab close / ROM switch.

### 5.6 Frame callback contract

```ts
gb.onFrameFinished((frame: ImageData, fps: number) => {
  ctx.putImageData(frame, 0, 0);
});
```

- `frame` is `ppu.frameBuffer` (RGBA, 160×144).
- Fired when LY transitions to 144 (start of VBlank), not at LY wrap.
- Host should set `imageSmoothingEnabled = false` for crisp pixels.

---

## 6. Timing model (critical)

Game Boy Color **double-speed mode** is the #1 source of Pokémon Crystal graphical corruption if implemented wrong.

### 6.1 Hardware rules ([Pan Docs — KEY1](https://gbdev.io/pandocs/CGB_Registers.html))

| Subsystem | Double-speed behavior |
|-----------|------------------------|
| CPU | 2× |
| Timer / DIV | 2× |
| Serial / OAM DMA | 2× |
| **LCD (PPU)** | **1× (unchanged)** |
| **HDMA block wall-time** | **unchanged** |
| **Sound timings** | **1×** |

### 6.2 How this emulator maps it

CPU opcodes return **T-cycles** (4× M-cycles), same numeric style as normal-speed.

```ts
// GameBoy.advancePeripherals
timer.tick(cpuCycles);           // full rate — matches CPU
lcdDots = doubleSpeed
  ? (cpuCycles + lcdPhase) >> 1  // half rate — matches LCD / APU
  : cpuCycles;
lcdPhase = doubleSpeed ? (cpuCycles + lcdPhase) & 1 : 0;
apu.tick(lcdDots);
ppu.tick(lcdDots);
```

`lcdPhase` carries the odd leftover T-cycle so we never lose half-dots across instructions.

### 6.3 Speed switch path

1. Game writes `KEY1` bit 0 = 1 (prepare).
2. CPU executes `STOP` (`0x10`).
3. If CGB and bit 0 set: toggle `bus.doubleSpeed`, clear `key1`, clear `stopped`.
4. Run loop automatically doubles the per-frame CPU budget.

**Debug check:** After Crystal boots, `gb.bus.doubleSpeed` should become `true`. If PPU ran at full CPU rate while doubleSpeed=true, HDMA would finish on the wrong scanlines → font tiles (`"`, `^`) in map walls, menu/battle garbage.

### 6.4 Machine constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `CPU_HZ` | 4 194 304 | Normal-speed T-cycle rate |
| `CYCLES_PER_FRAME` | 70 224 | LCD dots per frame (= CPU T-cycles/frame in normal speed) |
| `DOTS_PER_LINE` | 456 | Dots per scanline |
| `LINES_PER_FRAME` | 154 | 144 visible + 10 VBlank |
| `VBLANK_START` | 144 | First VBlank LY |

---

## 7. Memory map and Bus

All 16-bit addressing goes through `Bus` (`src/bus/bus.ts`).

| Range | Mapping |
|-------|---------|
| `0000–00FF` | Boot ROM (if enabled) else cart ROM |
| `0100–01FF` | **Always cartridge** (header visible during boot) |
| `0200–08FF` | CGB boot ROM extension (if enabled) else cart |
| `0900–7FFF` | Cart ROM (banked via MBC) |
| `8000–9FFF` | VRAM bank selected by `VBK` (`vram[0\|1]`) |
| `A000–BFFF` | Cart external RAM / MBC3 RTC registers |
| `C000–CFFF` | WRAM bank 0 |
| `D000–DFFF` | WRAM bank `SVBK` (1–7; write 0 → bank 1) |
| `E000–FDFF` | Echo RAM → WRAM − `0x2000` |
| `FE00–FE9F` | OAM (40 sprites × 4 bytes) |
| `FEA0–FEFF` | Unusable → reads `0xFF` |
| `FF00–FF7F` | Memory-mapped IO |
| `FF80–FFFE` | HRAM |
| `FFFF` | IE (interrupt enable) |

### 7.1 Notable IO routing

| Register | Handler |
|----------|---------|
| `FF00` P1 | Joypad |
| `FF04–FF07` | Timer (DIV/TIMA/TMA/TAC) |
| `FF0F` IF | Interrupt flags (bus) |
| `FF10–FF3F` | APU (+ wave RAM) |
| `FF40–FF4B` | PPU (LCDC, STAT, scroll, LY, palettes, WY/WX) |
| `FF46` DMA | Instant OAM DMA (160 bytes) |
| `FF4D` KEY1 | Speed prepare / status |
| `FF4F` VBK | VRAM bank |
| `FF50` | Boot ROM unmap (any non-zero) |
| `FF51–FF55` | HDMA source/dest/length |
| `FF68–FF6B` | CGB BG/OBJ palette index + data |
| `FF70` SVBK | WRAM bank |

### 7.2 HDMA / VRAM DMA (CGB)

Pokémon Crystal depends on this. Implemented in `Bus.startHdma` / `Bus.tickHdma`.

| Mode | Trigger | Behavior |
|------|---------|----------|
| General-purpose (HDMA5 bit7=0) | Write HDMA5 | Copy entire length **immediately** into current VBK |
| HBlank DMA (bit7=1) | Write HDMA5 | Transfer **16 bytes** each time PPU **enters HBlank** on LY 0–143 |
| Abort | Write HDMA5 with bit7=0 while active | Stop; read returns `0x80 \| (remainingBlocks−1)` |
| Complete | Natural finish / overflow | HDMA5 reads as `$FF` |

Source address low nibble forced to 0; dest limited to VRAM (`0x8000–0x9FF0` encoding). Destination overflow ends the transfer early.

PPU calls `bus.tickHdma()` from `setMode()` when mode becomes HBlank (not at end-of-line).

### 7.3 OAM DMA

Write to `FF46` copies 160 bytes from `page<<8` into OAM **immediately**.  
**Limitation:** No cycle cost / bus lock during transfer (see [§13](#13-accuracy-notes-and-known-limitations)).

---

## 8. Class / module reference

### 8.1 `GameBoy` — `src/gameboy.ts`

**Role:** Public facade, subsystem wiring, rAF run loop, save debounce, timing split, host attach APIs.

| Member | Notes |
|--------|-------|
| `bus`, `cpu`, `ppu`, `timer`, `joypad`, `apu`, `screen` | Readonly owned instances |
| `attachScreen(canvas, opts?)` | Bind canvas; **auto-paint** each frame; scale modes |
| `setScale` / `setScaleMode` / `toggleFullscreen` | Display sizing |
| `enableSound` / `mute` / `unMute` / `setVolume` | Sound (also via `apu`) |
| `loadRom(rom)`, `reload()`, `quit()`, `reset()`, `run()`, `pause()`, `step()` | Lifecycle |
| `hasRom()` | Whether a ROM is loaded |
| `onFrameFinished(cb)` | Optional; FPS overlays (paint already done if screen attached) |
| `setUseBootRom` / `setBootRom` | Boot ROM policy |
| `getSave` / `loadSave` / `onSaveRamUpdated` / `hasBatterySave` | Battery `.sav` |
| `createState` / `loadState` | Full savestate |

**`quit()`:** pause, blank screen, unload ROM (`romBytes` + cartridge), reset joypad pressed state, mute/clear audio. Input attachments remain.

**Private timing:** `lcdPhase`, `advancePeripherals`.  
**Private saves:** `scheduleSaveFlush` (250 ms debounce) → `queueMicrotask` notify; `flushSaveSync` on pause.

### 8.1b `Screen` — `src/display/screen.ts`

CSS/layout scaler over a fixed 160×144 canvas buffer. Modes: `integer`, `fit`, `stretch`, `fullscreen`. `present(ImageData)` / `clear()`.

### 8.2 `Bus` — `src/bus/bus.ts`

**Role:** Address decode, IO, banking, DMA/HDMA, IF, boot overlay, CGB palettes.

| Field | Meaning |
|-------|---------|
| `vram[0\|1]` | 8 KiB × 2 |
| `wram[0…7]` | 4 KiB × 8 |
| `oam`, `hram`, `io`, `ie` | Sprite RAM, high RAM, IO mirror, IE |
| `vramBank`, `wramBank` | Current banks |
| `cgbMode`, `doubleSpeed`, `key1` | Mode flags |
| `bgPalette`, `objPalette` | 64-byte CGB palette RAM each |
| `hdmaSrc`, `hdmaDst`, `hdmaLength`, `hdmaActive` | VRAM DMA state |
| `bootRom`, `bootRomEnabled` | Boot overlay |
| `onSramWrite` | Hook → GameBoy save debounce |
| `cartridge` | Active MBC |

**Key methods:** `read` / `write`, `reset`, `setBootRom`, `loadCartridge`, `tickHdma`, `requestInterrupt`, `exportState` / `importState`.

When `WY` (`FF4A`) is written, Bus notifies `ppu.onWyWrite()` so the window line counter resets (hardware behavior needed for dialogue boxes).

---

### 8.3 `CPU` — `src/cpu/cpu.ts`

**Role:** `step()`, interrupt service, HALT/STOP/speed switch; ALU / helper methods used by opcode modules.

Opcode bodies live in:

- `src/cpu/opcodes/opcodes.ts` — main SM83 (`executeOpcode`)
- `src/cpu/opcodes/cbOpcodes.ts` — CB prefix (`executeCb`)

| State | Meaning |
|-------|---------|
| `registers` | `Registers` instance |
| `ime` | Interrupt master enable |
| `imeScheduled` | EI delay (takes effect after next instruction) |
| `halted` / `stopped` | Low-power / STOP |
| `haltBug` | HALT bug when IRQ pending with IME=0 |

**`step()` return value:** T-cycles consumed (including interrupt entry = 20).

**Interrupt priority** (low bit first among pending&enabled): VBlank → STAT → Timer → Serial → Joypad.

**STOP + speed switch:** See [§6.3](#63-speed-switch-path).

Related files:

- `src/cpu/registers.ts` — AF/BC/DE/HL/SP/PC, ZNHC flags, boot vs skip-boot defaults
- `src/cpu/disassembler.ts` — sparse debug helper (not on hot path)

---

### 8.4 `Registers` — `src/cpu/registers.ts`

8-bit regs + 16-bit pair accessors. `f` only stores high nibble (ZNHC).  
`reset(cgb, useBootRom)`:

- Boot path: PC=`0`, SP=`0xFFFE`, others 0
- Skip boot: `BOOT_REGS` (DMG) or `BOOT_REGS_CGB` from `constants/cpu.constants.ts`

---

### 8.5 `Ppu` — `src/ppu/ppu.ts`

**Role:** Dot-based scanline PPU; DMG greyscale + CGB color; sprites; window; STAT/VBlank IRQs; HDMA trigger.

| Property | Notes |
|----------|-------|
| `width` / `height` | 160 / 144 |
| `frameBuffer` | `ImageData` (or shim in Node tests) |
| `ly`, `mode` | Current line / PPU mode |
| `tick(cycles)` | Advances dots; returns `true` when a frame completes |
| `writeLcdc` / `writeStat` / `readStat` | LCD control |
| `onWyWrite()` | Reset internal window line counter |

**Mode timing (fixed split, LY < 144):**

| Mode | Dot range | Value |
|------|-----------|-------|
| OAM search | 0–79 | 2 |
| Pixel transfer | 80–251 | 3 |
| HBlank | 252–455 | 0 |
| VBlank | LY ≥ 144 | 1 |

**Rendering pipeline per visible line** (`renderScanline`):

1. Clear `bgLineColors` (per-pixel BG color + priority bits)
2. If `cgbMode`: `renderBgCgb` (+ window) then `renderSpritesCgb`
3. Else: BG → Window → Sprites (DMG), gated by LCDC bits

**Window internals (`windowLine`):**

- Indexes window tile rows (not the same as `WY`)
- Increments **only** when ≥1 window pixel was drawn that line
- Resets when: LY wraps to 0, LCD disabled, or WY written
- Visible when: window enable, `LY ≥ WY`, `WX ≤ 166`; screen X starts at `WX − 7`

**CGB sprites:**

- Max 10 per line; priority by **OAM index** (lower wins)
- `claimed` pixel mask — first non-transparent sprite pixel owns the column
- LCDC.0 = 0 → sprites always win over BG (CGB master priority)
- 8×16: select tile half from unflipped Y, then Y-flip within the 8-px tile

BG/window/sprite rendering is inlined in `ppu.ts`.

---

### 8.6 `Apu` — `src/apu/apu.ts`

**Role:** Four channels (2 pulse, wave, noise) with phase oscillators sampled at **44 100 Hz**.

| API | Notes |
|-----|-------|
| `enableSound()` | Creates `AudioContext` + `ScriptProcessorNode` (idempotent; call after user gesture) |
| `mute` / `unMute` / `setVolume` | Host controls |
| `tick(cycles)` | Advance with **LCD-rate** cycles (half in double-speed) |
| `read` / `write` | NR10–NR52 + wave RAM |
| `clearAudioBuffer()` | Called on savestate load to avoid glitches |

Mixing uses NR50/NR51. Ring buffer drops oldest samples if the audio callback falls behind.

Channel state lives inside `Apu` (`src/apu/apu.ts`).

---

### 8.7 `Timer` — `src/timer/timer.ts`

**Role:** DIV / TIMA / TMA / TAC.

- Ticked with **CPU** cycles (full rate in double-speed)
- DIV increments every 256 T-cycles; writing DIV resets it to 0
- TIMA frequencies from TAC: 1024 / 16 / 64 / 256 T-cycles
- TIMA overflow → reload TMA + request TIMER interrupt

**Limitation:** Does not model every DIV falling-edge quirk for TIMA.

---

### 8.8 `Joypad` — `src/input/joypad.ts`

**Role:** `P1` (`FF00`) + keyboard / virtual pad / gamepad.

| API | Notes |
|-----|-------|
| `attachKeyboard` / `detachKeyboard` | Capture-phase listeners on window (or element) |
| `attachVirtualPad(root)` | Bind `[data-btn]` via `virtualPad.ts` (pointer capture) |
| `attachGamepad` / `detachGamepad` | Gamepad API detect + rAF poll (`gamepad.ts`) |
| `onGamepadConnected` / `onGamepadDisconnected` | Optional UI hooks |
| `setKeyMapping` / `setGamepadMap` | Remap inputs |
| `triggerButton(button, pressed)` | Manual / digital pad |
| `readP1` / `writeP1` | Bus IO |

**Defaults:** Arrows = D-pad, Z=A, X=B, Enter=Start, Shift=Select (`constants/joypad.constants.ts`).

**IRQ rule:** Fire JOYPAD interrupt only when a **currently selected** low-nibble bit goes from released→pressed (high→low on the P1 nibble). Ignores duplicate downs and key-repeat.

---

### 8.9 Cartridge layer — `src/cartridge/cartridge.ts`

**Exports:** `Cartridge`, `CartridgeInfo`, `RtcState`, `parseHeader`, `createCartridge`.

**`createCartridge` type map:**

| Header `0x147` | Backend |
|----------------|---------|
| `0x00`, `0x08`, `0x09` | MBC0 (ROM only / RAM) |
| `0x01`–`0x03` | MBC1 |
| `0x0F`–`0x13` | MBC3 (+ RTC for `0x0F`/`0x10`) |
| `0x19`–`0x1E` | MBC5 |
| other | Heuristic fallback |

**RTC:** Advances from wall-clock (`Date.now()` / `lastUnixMs`). Latch protocol 0→1. Halt bit in `dh`.

SRAM (and RTC) writes invoke `onSramWrite` → GameBoy save debounce.

---

### 8.10 Battery save format — `src/cartridge/saveData.ts`

Magic ASCII **`GBCSV`**, version `1`.

```
[0..4]   "GBCSV"
[5]      version = 1
[6..9]   sram length (u32 LE)
[10..)   sram bytes
[+0]     rtcPresent (0|1)
[+1..5]  s,m,h,dl,dh
[+8..15] lastUnixMs (f64 LE)   // only if rtcPresent
```

Use `serializeSave` / `deserializeSave`. This is the blob returned by `GameBoy.getSave()`.

---

### 8.11 Savestate format — `src/state/savestate.ts`

Magic ASCII **`GBCST`**, version `1`.

```
[0..4] "GBCST"
[5]    version = 1
then length-prefixed chunks (u32 LE length + bytes), in order:
  1. CPU
  2. Bus
  3. PPU
  4. Timer
  5. Joypad
  6. Apu
  7. Cartridge (may be empty)
```

**ROM must already be loaded** before `loadState`.  
**Not snapshotted:** `GameBoy.lcdPhase`, CPU `haltBug`, full APU oscillator phases (APU restore is shallow).

---

### 8.12 Boot — `src/boot/`

| File | Contents |
|------|----------|
| `dmg_boot.bin` / `dmg_boot.ts` | SameBoy DMG boot (256 bytes) as `Uint8Array` |
| `cgb_boot.bin` / `cgb_boot.ts` | SameBoy CGB boot (2304 bytes) |
| `index.ts` | `selectBootRom(cgb)`, re-exports |

Licensed Expat/MIT — safe to redistribute. Official Nintendo dumps are **not**.

---

### 8.13 Types — `src/types/index.ts`

Convenience re-exports (`Button`, cartridge types) and an `ExportableState` interface used conceptually by subsystems that implement `exportState` / `importState`.

---

## 9. Constants

| File | Contents |
|------|----------|
| `constants/memory.constants.ts` | Screen/timing, memory bounds, full `IO` map, `INT` bits + vectors, `BOOT_ROM_DISABLE` |
| `constants/cpu.constants.ts` | `FLAG_Z/N/H/C`, post-boot register presets |
| `constants/ppu.constants.ts` | `LCDC`, `STAT`, `PPU_MODE`, `DMG_COLORS` |
| `constants/joypad.constants.ts` | `Button` enum, default keyboard map |
| `constants/interrupt.constants.ts` | Re-exports interrupt constants |

When adding a new IO register, update **`IO` in `memory.constants.ts`** and the Bus `readIo` / `writeIo` switches together.

---

## 10. Cartridge, battery saves, savestates

### Two different persistence mechanisms

| Kind | Format | API | Use case |
|------|--------|-----|----------|
| Battery save | `GBCSV` | `getSave` / `loadSave` / `onSaveRamUpdated` | In-game SAVE (Pokémon) |
| Savestate | `GBCST` | `createState` / `loadState` | Instant mid-run resume |

### Save debounce (why audio used to glitch)

Pokémon writes SRAM frequently. The emulator:

1. Sets dirty on SRAM write
2. Waits **250 ms** of quiet
3. Serializes and notifies via `queueMicrotask`

Hosts must **not** `JSON.stringify([...32KB])` on the audio thread. The demo uses base64 + `requestIdleCallback`.

`pause()` always flushes pending saves synchronously.

---

## 11. Boot ROM

Default: SameBoy open-source boots selected by CGB cart flag.

```
Boot enabled?
  DMG: overlay 0000–00FF
  CGB: overlay 0000–00FF and 0200–08FF
  0100–01FF always from cartridge (Nintendo logo / header)
Write FF50 ≠ 0 → unmap boot permanently until reset
```

Skip boot (`useBootRom: false`) for unit tests — CPU starts at `0x0100` with post-boot registers.

---

## 12. Demo app wiring

Files: `index.html`, `styles.css`, `src/example.ts` (Vite only).

Typical sequence (package owns paint/input):

1. `new GameBoy({ useBootRom: true })`
2. `attachScreen(canvas, { scale: 3, mode: "integer", container })`
3. `joypad.attachKeyboard()` + `attachVirtualPad(#pad)` + `attachGamepad()`
4. Optional `onFrameFinished` for FPS text only
5. On ROM file: `loadRom` → restore save → `enableSound` → `run`
6. `reload` / `quit` / scale mode controls
7. Save slots / `.sav` / `.state` stay demo-local

LocalStorage key: `gbc-sav:${romName}` (base64; legacy JSON array still accepted).

---

## 13. Accuracy notes and known limitations

### Implemented well enough for Crystal-class games

- SM83 CPU + interrupts + HALT bug path
- CGB double-speed with correct LCD/APU rate split
- HDMA (GP + HBlank) with abort/read semantics
- CGB BG attributes, palettes, VRAM/WRAM banking
- Window line counter + WY reset
- MBC1 / MBC3+RTC / MBC5 + battery saves
- Basic APU with correct pitch at 44.1 kHz

### Known limitations (when hunting bugs)

| Area | Current behavior | Impact |
|------|------------------|--------|
| OAM DMA | Instant copy, no bus lock | Rare mid-frame sprite glitches |
| Mode 3 length | Fixed 172 dots | Some mid-scanline effects |
| Timer | No full DIV-edge TIMA quirks | Mooneye timer tests may fail |
| Serial / IR | Stubbed / unused | Link cable / IR games |
| VRAM/OAM locking | Not enforced by mode | Games that rely on open-bus garbage |
| APU savestate | Shallow (regs, not phases) | Brief audio discontinuity after load |
| `lcdPhase` / `haltBug` | Not in savestate | Extremely edge-case desync after load |
| Audio node | `ScriptProcessorNode` | Deprecated; fine for demo, consider AudioWorklet later |
| MBC2 / MMM01 / HuC | Not implemented | Those carts won't run |

---

## 14. Debugging playbook

### Visual corruption (tiles / `"`` / `^` / battle UI)

1. Confirm `gb.bus.doubleSpeed === true` in Crystal after boot.
2. Confirm HDMA: watch `gb.bus.hdmaActive`, `hdmaLength`, HDMA5 reads (`bus.read(0xff55)`).
3. Confirm window: if dialogue flashes garbage at the top, check WY writes reset window line; ensure `WX ≤ 166` gating.
4. Compare VRAM banks: map tiles in bank 0, attributes in bank 1; sprites may use either via OAM bit 3.

### Audio pitch wrong / stuttering

1. Pitch low → APU likely getting CPU-rate cycles in double-speed (should be LCD-rate).
2. Stutter on save → host persisting saves synchronously; use idle/async path.
3. Call `enableSound()` only after a user gesture.

### Double inputs

1. Digital pad: ensure `triggerButton` ignores duplicate state; use pointer capture.
2. Keyboard: ignore `event.repeat`.
3. JOYPAD IRQ only on visible nibble high→low.

### Game hangs / softlocks

1. Step with `gb.step()` and log `cpu.registers.pc`, `ime`, `bus.getIf()`, `bus.ie`.
2. Check `cpu.halted` / `stopped`.
3. Check LCD off + waiting for LY/STAT that never advances (LCD enable bit).

### Useful inspection points

```ts
gb.cpu.registers.pc
gb.cpu.ime
gb.bus.doubleSpeed
gb.bus.hdmaActive
gb.ppu.ly
gb.ppu.mode          // 0 HBlank, 1 VBlank, 2 OAM, 3 Transfer
gb.bus.read(0xff40)  // LCDC
gb.bus.read(0xff55)  // HDMA5
gb.bus.vram[0]       // tile data / maps
gb.bus.vram[1]       // CGB attributes
```

### Minimal CPU harness

```ts
const gb = new GameBoy({ useBootRom: false });
gb.loadRom(rom);
for (let i = 0; i < 1_000_000; i++) gb.step();
```

---

## 15. Extending the emulator

### Add an IO register

1. Add address to `IO` in `constants/memory.constants.ts`
2. Handle in `Bus` read/write switches
3. Export/import in the owning subsystem’s state blob if needed
4. Add a Jest test

### Add an MBC

1. Implement `Cartridge` in `cartridge.ts`
2. Extend `createCartridge` type switch
3. Cover banking + SRAM in `tests/cartridge/`

### Improve PPU accuracy

Prefer changing `ppu.ts` mode machine and renderer together. Keep HDMA trigger on **HBlank entry**. Preserve `windowLine` semantics when touching window code.

### Improve APU

Keep `tick` driven by **LCD-rate** cycles from `GameBoy.advancePeripherals`. If you migrate to AudioWorklet, preserve the ring-buffer contract and `clearAudioBuffer` on state load.

### Versioned binary formats

Bump `VERSION` in `saveData.ts` / `savestate.ts` and keep backward readers when changing layouts.

---

## 16. Changelog of hard-won fixes

Documenting these prevents regressions when editing timing or graphics code.

| Symptom | Root cause | Fix location |
|---------|------------|--------------|
| Audio pitched too low | Samples generated at ~CPU rate, played at 44.1 kHz | `apu.ts` phase oscillators @ 44100; `CYCLES_PER_SAMPLE = CPU_HZ/44100` |
| Audio glitches on save | Sync `JSON.stringify` of 32 KB on hot path | Debounced `onSaveRamUpdated` + async demo persist |
| Double button presses | Key repeat + pointer + IRQ on every P1 write | Ignore repeats/duplicates; IRQ only on visible press edge |
| `^` / quote tiles / battle garbage in Crystal | PPU ran 1:1 with CPU in double-speed → HDMA desync | `GameBoy.advancePeripherals` half-rate LCD dots |
| Dialogue / menu tile flash | Window line counter wrong (incremented when not drawing; no WY reset) | `windowVisible`, increment-on-draw, `onWyWrite` |
| Wall should be black, shows `"` | Stale font tiles left in VRAM after failed HDMA | HDMA rewrite + double-speed fix |
| Sprite priority / stray battle pixels | Missing claimed-pixel mask / 8×16 Y-flip order | `renderSpritesCgb` |

---

## Quick mental model

> **CPU and Timer** share one clock.  
> **PPU and APU** share the LCD clock.  
> In double-speed those clocks diverge 2:1 — `advancePeripherals` is the adapter.  
> **Bus** is the spine. **GameBoy** is the conductor.  
> Crystal’s worst graphics bugs are almost always **HDMA × double-speed × window**.

When in doubt, re-read [§6 Timing model](#6-timing-model-critical) and [§7.2 HDMA](#72-hdma--vram-dma-cgb) before changing PPU or run-loop code.
