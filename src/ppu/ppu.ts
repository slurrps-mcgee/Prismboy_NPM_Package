import type { Bus } from "@/bus/bus";
import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  DOTS_PER_LINE,
  LINES_PER_FRAME,
  VBLANK_START,
  IO,
  INT,
} from "@/constants/memory.constants";
import { LCDC, STAT, PPU_MODE, DMG_COLORS } from "@/constants/ppu.constants";

export class Ppu {
  readonly width = SCREEN_WIDTH;
  readonly height = SCREEN_HEIGHT;
  frameBuffer: ImageData;

  ly = 0;
  mode: number = PPU_MODE.OAM;
  private dots = 0;
  private lcdc = 0x91;
  private stat = 0x85;
  private scx = 0;
  private scy = 0;
  private wy = 0;
  private wx = 0;
  private lyc = 0;
  private bgp = 0xfc;
  private obp0 = 0xff;
  private obp1 = 0xff;
  private windowLine = 0;
  private frameReady = false;
  private bgLineColors = new Uint8Array(SCREEN_WIDTH);

  constructor(private bus: Bus) {
    // ImageData requires a browser-like env; provide a transferable buffer
    const data = new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
    this.frameBuffer = typeof ImageData !== "undefined"
      ? new ImageData(data, SCREEN_WIDTH, SCREEN_HEIGHT)
      : ({ data, width: SCREEN_WIDTH, height: SCREEN_HEIGHT } as ImageData);
  }

  reset(): void {
    this.ly = 0;
    this.mode = PPU_MODE.OAM;
    this.dots = 0;
    this.lcdc = 0x91;
    this.stat = 0x85;
    this.scx = 0;
    this.scy = 0;
    this.wy = 0;
    this.wx = 0;
    this.lyc = 0;
    this.bgp = 0xfc;
    this.obp0 = 0xff;
    this.obp1 = 0xff;
    this.windowLine = 0;
    this.frameReady = false;
    // Clear to DMG white so reload/boot doesn't show stale frames
    const [r, g, b, a] = DMG_COLORS[0]!;
    for (let i = 0; i < this.frameBuffer.data.length; i += 4) {
      this.frameBuffer.data[i] = r;
      this.frameBuffer.data[i + 1] = g;
      this.frameBuffer.data[i + 2] = b;
      this.frameBuffer.data[i + 3] = a;
    }
  }

  writeLcdc(value: number): void {
    const wasOn = (this.lcdc & LCDC.LCD_ENABLE) !== 0;
    this.lcdc = value;
    this.bus.io[IO.LCDC - 0xff00] = value;
    if (wasOn && !(value & LCDC.LCD_ENABLE)) {
      this.ly = 0;
      this.dots = 0;
      this.mode = PPU_MODE.HBLANK;
      this.windowLine = 0;
      // Blank to white while LCD is off (games rewrites VRAM during this)
      this.fillFrame(DMG_COLORS[0]!);
    }
  }

  /** Called when WY is written — hardware resets the window line counter. */
  onWyWrite(): void {
    this.windowLine = 0;
  }

  writeStat(value: number): void {
    this.stat = (value & 0x78) | (this.stat & 0x07);
  }

  readStat(): number {
    let s = (this.stat & 0x78) | (this.mode & 3);
    if (this.ly === this.lyc) s |= STAT.LYC_EQ;
    return s;
  }

  /** Advance PPU by T-cycles. Returns true if a frame completed. */
  tick(cycles: number): boolean {
    this.syncFromBus();
    if (!(this.lcdc & LCDC.LCD_ENABLE)) {
      this.frameReady = false;
      return false;
    }

    this.frameReady = false;
    let remaining = cycles;
    while (remaining > 0) {
      const step = Math.min(remaining, DOTS_PER_LINE - this.dots);
      this.dots += step;
      remaining -= step;

      if (this.ly < VBLANK_START) {
        if (this.dots < 80) this.setMode(PPU_MODE.OAM);
        else if (this.dots < 80 + 172) this.setMode(PPU_MODE.TRANSFER);
        else this.setMode(PPU_MODE.HBLANK);
      } else {
        this.setMode(PPU_MODE.VBLANK);
      }

      if (this.dots >= DOTS_PER_LINE) {
        this.dots -= DOTS_PER_LINE;
        if (this.ly < VBLANK_START) {
          this.renderScanline();
        }
        this.ly++;
        if (this.ly === VBLANK_START) {
          this.bus.requestInterrupt(INT.VBLANK);
          this.setMode(PPU_MODE.VBLANK);
          this.frameReady = true;
        }
        if (this.ly >= LINES_PER_FRAME) {
          this.ly = 0;
          this.windowLine = 0;
        }
        this.checkLyc();
        this.bus.io[IO.LY - 0xff00] = this.ly;
      }
    }
    return this.frameReady;
  }

