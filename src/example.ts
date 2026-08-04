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

// initialize the gameboy
gb.attachScreen(canvas, { scale: 3, mode: "integer", container: wrap }); // attach the screen to the canvas
gb.attachFpsElement(fpsEl); // attach the fps element to the document
gb.joypad.attachKeyboard(); // attach the keyboard to the gameboy
gb.joypad.attachVirtualPad(document.getElementById("pad")!); // attach the virtual pad to the document
gb.joypad.attachGamepad(); // attach the gamepad to the gameboy
gb.joypad.onGamepadConnected((pad: Gamepad) => { // on gamepad connected
  padStatus.textContent = `Gamepad: ${pad.id}`;
});
gb.joypad.onGamepadDisconnected(() => {
  padStatus.textContent = "";
});

// load the rom
romInput.addEventListener("change", () => {
  const file = romInput.files?.[0];
  if (file) void gb.loadRomFromFile(file);
});

// reload the game
reloadBtn.addEventListener("click", () => gb.reload());

// quit the game
quitBtn.addEventListener("click", () => {
  gb.quit();
  romInput.value = "";
});

// mute the game
muteBtn.addEventListener("click", () => {
  muteBtn.textContent = gb.toggleMute() ? "Unmute" : "Mute";
});

// set the volume
volume.addEventListener("input", () => {
  gb.setVolume(Number(volume.value));
});

// set the scale mode
scaleMode.addEventListener("change", () => {
  gb.setScaleMode(scaleMode.value as ScaleMode);
});

// set the scale
scaleN.addEventListener("change", () => {
  gb.setScale(Number(scaleN.value) || 3);
  if (scaleMode.value === "integer") gb.setScaleMode("integer");
});

// download the save
document.getElementById("download-sav")!.addEventListener("click", () => {
  if (!gb.downloadSave()) alert("No battery save available for this cartridge.");
});

// upload the save
document.getElementById("upload-sav")!.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file && gb.hasRom()) void gb.loadSaveFromFile(file);
});

// save the state
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

// download the state
document.getElementById("download-state")!.addEventListener("click", () => {
  gb.downloadState();
});

// upload the state
document.getElementById("upload-state")!.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file && gb.hasRom()) void gb.loadStateFromFile(file);
});
