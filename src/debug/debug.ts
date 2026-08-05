/** Snapshot of SM83 CPU registers for host debug tools. */
export interface CpuRegisterState {
  a: number;
  f: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  af: number;
  bc: number;
  de: number;
  hl: number;
  sp: number;
  pc: number;
  z: boolean;
  n: boolean;
  hFlag: boolean;
  cy: boolean;
  ime: boolean;
  halted: boolean;
  stopped: boolean;
}

/** Snapshot of PPU timing / LCD state. */
export interface PpuDebugState {
  ly: number;
  mode: number;
  width: number;
  height: number;
  lcdc: number;
  stat: number;
  scx: number;
  scy: number;
  wy: number;
  wx: number;
  lyc: number;
}

/** Snapshot of DIV/TIMA/TMA/TAC. */
export interface TimerDebugState {
  div: number;
  tima: number;
  tma: number;
  tac: number;
}

/** IE / IF / IME interrupt snapshot. */
export interface InterruptDebugState {
  ie: number;
  if: number;
  ime: boolean;
  imeScheduled: boolean;
}

/** One disassembled instruction line. */
export interface DisasmLine {
  address: number;
  bytes: number[];
  mnemonic: string;
}

export class BreakpointSet {
  private addrs = new Set<number>();

  // ── Public ──────────────────────────────────────────────────────────────

  // Add a breakpoint
  add(address: number): void {
    this.addrs.add(address & 0xffff);
  }

  // Remove a breakpoint
  remove(address: number): void {
    this.addrs.delete(address & 0xffff);
  }

  // Clear all breakpoints
  clear(): void {
    this.addrs.clear();
  }

  // Check if a breakpoint exists
  has(address: number): boolean {
    return this.addrs.has(address & 0xffff);
  }

  // List all breakpoints
  list(): number[] {
    return [...this.addrs].sort((a, b) => a - b);
  }

  // Get the size of the breakpoint set
  get size(): number {
    return this.addrs.size;
  }
}
