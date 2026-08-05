import { GameBoy, Button, type ScaleMode, type DmgPalette } from "./gameboy";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("screen");
const wrap = $("screen-wrap");
const padRoot = $("pad");
const fpsEl = $("fps");
const padStatus = $("gamepad-status");
const statusEl = $("status");
const debugEl = $("debug");
const eventLogEl = $("event-log");
const logFramesEl = $<HTMLInputElement>("log-frames");

const PALETTES: Record<string, DmgPalette | null> = {
  default: null,
  gray: [
    [255, 255, 255, 255],
    [170, 170, 170, 255],
    [85, 85, 85, 255],
    [0, 0, 0, 255],
  ],
  amber: [
    [255, 236, 180, 255],
    [220, 160, 60, 255],
    [140, 80, 20, 255],
    [40, 20, 0, 255],
  ],
  blue: [
    [200, 230, 255, 255],
    [100, 160, 220, 255],
    [40, 80, 160, 255],
    [8, 16, 48, 255],
  ],
};

let logFrames = false;

function createEmulator(): GameBoy {
  const emu = new GameBoy({ useBootRom: true, autoSave: true });
  wireEmulator(emu);
  return emu;
}

function wireEmulator(emu: GameBoy): void {
  emu.attachScreen(canvas, { scale: 3, mode: "integer", container: wrap });
  emu.attachFpsElement(fpsEl);
  emu.attachKeyboard();
  // Virtual pad is attached when the overlay toggle is enabled.
  emu.attachGamepad();
  emu.setVolume(Number($<HTMLInputElement>("volume").value));

  emu.onGamepadConnected((pad) => {
    padStatus.textContent = `Gamepad: ${pad.id}`;
    logEvent(`gamepad ready: ${pad.id} (mapping=${pad.mapping || "none"})`);
  });
  emu.onGamepadDisconnected(() => {
    const active = emu.getActiveGamepad();
    padStatus.textContent = active ? `Gamepad: ${active.id}` : "";
  });

  // Event bus — every public event type
  emu.on("romloaded", (title) => {
    logEvent(`romloaded: "${title}"`);
    refreshStatus();
  });
  emu.on("reset", () => logEvent("reset"));
  emu.on("pause", () => {
    logEvent("pause");
    refreshStatus();
  });
  emu.on("resume", () => {
    logEvent("resume");
    refreshStatus();
  });
  emu.on("save", (data) => logEvent(`save: ${data.length} bytes`));
  emu.on("breakpoint", (addr) => {
    logEvent(`breakpoint @ $${addr.toString(16).padStart(4, "0")}`);
    dumpDebug("Breakpoint hit");
  });
  emu.on("error", (err) => logEvent(`error: ${err.message}`));
  emu.on("gamepadconnected", (pad) => logEvent(`gamepadconnected: ${pad.id}`));
  emu.on("gamepaddisconnected", (pad) => logEvent(`gamepaddisconnected: ${pad.id}`));

  // Legacy convenience wrapper (also demonstrates onFrameFinished)
  emu.onFrameFinished((_frame, fps) => {
    if (logFrames) logEvent(`frame (fps≈${fps})`);
    updateButtonState();
  });

  $("pkg-sub").textContent =
    `${emu.getSystemName()} API demo · v${emu.getVersion()} · ${emu.getWidth()}×${emu.getHeight()}`;
}

let gb = createEmulator();


function logEvent(msg: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  eventLogEl.textContent = `${line}\n${eventLogEl.textContent ?? ""}`.slice(0, 4000);
}

