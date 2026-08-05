// Save data constants
const MAGIC = new TextEncoder().encode("GBCSV");
const VERSION = 1;

// Serialize the save data
export function serializeSave(sram: Uint8Array, rtc: {
  s: number; m: number; h: number; dl: number; dh: number; lastUnixMs: number;
} | null): Uint8Array {
  const rtcSize = rtc ? 48 : 0;
  const buf = new Uint8Array(5 + 1 + 4 + sram.length + 1 + rtcSize);
  buf.set(MAGIC, 0);
  buf[5] = VERSION;
  new DataView(buf.buffer).setUint32(6, sram.length, true);
  buf.set(sram, 10);
  const rtcOff = 10 + sram.length;
  buf[rtcOff] = rtc ? 1 : 0;
  if (rtc) {
    buf[rtcOff + 1] = rtc.s;
    buf[rtcOff + 2] = rtc.m;
    buf[rtcOff + 3] = rtc.h;
    buf[rtcOff + 4] = rtc.dl;
    buf[rtcOff + 5] = rtc.dh;
    new DataView(buf.buffer).setFloat64(rtcOff + 8, rtc.lastUnixMs, true);
  }
  return buf;
}

// Deserialize the save data
export function deserializeSave(data: Uint8Array): {
  sram: Uint8Array;
  rtc: { s: number; m: number; h: number; dl: number; dh: number; lastUnixMs: number } | null;
} {
  for (let i = 0; i < 5; i++) {
    if (data[i] !== MAGIC[i]) throw new Error("Invalid save file magic");
  }
  if (data[5] !== VERSION) throw new Error(`Unsupported save version ${data[5]}`);
  const sramLen = new DataView(data.buffer, data.byteOffset).getUint32(6, true);
  const sram = data.slice(10, 10 + sramLen);
  const rtcOff = 10 + sramLen;
  let rtc = null;
  if (data[rtcOff] === 1) {
    rtc = {
      s: data[rtcOff + 1]!,
      m: data[rtcOff + 2]!,
      h: data[rtcOff + 3]!,
      dl: data[rtcOff + 4]!,
      dh: data[rtcOff + 5]!,
      lastUnixMs: new DataView(data.buffer, data.byteOffset + rtcOff + 8).getFloat64(0, true),
    };
  }
  return { sram, rtc };
}
