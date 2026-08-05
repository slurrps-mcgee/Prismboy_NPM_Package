/** Browser file / encoding helpers used by GameBoy host APIs. */

// Convert a Uint8Array to a base64 string
export function bytesToBase64(data: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    s += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(s);
}

// Convert a base64 string to a Uint8Array
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Read a file and return the bytes
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

// Download bytes
export function downloadBytes(filename: string, data: Uint8Array): void {
  const blob = new Blob(
    [data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer],
    { type: "application/octet-stream" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Get the ROM ID from the filename
export function romIdFromFilename(name: string): string {
  return name.replace(/\.(gb|gbc|bin)$/i, "") || "rom";
}

// Persist a base64 string to local storage
export function persistLocalBase64(key: string, data: Uint8Array): void {
  const b64 = bytesToBase64(data);
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => localStorage.setItem(key, b64));
  } else {
    setTimeout(() => localStorage.setItem(key, b64), 0);
  }
}

// Load a base64 string from local storage
export function loadLocalBase64(key: string): Uint8Array | null {
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try {
    if (saved.startsWith("[")) {
      return Uint8Array.from(JSON.parse(saved) as number[]);
    }
    return base64ToBytes(saved);
  } catch {
    return null;
  }
}