function refreshStatus(): void {
  const info = gb.getRomInfo();
  statusEl.textContent = [
    `isLoaded / hasRom: ${gb.isLoaded()} / ${gb.hasRom()}`,
    `isRunning / isPaused: ${gb.isRunning()} / ${gb.isPaused()}`,
    `getTitle: ${gb.getTitle() ?? "(none)"}`,
    `getSystemName / isColorGame: ${gb.getSystemName()} / ${gb.isColorGame()}`,
    `getCartridgeType: ${gb.getCartridgeType() ?? "—"}`,
    `getRomId: ${gb.getRomId()}`,
    `getFps / getFrameCount / getCycles: ${gb.getFps()} / ${gb.getFrameCount()} / ${gb.getCycles()}`,
    `getSpeed / isTurboEnabled / getEffectiveSpeed: ${gb.getSpeed()} / ${gb.isTurboEnabled()} / ${gb.getEffectiveSpeed()}`,
    `getTurboMultiplier: ${gb.getTurboMultiplier()}`,
    `isMuted / getVolume: ${gb.isMuted()} / ${gb.getVolume()}`,
    `getScale / getScaleMode: ${gb.getScale()} / ${gb.getScaleMode()}`,
    `isColorCorrectionEnabled: ${gb.isColorCorrectionEnabled()}`,
    `hasBatterySave / isSaveDirty: ${gb.hasBatterySave()} / ${gb.isSaveDirty()}`,
    `getVersion: ${gb.getVersion()}`,
    `getActiveGamepad: ${gb.getActiveGamepad()?.id ?? "(none — press a pad button)"}`,
    `getRomInfo: ${info ? JSON.stringify(info) : "null"}`,
    `getFrameBuffer: ImageData ${gb.getFrameBuffer().width}×${gb.getFrameBuffer().height}`,
    `getPalette[0]: [${gb.getPalette()[0]!.join(", ")}]`,
  ].join("\n");

  $("speed-label").textContent = `${gb.getSpeed()}×`;
  $("effective-speed").textContent = `effective: ${gb.getEffectiveSpeed()}×`;
  $("mute-state").textContent = `isMuted: ${gb.isMuted()}`;
  $("volume-label").textContent = String(gb.getVolume());
  $("scale-state").textContent = `getScale: ${gb.getScale()} · getScaleMode: ${gb.getScaleMode()}`;
  $("fb-info").textContent = `${gb.getWidth()}×${gb.getHeight()} · framebuffer ${gb.getFrameBuffer().data.length} bytes`;
  updateButtonState();
}

function updateButtonState(): void {
  $("btn-state").textContent = `isButtonPressed(A): ${gb.isButtonPressed(Button.A)}`;
}

function dumpDebug(label: string): void {
  const regs = gb.getCpuRegisters();
  const ppu = gb.getPpuState();
  const timer = gb.getTimerState();
  const irq = gb.getInterruptState();
  const lines = gb.disassemble(regs.pc, 6);
  debugEl.textContent = [
    `=== ${label} ===`,
    `PC=${regs.pc.toString(16)} SP=${regs.sp.toString(16)} AF=${regs.af.toString(16)} BC=${regs.bc.toString(16)} DE=${regs.de.toString(16)} HL=${regs.hl.toString(16)}`,
    `flags ZNHC=${+regs.z}${+regs.n}${+regs.hFlag}${+regs.cy} IME=${regs.ime} HALT=${regs.halted} STOP=${regs.stopped}`,
    `PPU LY=${ppu.ly} mode=${ppu.mode} LCDC=${ppu.lcdc.toString(16)} STAT=${ppu.stat.toString(16)} SCX=${ppu.scx} SCY=${ppu.scy}`,
    `Timer DIV=${timer.div} TIMA=${timer.tima} TMA=${timer.tma} TAC=${timer.tac}`,
    `IRQ IE=${irq.ie.toString(16)} IF=${irq.if.toString(16)} imeScheduled=${irq.imeScheduled}`,
    `Breakpoints: [${gb.getBreakpoints().map((a) => "$" + a.toString(16)).join(", ")}]`,
    "Disasm:",
    ...lines.map((l) => `  $${l.address.toString(16).padStart(4, "0")}: ${l.mnemonic}`),
  ].join("\n");
}

function parseHex(input: string, fallback = 0): number {
  const n = parseInt(input.trim().replace(/^\$|^0x/i, ""), 16);
  return Number.isFinite(n) ? n & 0xffff : fallback;
}

