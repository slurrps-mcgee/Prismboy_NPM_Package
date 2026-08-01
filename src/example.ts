import { GameBoy, type ScaleMode } from "./gameboy";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const wrap = document.getElementById("screen-wrap") as HTMLElement;
const fpsEl = document.getElementById("fps")!;
const padStatus = document.getElementById("gamepad-status")!;
const romInput = document.getElementById("rom") as HTMLInputElement;
const muteBtn = document.getElementById("mute") as HTMLButtonElement;
const volume = document.getElementById("volume") as HTMLInputElement;
const reloadBtn = document.getElementById("reload") as HTMLButtonElement;
const quitBtn = document.getElementById("quit") as HTMLButtonElement;
const scaleMode = document.getElementById("scale-mode") as HTMLSelectElement;
const scaleN = document.getElementById("scale-n") as HTMLInputElement;

const gb = new GameBoy({ useBootRom: true, autoSave: true });

gb.attachScreen(canvas, { scale: 3, mode: "integer", container: wrap });
gb.attachFpsElement(fpsEl);
gb.joypad.attachKeyboard();
gb.joypad.attachVirtualPad(document.getElementById("pad")!);
gb.joypad.attachGamepad();
gb.joypad.onGamepadConnected((pad: Gamepad) => {
  padStatus.textContent = `Gamepad: ${pad.id}`;
});
gb.joypad.onGamepadDisconnected(() => {
  padStatus.textContent = "";
});

romInput.addEventListener("change", () => {
  const file = romInput.files?.[0];
  if (file) void gb.loadRomFromFile(file);
});

reloadBtn.addEventListener("click", () => gb.reload());

quitBtn.addEventListener("click", () => {
  gb.quit();
  romInput.value = "";
});

muteBtn.addEventListener("click", () => {
  muteBtn.textContent = gb.toggleMute() ? "Unmute" : "Mute";
});

volume.addEventListener("input", () => {
  gb.setVolume(Number(volume.value));
});

scaleMode.addEventListener("change", () => {
  gb.setScaleMode(scaleMode.value as ScaleMode);
});

scaleN.addEventListener("change", () => {
  gb.setScale(Number(scaleN.value) || 3);
  if (scaleMode.value === "integer") gb.setScaleMode("integer");
});

document.getElementById("download-sav")!.addEventListener("click", () => {
  if (!gb.downloadSave()) alert("No battery save available for this cartridge.");
});

document.getElementById("upload-sav")!.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file && gb.hasRom()) void gb.loadSaveFromFile(file);
});

document.querySelectorAll<HTMLButtonElement>(".slots button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!gb.hasRom()) return;
    const slot = Number(btn.dataset.slot);
    if (btn.hasAttribute("data-load")) {
      if (!gb.loadStateSlot(slot)) alert(`Slot ${slot} is empty`);
    } else {
      gb.saveStateSlot(slot);
    }
  });
});

document.getElementById("download-state")!.addEventListener("click", () => {
  gb.downloadState();
});

document.getElementById("upload-state")!.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file && gb.hasRom()) void gb.loadStateFromFile(file);
});