  private syncFromBus(): void {
    this.lcdc = this.bus.io[IO.LCDC - 0xff00]!;
    this.scx = this.bus.io[IO.SCX - 0xff00]!;
    this.scy = this.bus.io[IO.SCY - 0xff00]!;
    this.wy = this.bus.io[IO.WY - 0xff00]!;
    this.wx = this.bus.io[IO.WX - 0xff00]!;
    this.lyc = this.bus.io[IO.LYC - 0xff00]!;
    this.bgp = this.bus.io[IO.BGP - 0xff00]!;
    this.obp0 = this.bus.io[IO.OBP0 - 0xff00]!;
    this.obp1 = this.bus.io[IO.OBP1 - 0xff00]!;
  }

  private setMode(mode: number): void {
    if (this.mode === mode) return;
    this.mode = mode;
    const prev = this.stat;
    this.stat = (this.stat & ~STAT.MODE) | (mode & 3);
    this.bus.io[IO.STAT - 0xff00] = this.readStat();

    // HBlank DMA: one 16-byte block when entering HBlank on LY=0..143
    if (mode === PPU_MODE.HBLANK && this.ly < VBLANK_START) {
      this.bus.tickHdma();
    }

    let fire = false;
    if (mode === PPU_MODE.HBLANK && (prev & STAT.HBLANK_INT)) fire = true;
    if (mode === PPU_MODE.VBLANK && (prev & STAT.VBLANK_INT)) fire = true;
    if (mode === PPU_MODE.OAM && (prev & STAT.OAM_INT)) fire = true;
    if (fire) this.bus.requestInterrupt(INT.STAT);
  }

  private checkLyc(): void {
    const eq = this.ly === this.lyc;
    if (eq) {
      this.stat |= STAT.LYC_EQ;
      if (this.stat & STAT.LYC_INT) this.bus.requestInterrupt(INT.STAT);
    } else {
      this.stat &= ~STAT.LYC_EQ;
    }
    this.bus.io[IO.STAT - 0xff00] = this.readStat();
  }

  private renderScanline(): void {
    this.bgLineColors.fill(0);
    if (this.bus.cgbMode) {
      this.renderBgCgb();
      this.renderSpritesCgb();
    } else {
      if (this.lcdc & LCDC.BG_ENABLE) this.renderBgDmg();
      else this.fillLine(DMG_COLORS[0]!);
      if (this.lcdc & LCDC.WINDOW_ENABLE) this.renderWindowDmg();
      if (this.lcdc & LCDC.OBJ_ENABLE) this.renderSpritesDmg();
    }
  }

