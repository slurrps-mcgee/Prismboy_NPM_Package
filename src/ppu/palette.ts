import { DMG_COLORS } from "@/constants/ppu.constants";

/** RGBA tuple for one DMG shade (0=lightest … 3=darkest). */
export type Rgba = [number, number, number, number];

/** Four-shade DMG palette. */
export type DmgPalette = [Rgba, Rgba, Rgba, Rgba];

export function cloneDefaultPalette(): DmgPalette {
  return DMG_COLORS.map((c) => [...c] as Rgba) as DmgPalette;
}

/** Clamp and copy a host-provided 4-shade palette. */
export function normalizePalette(colors: DmgPalette): DmgPalette {
  return colors.map((c) => {
    const r = Math.max(0, Math.min(255, c[0] | 0));
    const g = Math.max(0, Math.min(255, c[1] | 0));
    const b = Math.max(0, Math.min(255, c[2] | 0));
    const a = c[3] === undefined ? 255 : Math.max(0, Math.min(255, c[3] | 0));
    return [r, g, b, a] as Rgba;
  }) as DmgPalette;
}

/**
 * Simple CGB color correction: slight desaturation + gamma toward LCD look.
 * Operates in-place on ImageData pixels.
 */
export function applyColorCorrection(frame: ImageData): void {
  const data = frame.data;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]! / 255;
    let g = data[i + 1]! / 255;
    let b = data[i + 2]! / 255;
    // Approximate GB LCD gamma curve
    r = Math.pow(r, 0.9);
    g = Math.pow(g, 0.9);
    b = Math.pow(b, 0.9);
    // Mild desaturation toward green-tinted greys
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    r = r * 0.85 + luma * 0.15;
    g = g * 0.9 + luma * 0.1;
    b = b * 0.75 + luma * 0.25;
    data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
    data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
    data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
  }
}
