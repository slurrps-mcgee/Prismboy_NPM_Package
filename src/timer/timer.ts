import type { Bus } from "@/bus/bus";
import { INT } from "@/constants/interrupt.constants";
import { IO } from "@/constants/memory.constants";

const TAC_ENABLE = 0x04;
const TAC_FREQ = [1024, 16, 64, 256];

export class Timer {
  div = 0;
  tima = 0;
  tma = 0;
  tac = 0;
  private divCounter = 0;
  private timaCounter = 0;

  constructor(private bus: Bus) {}

  // ── Public ──────────────────────────────────────────────────────────────

  // Reset the timer
  reset(): void {
    this.div = 0;
    this.tima = 0;
    this.tma = 0;
    this.tac = 0;
    this.divCounter = 0;
    this.timaCounter = 0;
  }

  // Read from the timer
  read(addr: number): number {
    switch (addr) {
      case IO.DIV: return this.div;
      case IO.TIMA: return this.tima;
      case IO.TMA: return this.tma;
      case IO.TAC: return this.tac | 0xf8;
      default: return 0xff;
    }
  }

  // Write to the timer
  write(addr: number, value: number): void {
    switch (addr) {
      case IO.DIV:
        this.div = 0;
        this.divCounter = 0;
        break;
      case IO.TIMA:
        this.tima = value;
        break;
      case IO.TMA:
        this.tma = value;
        break;
      case IO.TAC:
        this.tac = value & 0x07;
        break;
    }
  }

  // Tick the timer
  tick(cycles: number): void {
    this.divCounter += cycles;
    while (this.divCounter >= 256) {
      this.divCounter -= 256;
      this.div = (this.div + 1) & 0xff;
    }

    if (!(this.tac & TAC_ENABLE)) return;

    const freq = TAC_FREQ[this.tac & 3]!;
    this.timaCounter += cycles;
    while (this.timaCounter >= freq) {
      this.timaCounter -= freq;
      this.tima = (this.tima + 1) & 0xff;
      if (this.tima === 0) {
        this.tima = this.tma;
        this.bus.requestInterrupt(INT.TIMER);
      }
    }
  }

  // Export the state of the timer
  exportState(): Uint8Array {
    const buf = new Uint8Array(12);
    const v = new DataView(buf.buffer);
    buf[0] = this.div;
    buf[1] = this.tima;
    buf[2] = this.tma;
    buf[3] = this.tac;
    v.setUint32(4, this.divCounter, true);
    v.setUint32(8, this.timaCounter, true);
    return buf;
  }

  // Import the state of the timer
  importState(data: Uint8Array, offset = 0): number {
    const v = new DataView(data.buffer, data.byteOffset + offset);
    this.div = data[offset]!;
    this.tima = data[offset + 1]!;
    this.tma = data[offset + 2]!;
    this.tac = data[offset + 3]!;
    this.divCounter = v.getUint32(4, true);
    this.timaCounter = v.getUint32(8, true);
    return 12;
  }
}
