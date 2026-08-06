import type { Bus } from "@/bus/bus";
import { INT } from "@/constants/interrupt.constants";
import { IO } from "@/constants/memory.constants";

const TAC_ENABLE = 0x04;
/** Falling-edge bit of the 16-bit system counter for TAC & 3 (Pan Docs / Mooneye). */
const TAC_BITS = [9, 3, 5, 7];

export class Timer {
  /** 16-bit system counter; DIV register = (divSystem >> 8) & 0xff. */
  divSystem = 0;
  tima = 0;
  tma = 0;
  tac = 0;
  /** Cycles until TMA reload after overflow (−1 = idle). One M-cycle (4 T) delay. */
  private reloadDelay = -1;

  constructor(private bus: Bus) {}

  /** DIV register (upper 8 bits of the system counter). */
  get div(): number {
    return (this.divSystem >> 8) & 0xff;
  }

  set div(v: number) {
    this.divSystem = (this.divSystem & 0x00ff) | ((v & 0xff) << 8);
  }

  // ── Public ──────────────────────────────────────────────────────────────

  reset(): void {
    this.divSystem = 0;
    this.tima = 0;
    this.tma = 0;
    this.tac = 0;
    this.reloadDelay = -1;
  }

  read(addr: number): number {
    switch (addr) {
      case IO.DIV: return this.div;
      case IO.TIMA: return this.tima;
      case IO.TMA: return this.tma;
      case IO.TAC: return this.tac | 0xf8;
      default: return 0xff;
    }
  }

  write(addr: number, value: number): void {
    switch (addr) {
      case IO.DIV: {
        // DIV write resets the system counter; may cause a falling edge → TIMA quirk
        const old = this.divSystem;
        this.divSystem = 0;
        this.detectEdge(old, 0, this.tac, this.tac);
        break;
      }
      case IO.TIMA:
        // Writing TIMA during the reload delay cancels the reload
        this.reloadDelay = -1;
        this.tima = value & 0xff;
        break;
      case IO.TMA:
        this.tma = value & 0xff;
        // If currently reloading, the new TMA is what gets loaded
        if (this.reloadDelay === 0) this.tima = this.tma;
        break;
      case IO.TAC: {
        const oldTac = this.tac;
        const newTac = value & 0x07;
        this.tac = newTac;
        // Falling edge on (enable AND selected-bit) when enable/freq changes
        this.detectEdge(this.divSystem, this.divSystem, oldTac, newTac);
        break;
      }
    }
  }

  tick(cycles: number): void {
    for (let i = 0; i < cycles; i++) {
      if (this.reloadDelay >= 0) {
        if (this.reloadDelay === 0) {
          this.tima = this.tma;
          this.bus.requestInterrupt(INT.TIMER);
        }
        this.reloadDelay--;
      }

      const old = this.divSystem;
      this.divSystem = (this.divSystem + 1) & 0xffff;
      this.detectEdge(old, this.divSystem, this.tac, this.tac);
    }
  }

  exportState(): Uint8Array {
    const buf = new Uint8Array(12);
    const v = new DataView(buf.buffer);
    buf[0] = this.div;
    buf[1] = this.tima;
    buf[2] = this.tma;
    buf[3] = this.tac;
    v.setUint16(4, this.divSystem, true);
    v.setInt16(6, this.reloadDelay, true);
    v.setUint32(8, 0, true);
    return buf;
  }

  importState(data: Uint8Array, offset = 0): number {
    const v = new DataView(data.buffer, data.byteOffset + offset);
    this.tima = data[offset + 1]!;
    this.tma = data[offset + 2]!;
    this.tac = data[offset + 3]!;
    this.divSystem = v.getUint16(4, true);
    this.reloadDelay = v.getInt16(6, true);
    return 12;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /** TIMA increments on falling edge of (TAC enable AND selected system-counter bit). */
  private detectEdge(oldSys: number, newSys: number, oldTac: number, newTac: number): void {
    const oldAnd = this.signal(oldSys, oldTac);
    const newAnd = this.signal(newSys, newTac);
    if (oldAnd && !newAnd) this.incTima();
  }

  private signal(sys: number, tac: number): boolean {
    if (!(tac & TAC_ENABLE)) return false;
    const bit = TAC_BITS[tac & 3]!;
    return ((sys >> bit) & 1) !== 0;
  }

  private incTima(): void {
    // Ignore increments while waiting for TMA reload
    if (this.reloadDelay >= 0) return;
    this.tima = (this.tima + 1) & 0xff;
    if (this.tima === 0) {
      // Overflow: TIMA reads as 0 for ~1 M-cycle (4 T), then reload + IF
      this.reloadDelay = 3;
    }
  }
}