function downloadImageData(frame: ImageData, filename: string): void {
  const c = document.createElement("canvas");
  c.width = frame.width;
  c.height = frame.height;
  c.getContext("2d")!.putImageData(frame, 0, 0);
  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function requireRom(): boolean {
  if (gb.isLoaded()) return true;
  alert("Load a ROM first (loadRomFromFile).");
  return false;
}

// ── Overlay controls ──────────────────────────────────────────────────────

const overlayToggle = $<HTMLInputElement>("overlay-toggle");
overlayToggle.onchange = () => {
  const on = overlayToggle.checked;
  padRoot.hidden = !on;
  if (on) {
    gb.attachVirtualPad(padRoot);
    logEvent("overlay controls ON — attachVirtualPad()");
  } else {
    gb.detachVirtualPad();
    logEvent("overlay controls OFF — detachVirtualPad()");
  }
};

// ── Status ────────────────────────────────────────────────────────────────

$("refresh-status").onclick = () => refreshStatus();
$("log-info").onclick = () => {
  console.log("getRomInfo()", gb.getRomInfo());
  console.log("getVersion()", gb.getVersion());
  console.log("getTitle()", gb.getTitle());
  console.log("getSystemName()", gb.getSystemName());
  logEvent("Logged getRomInfo / getVersion to console");
};

// ── ROM / lifecycle ───────────────────────────────────────────────────────

$<HTMLInputElement>("rom").onchange = () => {
  const file = $<HTMLInputElement>("rom").files?.[0];
  if (!file) return;
  void (async () => {
    try {
      await gb.loadRomFromFile(file);
      if (!gb.isRunning()) gb.start();
      refreshStatus();
      logEvent(`loadRomFromFile("${file.name}") → running=${gb.isRunning()}`);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      logEvent(`loadRomFromFile failed: ${msg}`);
      alert(`Failed to load ROM: ${msg}`);
    }
  })();
};

$("reload").onclick = () => {
  if (!requireRom()) return;
  gb.reload();
  refreshStatus();
};

$("reset").onclick = () => {
  if (!requireRom()) return;
  gb.reset();
  refreshStatus();
};

$("unload").onclick = () => {
  gb.unloadRom();
  $<HTMLInputElement>("rom").value = "";
  refreshStatus();
};

$("quit").onclick = () => {
  gb.quit();
  $<HTMLInputElement>("rom").value = "";
  refreshStatus();
};

$("start").onclick = () => {
  if (!requireRom()) return;
  gb.start();
  refreshStatus();
};

$("pause").onclick = () => {
  gb.pause();
  refreshStatus();
};

$("resume").onclick = () => {
  if (!requireRom()) return;
  gb.resume();
  refreshStatus();
};

$("stop").onclick = () => {
  gb.stop();
  refreshStatus();
};

$("destroy").onclick = () => {
  gb.destroy();
  logEvent("destroy() — recreating GameBoy");
  gb = createEmulator();
  $<HTMLInputElement>("rom").value = "";
  refreshStatus();
};

$<HTMLInputElement>("use-boot").onchange = () => {
  gb.setUseBootRom($<HTMLInputElement>("use-boot").checked);
  logEvent(`setUseBootRom(${$<HTMLInputElement>("use-boot").checked})`);
};

$<HTMLInputElement>("boot-rom").onchange = async () => {
  const file = $<HTMLInputElement>("boot-rom").files?.[0];
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  gb.setBootRom(buf);
  logEvent(`setBootRom(${buf.length} bytes)`);
};

$("clear-boot").onclick = () => {
  gb.setBootRom(null);
  $<HTMLInputElement>("boot-rom").value = "";
  logEvent("setBootRom(null)");
};

$("apply-rom-id").onclick = () => {
  gb.setRomId($<HTMLInputElement>("rom-id").value);
  logEvent(`setRomId("${gb.getRomId()}")`);
  refreshStatus();
};

// ── Speed ─────────────────────────────────────────────────────────────────

const speedEl = $<HTMLInputElement>("speed");
speedEl.oninput = () => {
  gb.setSpeed(Number(speedEl.value));
  refreshStatus();
};

$<HTMLInputElement>("turbo-mult").onchange = () => {
  gb.setTurboMultiplier(Number($<HTMLInputElement>("turbo-mult").value));
  refreshStatus();
};

const turboBtn = $("turbo");
turboBtn.onclick = () => {
  turboBtn.textContent = gb.toggleTurbo() ? "toggleTurbo() ON" : "toggleTurbo()";
  refreshStatus();
};

window.addEventListener("keydown", (e) => {
  if (e.code === "Tab" && !e.repeat) {
    e.preventDefault();
    gb.setTurboEnabled(true);
    turboBtn.textContent = "toggleTurbo() ON";
    refreshStatus();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Tab") {
    gb.setTurboEnabled(false);
    turboBtn.textContent = "toggleTurbo()";
    refreshStatus();
  }
});

// ── Audio ─────────────────────────────────────────────────────────────────

$("enable-sound").onclick = () => {
  gb.enableSound();
  logEvent("enableSound()");
};

$("mute").onclick = () => {
  gb.mute();
  refreshStatus();
};

$("unmute").onclick = () => {
  gb.unMute();
  refreshStatus();
};

$("toggle-mute").onclick = () => {
  logEvent(`toggleMute() → ${gb.toggleMute()}`);
  refreshStatus();
};

const volumeEl = $<HTMLInputElement>("volume");
volumeEl.oninput = () => {
  gb.setVolume(Number(volumeEl.value));
  refreshStatus();
};

// ── Video ─────────────────────────────────────────────────────────────────

$("detach-screen").onclick = () => {
  gb.detachScreen();
  logEvent("detachScreen()");
};

$("attach-screen").onclick = () => {
  gb.attachScreen(canvas, {
    scale: Number($<HTMLInputElement>("scale-n").value) || 3,
    mode: $<HTMLSelectElement>("scale-mode").value as ScaleMode,
    container: wrap,
  });
  gb.attachFpsElement(fpsEl);
  logEvent("attachScreen() + attachFpsElement()");
  refreshStatus();
};

$("clear-screen").onclick = () => {
  gb.clearScreen();
  logEvent("clearScreen()");
};

$("fullscreen").onclick = () => {
  void gb.toggleFullscreen();
};

$("screenshot").onclick = () => {
  const shot = gb.takeScreenshot();
  downloadImageData(shot, `${gb.getRomId() || "prismboy"}-screenshot.png`);
  logEvent(`takeScreenshot() ${shot.width}×${shot.height}`);
};

$<HTMLSelectElement>("scale-mode").onchange = () => {
  gb.setScaleMode($<HTMLSelectElement>("scale-mode").value as ScaleMode);
  refreshStatus();
};

$<HTMLInputElement>("scale-n").onchange = () => {
  gb.setScale(Number($<HTMLInputElement>("scale-n").value) || 3);
  if ($<HTMLSelectElement>("scale-mode").value === "integer") gb.setScaleMode("integer");
  refreshStatus();
};

$<HTMLSelectElement>("palette").onchange = () => {
  const key = $<HTMLSelectElement>("palette").value;
  const pal = PALETTES[key];
  if (!pal) gb.resetPalette();
  else gb.setPalette(pal);
  logEvent(pal ? `setPalette(${key})` : "resetPalette()");
  refreshStatus();
};

$<HTMLInputElement>("color-correction").onchange = () => {
  gb.setColorCorrection($<HTMLInputElement>("color-correction").checked);
  logEvent(`setColorCorrection(${gb.isColorCorrectionEnabled()})`);
  refreshStatus();
};

// ── Input ─────────────────────────────────────────────────────────────────

$("attach-kb").onclick = () => {
  gb.attachKeyboard();
  logEvent("attachKeyboard()");
};
$("detach-kb").onclick = () => {
  gb.detachKeyboard();
  logEvent("detachKeyboard()");
};
$("attach-pad").onclick = () => {
  overlayToggle.checked = true;
  padRoot.hidden = false;
  gb.attachVirtualPad(padRoot);
  logEvent("attachVirtualPad()");
};
$("detach-pad").onclick = () => {
  overlayToggle.checked = false;
  padRoot.hidden = true;
  gb.detachVirtualPad();
  logEvent("detachVirtualPad()");
};
$("attach-gp").onclick = () => {
  gb.attachGamepad();
  logEvent("attachGamepad()");
};
$("detach-gp").onclick = () => {
  gb.detachGamepad();
  logEvent("detachGamepad()");
};

$("press-a").onmousedown = () => {
  gb.pressButton(Button.A);
  updateButtonState();
};
$("press-a").onmouseup = () => {
  gb.releaseButton(Button.A);
  updateButtonState();
};
$("press-a").onmouseleave = () => {
  if (gb.isButtonPressed(Button.A)) gb.releaseButton(Button.A);
  updateButtonState();
};
$("release-a").onclick = () => {
  gb.releaseButton(Button.A);
  updateButtonState();
};
$("release-all").onclick = () => {
  gb.releaseAllButtons();
  updateButtonState();
  logEvent("releaseAllButtons()");
};

$("remap-keys").onclick = () => {
  gb.setKeyMapping("KeyQ", Button.A);
  logEvent('setKeyMapping("KeyQ", Button.A)');
};

$("remap-gp").onclick = () => {
  gb.setGamepadMap({ buttons: { 0: Button.B, 1: Button.A, 8: Button.Select, 9: Button.Start } });
  logEvent("setGamepadMap({ buttons: { 0:B, 1:A, 8:Select, 9:Start } })");
};

setInterval(updateButtonState, 200);

// ── Saves ─────────────────────────────────────────────────────────────────

$("enable-autosave").onclick = () => {
  gb.enableAutoSave();
  logEvent("enableAutoSave()");
};
$("disable-autosave").onclick = () => {
  gb.disableAutoSave();
  logEvent("disableAutoSave()");
};
$("load-autosave").onclick = () => {
  const ok = gb.loadAutoSave();
  logEvent(`loadAutoSave() → ${ok}`);
};

$("get-save").onclick = () => {
  const data = gb.getSave();
  if (!data) {
    alert("getSave() returned null (no battery cart / SRAM)");
    return;
  }
  const blob = new Blob([data.slice()], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${gb.getRomId()}.sav`;
  a.click();
  URL.revokeObjectURL(a.href);
  logEvent(`getSave() → ${data.length} bytes`);
};

$("download-sav").onclick = () => {
  if (!gb.downloadSave()) alert("downloadSave() failed — no battery save");
  else logEvent("downloadSave()");
};

$<HTMLInputElement>("upload-sav").onchange = () => {
  const file = $<HTMLInputElement>("upload-sav").files?.[0];
  if (file && gb.hasRom()) {
    void gb.loadSaveFromFile(file).then(() => {
      logEvent("loadSaveFromFile()");
      refreshStatus();
    });
  }
};

$("set-rtc").onclick = () => {
  gb.setRtc(new Date());
  logEvent("setRtc(new Date())");
};

$("save-dirty").onclick = () => {
  const msg = `hasBatterySave=${gb.hasBatterySave()} isSaveDirty=${gb.isSaveDirty()}`;
  $("save-state").textContent = msg;
  logEvent(msg);
};

$("custom-save-hook").onclick = () => {
  gb.onSaveRamUpdated((data) => {
    console.log("onSaveRamUpdated", data.length);
    logEvent(`onSaveRamUpdated(${data.length})`);
  });
  logEvent("onSaveRamUpdated(cb) — disables built-in auto-save callback");
};

// ── Savestates ────────────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>(".slots button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!requireRom()) return;
    const slot = Number(btn.dataset.slot);
    if (btn.hasAttribute("data-load")) {
      const ok = gb.loadStateSlot(slot);
      logEvent(`loadStateSlot(${slot}) → ${ok}`);
      if (!ok) alert(`Slot ${slot} is empty`);
    } else {
      gb.saveStateSlot(slot);
      logEvent(`saveStateSlot(${slot})`);
    }
  });
});

$("create-state").onclick = () => {
  if (!requireRom()) return;
  const state = gb.createState();
  const blob = new Blob([state.slice()], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${gb.getRomId()}.state`;
  a.click();
  URL.revokeObjectURL(a.href);
  logEvent(`createState() → ${state.length} bytes`);
};

$("download-state").onclick = () => {
  if (!requireRom()) return;
  gb.downloadState();
  logEvent("downloadState()");
};

$<HTMLInputElement>("upload-state").onchange = () => {
  const file = $<HTMLInputElement>("upload-state").files?.[0];
  if (file && gb.hasRom()) {
    void gb.loadStateFromFile(file).then(() => logEvent("loadStateFromFile()"));
  }
};

// ── Debug / stepping ──────────────────────────────────────────────────────

$("step-instr").onclick = () => {
  if (!requireRom()) return;
  gb.pause();
  const c = gb.stepInstruction(); // alias of step()
  dumpDebug(`stepInstruction() / step() → ${c} cycles`);
  refreshStatus();
};

$("step-scan").onclick = () => {
  if (!requireRom()) return;
  gb.pause();
  const c = gb.stepScanline();
  dumpDebug(`stepScanline() → ${c} cycles`);
  refreshStatus();
};

$("step-frame").onclick = () => {
  if (!requireRom()) return;
  gb.pause();
  const c = gb.stepFrame();
  dumpDebug(`stepFrame() → ${c} cycles`);
  refreshStatus();
};

$("bp-add").onclick = () => {
  const addr = parseHex($<HTMLInputElement>("bp-addr").value, 0x150);
  gb.setBreakpoint(addr);
  logEvent(`setBreakpoint(0x${addr.toString(16)})`);
  dumpDebug("Breakpoints updated");
};

$("bp-remove").onclick = () => {
  const addr = parseHex($<HTMLInputElement>("bp-addr").value, 0x150);
  gb.removeBreakpoint(addr);
  logEvent(`removeBreakpoint(0x${addr.toString(16)})`);
  dumpDebug("Breakpoints updated");
};

$("bp-clear").onclick = () => {
  gb.clearBreakpoints();
  logEvent("clearBreakpoints()");
  dumpDebug("Breakpoints cleared");
};

$("bp-list").onclick = () => {
  logEvent(`getBreakpoints() → [${gb.getBreakpoints().map((a) => "0x" + a.toString(16)).join(", ")}]`);
  dumpDebug("getBreakpoints()");
};

$("mem-read").onclick = () => {
  const addr = parseHex($<HTMLInputElement>("mem-addr").value);
  const b = gb.readByte(addr);
  const block = gb.readMemory(addr, 16);
  debugEl.textContent = [
    `readByte(0x${addr.toString(16)}) = 0x${b.toString(16).padStart(2, "0")}`,
    `readMemory(0x${addr.toString(16)}, 16) = ${[...block].map((x) => x.toString(16).padStart(2, "0")).join(" ")}`,
  ].join("\n");
};

$("mem-write").onclick = () => {
  const addr = parseHex($<HTMLInputElement>("mem-addr").value);
  const val = parseHex($<HTMLInputElement>("mem-val").value) & 0xff;
  gb.writeByte(addr, val);
  logEvent(`writeByte(0x${addr.toString(16)}, 0x${val.toString(16)})`);
  // Also demo writeMemory
  gb.writeMemory(addr, new Uint8Array([val]));
};

$("disasm").onclick = () => {
  if (!requireRom()) return;
  const pc = gb.getCpuRegisters().pc;
  const lines = gb.disassemble(pc, 8);
  debugEl.textContent = lines
    .map((l) => `$${l.address.toString(16).padStart(4, "0")}: ${l.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}  ${l.mnemonic}`)
    .join("\n");
};

// ── Events log UI ─────────────────────────────────────────────────────────

$("clear-log").onclick = () => {
  eventLogEl.textContent = "";
};

logFramesEl.onchange = () => {
  logFrames = logFramesEl.checked;
};

// Initial paint
refreshStatus();
logEvent(`GameBoy ready · getVersion()=${gb.getVersion()}`);