  private fillLine(color: [number, number, number, number]): void {
    const row = this.ly * SCREEN_WIDTH * 4;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const i = row + x * 4;
      this.frameBuffer.data[i] = color[0];
      this.frameBuffer.data[i + 1] = color[1];
      this.frameBuffer.data[i + 2] = color[2];
      this.frameBuffer.data[i + 3] = color[3];
    }
  }

  private fillFrame(color: [number, number, number, number]): void {
    for (let i = 0; i < this.frameBuffer.data.length; i += 4) {
      this.frameBuffer.data[i] = color[0];
      this.frameBuffer.data[i + 1] = color[1];
      this.frameBuffer.data[i + 2] = color[2];
      this.frameBuffer.data[i + 3] = color[3];
    }
  }

  /** Window is visible this scanline if enabled, LY>=WY, and WX in 0..166. */
  private windowVisible(): boolean {
    return (
      (this.lcdc & LCDC.WINDOW_ENABLE) !== 0 &&
      this.ly >= this.wy &&
      this.wx <= 166
    );
  }

  private paletteColor(palette: number, index: number): [number, number, number, number] {
    const shade = (palette >> (index * 2)) & 3;
    return DMG_COLORS[shade]!;
  }

  private renderBgDmg(): void {
    const mapBase = this.lcdc & LCDC.BG_TILEMAP ? 0x9c00 : 0x9800;
    const signed = !(this.lcdc & LCDC.TILE_DATA);
    const y = (this.scy + this.ly) & 0xff;
    const tileRow = (y >> 3) & 31;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const px = (this.scx + x) & 0xff;
      const tileCol = (px >> 3) & 31;
      const mapAddr = mapBase + tileRow * 32 + tileCol;
      let tile = this.bus.read(mapAddr);
      let tileAddr: number;
      if (signed) {
        tileAddr = 0x9000 + ((tile << 24) >> 24) * 16;
      } else {
        tileAddr = 0x8000 + tile * 16;
      }
      const line = (y & 7) * 2;
      const lo = this.bus.vram[0]![tileAddr - 0x8000 + line]!;
      const hi = this.bus.vram[0]![tileAddr - 0x8000 + line + 1]!;
      const bit = 7 - (px & 7);
      const colorId = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);
      this.bgLineColors[x] = colorId;
      this.putPixel(x, this.ly, this.paletteColor(this.bgp, colorId));
    }
  }

  private renderWindowDmg(): void {
    if (!this.windowVisible()) return;
    const wx = this.wx - 7;
    const mapBase = this.lcdc & LCDC.WINDOW_TILEMAP ? 0x9c00 : 0x9800;
    const signed = !(this.lcdc & LCDC.TILE_DATA);
    const y = this.windowLine;
    const tileRow = (y >> 3) & 31;
    let drew = false;
    for (let x = Math.max(0, wx); x < SCREEN_WIDTH; x++) {
      drew = true;
      const px = x - wx;
      const tileCol = (px >> 3) & 31;
      const mapAddr = mapBase + tileRow * 32 + tileCol;
      const tile = this.bus.vram[0]![mapAddr - 0x8000]!;
      let tileAddr: number;
      if (signed) tileAddr = 0x9000 + ((tile << 24) >> 24) * 16;
      else tileAddr = 0x8000 + tile * 16;
      const line = (y & 7) * 2;
      const lo = this.bus.vram[0]![tileAddr - 0x8000 + line]!;
      const hi = this.bus.vram[0]![tileAddr - 0x8000 + line + 1]!;
      const bit = 7 - (px & 7);
      const colorId = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);
      this.bgLineColors[x] = colorId;
      this.putPixel(x, this.ly, this.paletteColor(this.bgp, colorId));
    }
    // Only advance internal line counter when at least one pixel was drawn
    if (drew) this.windowLine++;
  }

  private renderSpritesDmg(): void {
    const tall = (this.lcdc & LCDC.OBJ_SIZE) !== 0;
    const height = tall ? 16 : 8;
    const sprites: { x: number; y: number; tile: number; attr: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const oy = this.bus.oam[i * 4]! - 16;
      const ox = this.bus.oam[i * 4 + 1]! - 8;
      const tile = this.bus.oam[i * 4 + 2]!;
      const attr = this.bus.oam[i * 4 + 3]!;
      if (this.ly >= oy && this.ly < oy + height) {
        sprites.push({ x: ox, y: oy, tile, attr });
        if (sprites.length >= 10) break;
      }
    }
    sprites.sort((a, b) => b.x - a.x);
    for (const sp of sprites) {
      let line = this.ly - sp.y;
      if (sp.attr & 0x40) line = height - 1 - line;
      let tile = sp.tile;
      if (tall) tile = line < 8 ? tile & 0xfe : tile | 1;
      if (tall && line >= 8) line -= 8;
      const tileAddr = tile * 16 + line * 2;
      const lo = this.bus.vram[0]![tileAddr]!;
      const hi = this.bus.vram[0]![tileAddr + 1]!;
      const pal = sp.attr & 0x10 ? this.obp1 : this.obp0;
      for (let px = 0; px < 8; px++) {
        const bit = sp.attr & 0x20 ? px : 7 - px;
        const colorId = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);
        if (colorId === 0) continue;
        const x = sp.x + px;
        if (x < 0 || x >= SCREEN_WIDTH) continue;
        if ((sp.attr & 0x80) && this.bgLineColors[x]! !== 0) continue;
        this.putPixel(x, this.ly, this.paletteColor(pal, colorId));
      }
    }
  }

  private cgbColor(paletteRam: Uint8Array, palette: number, colorId: number): [number, number, number, number] {
    const idx = palette * 8 + colorId * 2;
    const lo = paletteRam[idx]!;
    const hi = paletteRam[idx + 1]!;
    const raw = lo | (hi << 8);
    const r5 = raw & 0x1f;
    const g5 = (raw >> 5) & 0x1f;
    const b5 = (raw >> 10) & 0x1f;
    // Expand 5-bit to 8-bit (keep low bits instead of truncating)
    const r = (r5 << 3) | (r5 >> 2);
    const g = (g5 << 3) | (g5 >> 2);
    const b = (b5 << 3) | (b5 >> 2);
    return [r, g, b, 255];
  }

  private renderBgCgb(): void {
    const mapBase = this.lcdc & LCDC.BG_TILEMAP ? 0x9c00 : 0x9800;
    const signed = !(this.lcdc & LCDC.TILE_DATA);
    const y = (this.scy + this.ly) & 0xff;
    const tileRow = (y >> 3) & 31;
    const bgPriority = (this.lcdc & LCDC.BG_ENABLE) !== 0;

    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const px = (this.scx + x) & 0xff;
      const tileCol = (px >> 3) & 31;
      const mapAddr = mapBase + tileRow * 32 + tileCol;
      const tile = this.bus.vram[0]![mapAddr - 0x8000]!;
      const attr = this.bus.vram[1]![mapAddr - 0x8000]!;
      const bank = (attr & 0x08) ? 1 : 0;
      const pal = attr & 7;
      let tileAddr: number;
      if (signed) tileAddr = 0x9000 + ((tile << 24) >> 24) * 16;
      else tileAddr = 0x8000 + tile * 16;
      let line = y & 7;
      if (attr & 0x40) line = 7 - line;
      const lo = this.bus.vram[bank]![tileAddr - 0x8000 + line * 2]!;
      const hi = this.bus.vram[bank]![tileAddr - 0x8000 + line * 2 + 1]!;
      let bit = px & 7;
      if (!(attr & 0x20)) bit = 7 - bit;
      const colorId = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);
      this.bgLineColors[x] = colorId | ((attr & 0x80) ? 0x80 : 0) | (bgPriority ? 0x40 : 0);
      this.putPixel(x, this.ly, this.cgbColor(this.bus.bgPalette, pal, colorId));
    }

    // Window — only when visible; advance windowLine only if pixels drawn
    if (this.windowVisible()) {
      const wx = this.wx - 7;
      const wMap = this.lcdc & LCDC.WINDOW_TILEMAP ? 0x9c00 : 0x9800;
      const wy = this.windowLine;
      const wRow = (wy >> 3) & 31;
      let drew = false;
      for (let x = Math.max(0, wx); x < SCREEN_WIDTH; x++) {
        drew = true;
        const px = x - wx;
        const tileCol = (px >> 3) & 31;
        const mapAddr = wMap + wRow * 32 + tileCol;
        const tile = this.bus.vram[0]![mapAddr - 0x8000]!;
        const attr = this.bus.vram[1]![mapAddr - 0x8000]!;
        const bank = (attr & 0x08) ? 1 : 0;
        const pal = attr & 7;
        let tileAddr: number;
        if (signed) tileAddr = 0x9000 + ((tile << 24) >> 24) * 16;
        else tileAddr = 0x8000 + tile * 16;
        let line = wy & 7;
        if (attr & 0x40) line = 7 - line;
        const lo = this.bus.vram[bank]![tileAddr - 0x8000 + line * 2]!;
        const hi = this.bus.vram[bank]![tileAddr - 0x8000 + line * 2 + 1]!;
        let bit = px & 7;
        if (!(attr & 0x20)) bit = 7 - bit;
        const colorId = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);
        this.bgLineColors[x] = colorId | ((attr & 0x80) ? 0x80 : 0) | 0x40;
        this.putPixel(x, this.ly, this.cgbColor(this.bus.bgPalette, pal, colorId));
      }
      if (drew) this.windowLine++;
    }
  }

  private renderSpritesCgb(): void {
    if (!(this.lcdc & LCDC.OBJ_ENABLE)) return;
    const tall = (this.lcdc & LCDC.OBJ_SIZE) !== 0;
    const height = tall ? 16 : 8;
    const sprites: { x: number; y: number; tile: number; attr: number; idx: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const oy = this.bus.oam[i * 4]! - 16;
      const ox = this.bus.oam[i * 4 + 1]! - 8;
      const tile = this.bus.oam[i * 4 + 2]!;
      const attr = this.bus.oam[i * 4 + 3]!;
      if (this.ly >= oy && this.ly < oy + height) {
        sprites.push({ x: ox, y: oy, tile, attr, idx: i });
        if (sprites.length >= 10) break;
      }
    }
    // CGB: lower OAM index wins; first non-transparent pixel claims the column
    sprites.sort((a, b) => a.idx - b.idx);
    const claimed = new Uint8Array(SCREEN_WIDTH);
    // LCDC.0 = 0 → sprites always win over BG/window (CGB master priority)
    const prioritizeSprites = (this.lcdc & LCDC.BG_ENABLE) === 0;

    for (const sp of sprites) {
      // Match hardware: select 8x16 tile half from unflipped Y, then flip within the tile
      const insideY = this.ly - sp.y;
      const flipY = (sp.attr & 0x40) !== 0;
      let tile = sp.tile;
      if (tall) {
        tile &= 0xfe;
        let half = insideY >= 8 ? 1 : 0;
        if (flipY) half ^= 1;
        tile |= half;
      }
      const tileInsideY = flipY ? 7 - (insideY & 7) : insideY & 7;
      const bank = (sp.attr & 0x08) ? 1 : 0;
      const pal = sp.attr & 7;
      const tileAddr = tile * 16 + tileInsideY * 2;
      const lo = this.bus.vram[bank]![tileAddr]!;
      const hi = this.bus.vram[bank]![tileAddr + 1]!;
      for (let px = 0; px < 8; px++) {
        const bit = sp.attr & 0x20 ? px : 7 - px;
        const colorId = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);
        if (colorId === 0) continue;
        const x = sp.x + px;
        if (x < 0 || x >= SCREEN_WIDTH || claimed[x]) continue;
        claimed[x] = 1;
        const bg = this.bgLineColors[x]!;
        const bgColor = bg & 3;
        const bgPri = (bg & 0x80) !== 0;
        if (
          !prioritizeSprites &&
          bgColor !== 0 &&
          ((sp.attr & 0x80) !== 0 || bgPri)
        ) {
          continue;
        }
        this.putPixel(x, this.ly, this.cgbColor(this.bus.objPalette, pal, colorId));
      }
    }
  }

  private putPixel(x: number, y: number, color: [number, number, number, number]): void {
    const i = (y * SCREEN_WIDTH + x) * 4;
    this.frameBuffer.data[i] = color[0];
    this.frameBuffer.data[i + 1] = color[1];
    this.frameBuffer.data[i + 2] = color[2];
    this.frameBuffer.data[i + 3] = color[3];
  }

  exportState(): Uint8Array {
    const buf = new Uint8Array(32 + this.frameBuffer.data.length);
    const v = new DataView(buf.buffer);
    buf[0] = this.ly;
    buf[1] = this.mode;
    v.setUint16(2, this.dots, true);
    buf[4] = this.lcdc;
    buf[5] = this.stat;
    buf[6] = this.scx;
    buf[7] = this.scy;
    buf[8] = this.wy;
    buf[9] = this.wx;
    buf[10] = this.lyc;
    buf[11] = this.bgp;
    buf[12] = this.obp0;
    buf[13] = this.obp1;
    buf[14] = this.windowLine;
    buf.set(this.frameBuffer.data, 32);
    return buf;
  }

  importState(data: Uint8Array, offset = 0): number {
    const v = new DataView(data.buffer, data.byteOffset + offset);
    this.ly = data[offset]!;
    this.mode = data[offset + 1]!;
    this.dots = v.getUint16(2, true);
    this.lcdc = data[offset + 4]!;
    this.stat = data[offset + 5]!;
    this.scx = data[offset + 6]!;
    this.scy = data[offset + 7]!;
    this.wy = data[offset + 8]!;
    this.wx = data[offset + 9]!;
    this.lyc = data[offset + 10]!;
    this.bgp = data[offset + 11]!;
    this.obp0 = data[offset + 12]!;
    this.obp1 = data[offset + 13]!;
    this.windowLine = data[offset + 14]!;
    this.frameBuffer.data.set(data.subarray(offset + 32, offset + 32 + this.frameBuffer.data.length));
    return 32 + this.frameBuffer.data.length;
  }
}
