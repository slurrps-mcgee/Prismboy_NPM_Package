import { SCREEN_WIDTH, SCREEN_HEIGHT } from "@/constants/memory.constants";

export type ScaleMode = "integer" | "fit" | "stretch" | "fullscreen";

export interface ScreenOptions {
  /** Integer scale when mode is `integer` (default 3 → 480×432). */
  scale?: number;
  mode?: ScaleMode;
  /** Layout container for fit/stretch (defaults to canvas.parentElement). */
  container?: HTMLElement | null;
}

/**
 * Host display helper: keeps the framebuffer at 160×144 and scales the canvas
 * via CSS / layout (integer, fit, stretch, fullscreen).
 */
export class Screen {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private container: HTMLElement | null = null;
  private scale = 3;
  private mode: ScaleMode = "integer";
  private resizeObserver: ResizeObserver | null = null;
  private onFsChange = (): void => this.applyLayout();

  attach(canvas: HTMLCanvasElement, options: ScreenOptions = {}): void {
    this.detach();
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;

    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    canvas.style.imageRendering = "pixelated";

    this.scale = Math.max(1, Math.floor(options.scale ?? 3));
    this.mode = options.mode ?? "integer";
    this.container = options.container ?? canvas.parentElement;

    if (typeof ResizeObserver !== "undefined" && this.container) {
      this.resizeObserver = new ResizeObserver(() => this.applyLayout());
      this.resizeObserver.observe(this.container);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("fullscreenchange", this.onFsChange);
    }
    this.applyLayout();
  }

  detach(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("fullscreenchange", this.onFsChange);
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;
  }

  setScale(n: number): void {
    this.scale = Math.max(1, Math.floor(n));
    if (this.mode === "integer") this.applyLayout();
  }

  getScale(): number {
    return this.scale;
  }

  setScaleMode(mode: ScaleMode): void {
    this.mode = mode;
    if (mode === "fullscreen") {
      void this.requestFullscreen();
    } else if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen();
    }
    this.applyLayout();
  }

  getScaleMode(): ScaleMode {
    return this.mode;
  }

  async toggleFullscreen(): Promise<void> {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      if (this.mode === "fullscreen") this.mode = "fit";
    } else {
      this.mode = "fullscreen";
      await this.requestFullscreen();
    }
    this.applyLayout();
  }

  /** Paint a 160×144 frame buffer onto the attached canvas. */
  present(frame: ImageData): void {
    this.ctx?.putImageData(frame, 0, 0);
  }

  /** Clear the canvas to black. */
  clear(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private async requestFullscreen(): Promise<void> {
    const el = this.container ?? this.canvas;
    if (!el?.requestFullscreen) return;
    try {
      await el.requestFullscreen();
    } catch {
      /* user gesture / permission */
    }
  }

  private applyLayout(): void {
    if (!this.canvas) return;
    const style = this.canvas.style;
    style.display = "block";
    style.background = "#0a0c08";

    const fs = typeof document !== "undefined" && document.fullscreenElement;
    const mode = fs ? "fit" : this.mode === "fullscreen" ? "fit" : this.mode;

    if (mode === "integer") {
      const w = SCREEN_WIDTH * this.scale;
      const h = SCREEN_HEIGHT * this.scale;
      style.width = `${w}px`;
      style.height = `${h}px`;
      style.maxWidth = "100%";
      style.maxHeight = "";
      style.objectFit = "";
      return;
    }

    const box = this.container ?? this.canvas.parentElement;
    const maxW = box?.clientWidth || window.innerWidth;
    const maxH = box?.clientHeight || window.innerHeight;

    if (mode === "stretch") {
      style.width = "100%";
      style.height = "100%";
      style.maxWidth = "100%";
      style.maxHeight = "100%";
      style.objectFit = "fill";
      return;
    }

    // fit — preserve aspect, prefer integer scale when it fits
    let scale = Math.max(1, Math.floor(Math.min(maxW / SCREEN_WIDTH, maxH / SCREEN_HEIGHT)));
    if (scale < 1) scale = 1;
    // If integer scale doesn't fill well on phones, allow fractional fit
    const iw = SCREEN_WIDTH * scale;
    const ih = SCREEN_HEIGHT * scale;
    if (iw <= maxW && ih <= maxH && (maxW - iw > SCREEN_WIDTH || maxH - ih > SCREEN_HEIGHT)) {
      const frac = Math.min(maxW / SCREEN_WIDTH, maxH / SCREEN_HEIGHT);
      style.width = `${Math.floor(SCREEN_WIDTH * frac)}px`;
      style.height = `${Math.floor(SCREEN_HEIGHT * frac)}px`;
    } else {
      style.width = `${iw}px`;
      style.height = `${ih}px`;
    }
    style.maxWidth = "100%";
    style.maxHeight = "100%";
    style.objectFit = "contain";
  }
}
