import { IO, CPU_HZ } from "@/constants/memory.constants";

const SAMPLE_RATE = 44100;
const CYCLES_PER_SAMPLE = CPU_HZ / SAMPLE_RATE;
const DUTY_THRESH = [0.125, 0.25, 0.5, 0.75];
const MAX_BUF = 8192;
/** Frame sequencer clocks every 8192 T-cycles (~512 Hz). */
const FRAME_SEQ_PERIOD = 8192;

const WORKLET_SOURCE = `
class PrismboyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(${MAX_BUF});
    this.r = 0; this.w = 0; this.n = 0;
    this.port.onmessage = (e) => {
      const s = e.data;
      if (!(s instanceof Float32Array)) return;
      for (let i = 0; i < s.length; i++) {
        if (this.n >= ${MAX_BUF}) {
          this.r = (this.r + 1) % ${MAX_BUF};
          this.n--;
        }
        this.buf[this.w] = s[i];
        this.w = (this.w + 1) % ${MAX_BUF};
        this.n++;
      }
    };
  }
  process(_i, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (this.n > 0) {
        out[i] = this.buf[this.r];
        this.r = (this.r + 1) % ${MAX_BUF};
        this.n--;
      } else {
        out[i] = 0;
      }
    }
    return true;
  }
}
registerProcessor('prismboy-processor', PrismboyProcessor);
`;

type Pulse = {
  enabled: boolean;
  dac: boolean;
  freq: number;
  phaseInc: number;
  duty: number;
  vol: number;
  phase: number;
  length: number;
  lengthEnable: boolean;
  envPeriod: number;
  envTimer: number;
  envDir: number;
  envRunning: boolean;
  sweepPeriod: number;
  sweepTimer: number;
  sweepShift: number;
  sweepDir: number;
  sweepShadow: number;
  sweepEnabled: boolean;
};

/** Phase-oscillator APU: mix 4 channels at 44100 Hz (CPU_HZ/44100 cycles per sample). */
export class Apu {
  private soundEnabled = false;
  private muted = false;
  private volume = 0.35;
  private nr52 = 0x00;
  private nr50 = 0x00;
  private nr51 = 0x00;
  private regs = new Uint8Array(0x30);
  private frameSeq = 0;
  private frameCounter = 0;
  private sampleAccum = 0;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private workletFlush: Float32Array = new Float32Array(256);
  private workletFlushPos = 0;
  private useWorklet = false;
  private sampleBuf: Float32Array = new Float32Array(MAX_BUF);
  private bufRead = 0;
  private bufWrite = 0;
  private bufCount = 0;

  private ch1: Pulse = this.freshPulse();
  private ch2: Pulse = this.freshPulse();
  private ch3 = {
    enabled: false,
    dac: false,
    freq: 0,
    phaseInc: 0,
    volShift: 4,
    phase: 0,
    length: 0,
    lengthEnable: false,
    wave: new Uint8Array(16),
  };
  private ch4 = {
    enabled: false,
    dac: false,
    vol: 0,
    phaseTimer: 0,
    length: 0,
    lengthEnable: false,
    envPeriod: 0,
    envTimer: 0,
    envDir: 0,
    envRunning: false,
    lfsr: 0x7fff,
    width: false,
    divisor: 8,
    shift: 0,
  };

  // ── Public ──────────────────────────────────────────────────────────────

  reset(): void {
    this.regs.fill(0);
    this.nr52 = 0;
    this.nr50 = 0;
    this.nr51 = 0;
    this.frameSeq = 0;
    this.frameCounter = 0;
    this.sampleAccum = 0;
    this.ch1 = this.freshPulse();
    this.ch2 = this.freshPulse();
    this.ch3.enabled = false;
    this.ch3.dac = false;
    this.ch3.freq = 0;
    this.ch3.phaseInc = 0;
    this.ch3.phase = 0;
    this.ch3.length = 0;
    this.ch3.lengthEnable = false;
    this.ch3.wave.fill(0);
    this.ch4.enabled = false;
    this.ch4.dac = false;
    this.ch4.lfsr = 0x7fff;
    this.ch4.length = 0;
    this.ch4.lengthEnable = false;
    this.ch4.envRunning = false;
    this.clearBuffer();
  }

  enableSound(): void {
    if (typeof AudioContext === "undefined" && typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext === "undefined") {
      this.soundEnabled = true;
      return;
    }
    if (this.ctx) {
      void this.ctx.resume();
      this.soundEnabled = true;
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ sampleRate: SAMPLE_RATE });
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : this.volume;
    this.gain.connect(this.ctx.destination);
    // Prefer AudioWorklet; ScriptProcessor is the Node/legacy fallback
    if (typeof AudioWorkletNode !== "undefined" && this.ctx.audioWorklet) {
      void this.setupOutputNode();
    } else {
      this.setupScriptProcessor();
    }
    this.soundEnabled = true;
  }

  mute(): void {
    this.muted = true;
    if (this.gain) this.gain.gain.value = 0;
  }

  unMute(): void {
    this.muted = false;
    if (this.gain) this.gain.gain.value = this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain && !this.muted) this.gain.gain.value = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  read(addr: number): number {
    if (addr === IO.NR52) {
      let v = (this.nr52 & 0x80) | 0x70;
      if (this.ch1.enabled) v |= 1;
      if (this.ch2.enabled) v |= 2;
      if (this.ch3.enabled) v |= 4;
      if (this.ch4.enabled) v |= 8;
      return v;
    }
    if (addr === IO.NR50) return this.nr50;
    if (addr === IO.NR51) return this.nr51;
    if (addr >= 0xff30 && addr <= 0xff3f) return this.ch3.wave[addr - 0xff30]!;
    const off = addr - IO.NR10;
    const masks = [0x80, 0x3f, 0x00, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff, 0x9f, 0xff, 0xbf, 0xff, 0xff, 0x00, 0x00, 0xbf];
    return (this.regs[off] ?? 0) | (masks[off] ?? 0);
  }

  write(addr: number, value: number): void {
    if (addr === IO.NR52) {
      const wasOn = (this.nr52 & 0x80) !== 0;
      this.nr52 = value & 0x80;
      if (!this.nr52 && wasOn) {
        for (let i = 0; i < 0x30; i++) {
          if (IO.NR10 + i !== IO.NR52) this.regs[i] = 0;
        }
        this.nr50 = 0;
        this.nr51 = 0;
        this.ch1.enabled = false;
        this.ch2.enabled = false;
        this.ch3.enabled = false;
        this.ch4.enabled = false;
        this.frameSeq = 0;
        this.frameCounter = 0;
      }
      if (this.nr52 && !wasOn) {
        this.frameSeq = 0;
        this.frameCounter = 0;
      }
      return;
    }
    if (!(this.nr52 & 0x80)) return;

    if (addr === IO.NR50) { this.nr50 = value; return; }
    if (addr === IO.NR51) { this.nr51 = value; return; }
    if (addr >= 0xff30 && addr <= 0xff3f) {
      this.ch3.wave[addr - 0xff30] = value;
      return;
    }

    this.regs[addr - IO.NR10] = value;

    // Length counters load on NRx1 writes (even when channel disabled)
    if (addr === IO.NR11) this.ch1.length = 64 - (value & 0x3f);
    if (addr === IO.NR21) this.ch2.length = 64 - (value & 0x3f);
    if (addr === IO.NR31) this.ch3.length = 256 - value;
    if (addr === IO.NR41) this.ch4.length = 64 - (value & 0x3f);

    if (addr === IO.NR12) {
      this.ch1.dac = (value & 0xf8) !== 0;
      if (!this.ch1.dac) this.ch1.enabled = false;
    }
    if (addr === IO.NR22) {
      this.ch2.dac = (value & 0xf8) !== 0;
      if (!this.ch2.dac) this.ch2.enabled = false;
    }
    if (addr === IO.NR30) {
      this.ch3.dac = (value & 0x80) !== 0;
      if (!this.ch3.dac) this.ch3.enabled = false;
    }
    if (addr === IO.NR42) {
      this.ch4.dac = (value & 0xf8) !== 0;
      if (!this.ch4.dac) this.ch4.enabled = false;
    }

    // Length-enable mid-frame: extra clock if enabling when next step would not clock length
    if (addr === IO.NR14) this.updateLengthEnable(this.ch1, value, true);
    if (addr === IO.NR24) this.updateLengthEnable(this.ch2, value, true);
    if (addr === IO.NR34) this.updateLengthEnable(this.ch3, value, false);
    if (addr === IO.NR44) this.updateLengthEnable(this.ch4, value, false);

    if (addr === IO.NR14 && value & 0x80) this.triggerCh1();
    if (addr === IO.NR24 && value & 0x80) this.triggerCh2();
    if (addr === IO.NR34 && value & 0x80) this.triggerCh3();
    if (addr === IO.NR44 && value & 0x80) this.triggerCh4();

    if (addr === IO.NR13 || addr === IO.NR14) {
      this.setPulseFreq(this.ch1, this.regs[IO.NR13 - IO.NR10]! | ((this.regs[IO.NR14 - IO.NR10]! & 7) << 8));
    }
    if (addr === IO.NR23 || addr === IO.NR24) {
      this.setPulseFreq(this.ch2, this.regs[IO.NR23 - IO.NR10]! | ((this.regs[IO.NR24 - IO.NR10]! & 7) << 8));
    }
    if (addr === IO.NR33 || addr === IO.NR34) {
      this.setWaveFreq(this.regs[IO.NR33 - IO.NR10]! | ((this.regs[IO.NR34 - IO.NR10]! & 7) << 8));
    }
    if (addr === IO.NR11) this.ch1.duty = (value >> 6) & 3;
    if (addr === IO.NR21) this.ch2.duty = (value >> 6) & 3;
    if (addr === IO.NR32) this.ch3.volShift = [4, 0, 1, 2][(value >> 5) & 3]!;
    if (addr === IO.NR43) {
      this.ch4.divisor = [8, 16, 32, 48, 64, 80, 96, 112][value & 7]!;
      this.ch4.shift = (value >> 4) & 0xf;
      this.ch4.width = (value & 8) !== 0;
    }
  }

  tick(cycles: number): void {
    this.sampleAccum += cycles;
    if (this.nr52 & 0x80) {
      this.frameCounter += cycles;
      while (this.frameCounter >= FRAME_SEQ_PERIOD) {
        this.frameCounter -= FRAME_SEQ_PERIOD;
        this.clockFrameSeq();
      }
    }

    while (this.sampleAccum >= CYCLES_PER_SAMPLE) {
      this.sampleAccum -= CYCLES_PER_SAMPLE;
      if (this.soundEnabled) this.pushSample(this.mixSample());
    }
  }

  clearAudioBuffer(): void {
    this.clearBuffer();
    this.workletFlushPos = 0;
  }

  exportState(): Uint8Array {
    // Expanded blob: regs + control + deep channel FSM
    const buf = new Uint8Array(256);
    const v = new DataView(buf.buffer);
    buf.set(this.regs.subarray(0, 48), 0);
    buf[48] = this.nr52;
    buf[49] = this.nr50;
    buf[50] = this.nr51;
    buf[51] = this.frameSeq;
    v.setUint32(52, this.frameCounter, true);
    v.setFloat64(56, this.sampleAccum, true);

    this.writePulseState(buf, 64, this.ch1);
    this.writePulseState(buf, 96, this.ch2);

    buf[128] = this.ch3.enabled ? 1 : 0;
    buf[129] = this.ch3.dac ? 1 : 0;
    v.setUint16(130, this.ch3.freq, true);
    v.setFloat64(132, this.ch3.phaseInc, true);
    buf[140] = this.ch3.volShift;
    v.setFloat64(141, this.ch3.phase, true);
    v.setUint16(149, this.ch3.length, true);
    buf[151] = this.ch3.lengthEnable ? 1 : 0;
    buf.set(this.ch3.wave, 152);

    buf[168] = this.ch4.enabled ? 1 : 0;
    buf[169] = this.ch4.dac ? 1 : 0;
    buf[170] = this.ch4.vol;
    v.setFloat64(171, this.ch4.phaseTimer, true);
    v.setUint16(179, this.ch4.length, true);
    buf[181] = this.ch4.lengthEnable ? 1 : 0;
    buf[182] = this.ch4.envPeriod;
    buf[183] = this.ch4.envTimer;
    buf[184] = this.ch4.envDir + 1;
    buf[185] = this.ch4.envRunning ? 1 : 0;
    v.setUint16(186, this.ch4.lfsr, true);
    buf[188] = this.ch4.width ? 1 : 0;
    buf[189] = this.ch4.divisor;
    buf[190] = this.ch4.shift;
    v.setUint16(191, this.ch1.sweepShadow, true);

    return buf;
  }

  importState(data: Uint8Array, offset = 0): number {
    const len = data.length - offset;
    // Legacy 72-byte blob
    if (len < 128) {
      this.regs.set(data.subarray(offset, offset + 48));
      this.nr52 = data[offset + 48]!;
      this.nr50 = data[offset + 49]!;
      this.nr51 = data[offset + 50]!;
      this.frameSeq = data[offset + 51]!;
      this.ch1.enabled = data[offset + 52]! !== 0;
      this.ch2.enabled = data[offset + 53]! !== 0;
      this.ch3.enabled = data[offset + 54]! !== 0;
      this.ch4.enabled = data[offset + 55]! !== 0;
      this.ch3.wave.set(data.subarray(offset + 56, offset + 72));
      this.setPulseFreq(this.ch1, this.regs[IO.NR13 - IO.NR10]! | ((this.regs[IO.NR14 - IO.NR10]! & 7) << 8));
      this.setPulseFreq(this.ch2, this.regs[IO.NR23 - IO.NR10]! | ((this.regs[IO.NR24 - IO.NR10]! & 7) << 8));
      this.setWaveFreq(this.regs[IO.NR33 - IO.NR10]! | ((this.regs[IO.NR34 - IO.NR10]! & 7) << 8));
      this.clearBuffer();
      return 72;
    }

    const v = new DataView(data.buffer, data.byteOffset + offset);
    this.regs.set(data.subarray(offset, offset + 48));
    this.nr52 = data[offset + 48]!;
    this.nr50 = data[offset + 49]!;
    this.nr51 = data[offset + 50]!;
    this.frameSeq = data[offset + 51]!;
    this.frameCounter = v.getUint32(52, true);
    this.sampleAccum = v.getFloat64(56, true);

    this.readPulseState(data, offset + 64, this.ch1);
    this.readPulseState(data, offset + 96, this.ch2);

    this.ch3.enabled = data[offset + 128]! !== 0;
    this.ch3.dac = data[offset + 129]! !== 0;
    this.ch3.freq = v.getUint16(130, true);
    this.ch3.phaseInc = v.getFloat64(132, true);
    this.ch3.volShift = data[offset + 140]!;
    this.ch3.phase = v.getFloat64(141, true);
    this.ch3.length = v.getUint16(149, true);
    this.ch3.lengthEnable = data[offset + 151]! !== 0;
    this.ch3.wave.set(data.subarray(offset + 152, offset + 168));

    this.ch4.enabled = data[offset + 168]! !== 0;
    this.ch4.dac = data[offset + 169]! !== 0;
    this.ch4.vol = data[offset + 170]!;
    this.ch4.phaseTimer = v.getFloat64(171, true);
    this.ch4.length = v.getUint16(179, true);
    this.ch4.lengthEnable = data[offset + 181]! !== 0;
    this.ch4.envPeriod = data[offset + 182]!;
    this.ch4.envTimer = data[offset + 183]!;
    this.ch4.envDir = data[offset + 184]! - 1;
    this.ch4.envRunning = data[offset + 185]! !== 0;
    this.ch4.lfsr = v.getUint16(186, true);
    this.ch4.width = data[offset + 188]! !== 0;
    this.ch4.divisor = data[offset + 189]!;
    this.ch4.shift = data[offset + 190]!;
    this.ch1.sweepShadow = v.getUint16(191, true);

    this.clearBuffer();
    return 256;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async setupOutputNode(): Promise<void> {
    if (!this.ctx || !this.gain) return;
    try {
      const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.workletNode = new AudioWorkletNode(this.ctx, "prismboy-processor");
      this.workletNode.connect(this.gain);
      this.useWorklet = true;
    } catch {
      this.setupScriptProcessor();
    }
  }

  private setupScriptProcessor(): void {
    if (!this.ctx || !this.gain) return;
    this.useWorklet = false;
    this.scriptNode = this.ctx.createScriptProcessor(1024, 0, 1);
    this.scriptNode.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < out.length; i++) {
        out[i] = this.popSample();
      }
    };
    this.scriptNode.connect(this.gain);
  }

  private freshPulse(): Pulse {
    return {
      enabled: false,
      dac: false,
      freq: 0,
      phaseInc: 0,
      duty: 0,
      vol: 0,
      phase: 0,
      length: 0,
      lengthEnable: false,
      envPeriod: 0,
      envTimer: 0,
      envDir: 0,
      envRunning: false,
      sweepPeriod: 0,
      sweepTimer: 0,
      sweepShift: 0,
      sweepDir: 0,
      sweepShadow: 0,
      sweepEnabled: false,
    };
  }

  private setPulseFreq(ch: Pulse, freq: number): void {
    ch.freq = freq & 0x7ff;
    ch.phaseInc = this.hzPulse(ch.freq) / SAMPLE_RATE;
  }

  private setWaveFreq(freq: number): void {
    this.ch3.freq = freq & 0x7ff;
    this.ch3.phaseInc = this.hzWave(this.ch3.freq) / SAMPLE_RATE;
  }

  private updateLengthEnable(
    ch: { length: number; lengthEnable: boolean; enabled: boolean },
    value: number,
    _isPulse: boolean,
  ): void {
    const was = ch.lengthEnable;
    ch.lengthEnable = (value & 0x40) !== 0;
    // Extra length clock when enabling length while frame seq is in a non-length step
    if (!was && ch.lengthEnable && (this.frameSeq & 1) === 1 && ch.length > 0) {
      ch.length--;
      if (ch.length === 0) ch.enabled = false;
    }
  }

  private triggerCh1(): void {
    const nr10 = this.regs[0]!;
    const nr11 = this.regs[IO.NR11 - IO.NR10]!;
    const nr12 = this.regs[IO.NR12 - IO.NR10]!;
    const nr13 = this.regs[IO.NR13 - IO.NR10]!;
    const nr14 = this.regs[IO.NR14 - IO.NR10]!;
    this.ch1.dac = (nr12 & 0xf8) !== 0;
    this.ch1.enabled = this.ch1.dac;
    this.ch1.duty = (nr11 >> 6) & 3;
    if (this.ch1.length === 0) this.ch1.length = 64;
    this.ch1.lengthEnable = (nr14 & 0x40) !== 0;
    this.ch1.vol = (nr12 >> 4) & 0xf;
    this.ch1.envPeriod = nr12 & 7;
    this.ch1.envTimer = this.ch1.envPeriod || 8;
    this.ch1.envDir = (nr12 & 8) ? 1 : -1;
    this.ch1.envRunning = true;
    this.setPulseFreq(this.ch1, nr13 | ((nr14 & 7) << 8));
    this.ch1.phase = 0;
    this.ch1.sweepPeriod = (nr10 >> 4) & 7;
    this.ch1.sweepShift = nr10 & 7;
    this.ch1.sweepDir = (nr10 & 8) ? -1 : 1;
    this.ch1.sweepShadow = this.ch1.freq;
    this.ch1.sweepTimer = this.ch1.sweepPeriod || 8;
    this.ch1.sweepEnabled = this.ch1.sweepPeriod > 0 || this.ch1.sweepShift > 0;
    // Immediate overflow check on trigger (Pan Docs)
    if (this.ch1.sweepShift > 0) {
      const next = this.calcSweepFreq();
      if (next > 0x7ff) this.ch1.enabled = false;
    }
  }

  private triggerCh2(): void {
    const nr21 = this.regs[IO.NR21 - IO.NR10]!;
    const nr22 = this.regs[IO.NR22 - IO.NR10]!;
    const nr23 = this.regs[IO.NR23 - IO.NR10]!;
    const nr24 = this.regs[IO.NR24 - IO.NR10]!;
    this.ch2.dac = (nr22 & 0xf8) !== 0;
    this.ch2.enabled = this.ch2.dac;
    this.ch2.duty = (nr21 >> 6) & 3;
    if (this.ch2.length === 0) this.ch2.length = 64;
    this.ch2.lengthEnable = (nr24 & 0x40) !== 0;
    this.ch2.vol = (nr22 >> 4) & 0xf;
    this.ch2.envPeriod = nr22 & 7;
    this.ch2.envTimer = this.ch2.envPeriod || 8;
    this.ch2.envDir = (nr22 & 8) ? 1 : -1;
    this.ch2.envRunning = true;
    this.setPulseFreq(this.ch2, nr23 | ((nr24 & 7) << 8));
    this.ch2.phase = 0;
  }

  private triggerCh3(): void {
    const nr32 = this.regs[IO.NR32 - IO.NR10]!;
    const nr33 = this.regs[IO.NR33 - IO.NR10]!;
    const nr34 = this.regs[IO.NR34 - IO.NR10]!;
    this.ch3.dac = (this.regs[IO.NR30 - IO.NR10]! & 0x80) !== 0;
    this.ch3.enabled = this.ch3.dac;
    if (this.ch3.length === 0) this.ch3.length = 256;
    this.ch3.lengthEnable = (nr34 & 0x40) !== 0;
    this.ch3.volShift = [4, 0, 1, 2][(nr32 >> 5) & 3]!;
    this.setWaveFreq(nr33 | ((nr34 & 7) << 8));
    this.ch3.phase = 0;
  }

  private triggerCh4(): void {
    const nr42 = this.regs[IO.NR42 - IO.NR10]!;
    const nr43 = this.regs[IO.NR43 - IO.NR10]!;
    const nr44 = this.regs[IO.NR44 - IO.NR10]!;
    this.ch4.dac = (nr42 & 0xf8) !== 0;
    this.ch4.enabled = this.ch4.dac;
    if (this.ch4.length === 0) this.ch4.length = 64;
    this.ch4.lengthEnable = (nr44 & 0x40) !== 0;
    this.ch4.vol = (nr42 >> 4) & 0xf;
    this.ch4.envPeriod = nr42 & 7;
    this.ch4.envTimer = this.ch4.envPeriod || 8;
    this.ch4.envDir = (nr42 & 8) ? 1 : -1;
    this.ch4.envRunning = true;
    this.ch4.divisor = [8, 16, 32, 48, 64, 80, 96, 112][nr43 & 7]!;
    this.ch4.shift = (nr43 >> 4) & 0xf;
    this.ch4.width = (nr43 & 8) !== 0;
    this.ch4.lfsr = 0x7fff;
    this.ch4.phaseTimer = 0;
  }

  /** Frame sequencer: length on 0,2,4,6; sweep on 2,6; envelope on 7. */
  private clockFrameSeq(): void {
    if ((this.frameSeq & 1) === 0) {
      this.lengthTick(this.ch1);
      this.lengthTick(this.ch2);
      if (this.ch3.enabled && this.ch3.lengthEnable && this.ch3.length > 0) {
        if (--this.ch3.length === 0) this.ch3.enabled = false;
      }
      if (this.ch4.enabled && this.ch4.lengthEnable && this.ch4.length > 0) {
        if (--this.ch4.length === 0) this.ch4.enabled = false;
      }
    }
    if (this.frameSeq === 2 || this.frameSeq === 6) this.sweepTick();
    if (this.frameSeq === 7) {
      this.envTick(this.ch1);
      this.envTick(this.ch2);
      this.envTick(this.ch4);
    }
    this.frameSeq = (this.frameSeq + 1) & 7;
  }

  private lengthTick(ch: Pulse): void {
    if (ch.enabled && ch.lengthEnable && ch.length > 0) {
      if (--ch.length === 0) ch.enabled = false;
    }
  }

  private envTick(ch: { enabled: boolean; vol: number; envPeriod: number; envTimer: number; envDir: number; envRunning: boolean }): void {
    if (!ch.enabled || !ch.envRunning || ch.envPeriod === 0) return;
    if (--ch.envTimer <= 0) {
      ch.envTimer = ch.envPeriod;
      const next = ch.vol + ch.envDir;
      if (next >= 0 && next <= 15) ch.vol = next;
      else ch.envRunning = false;
    }
  }

  private calcSweepFreq(): number {
    const delta = this.ch1.sweepShadow >> this.ch1.sweepShift;
    return this.ch1.sweepShadow + delta * this.ch1.sweepDir;
  }

  private sweepTick(): void {
    if (!this.ch1.enabled || !this.ch1.sweepEnabled) return;
    if (--this.ch1.sweepTimer <= 0) {
      this.ch1.sweepTimer = this.ch1.sweepPeriod || 8;
      if (this.ch1.sweepPeriod > 0) {
        const next = this.calcSweepFreq();
        if (next > 0x7ff) {
          this.ch1.enabled = false;
        } else if (this.ch1.sweepShift > 0) {
          this.ch1.sweepShadow = next;
          this.setPulseFreq(this.ch1, next);
          // Second overflow check after write-back
          if (this.calcSweepFreq() > 0x7ff) this.ch1.enabled = false;
        }
      }
    }
  }

  private hzPulse(period: number): number {
    if (period >= 2047) return 0;
    return 131072 / (2048 - period);
  }

  private hzWave(period: number): number {
    if (period >= 2047) return 0;
    return 65536 / (2048 - period);
  }

  private mixSample(): number {
    if (!(this.nr52 & 0x80)) return 0;

    let left = 0;
    let right = 0;
    const leftVol = ((this.nr50 >> 4) & 7) + 1;
    const rightVol = (this.nr50 & 7) + 1;

    if (this.ch1.enabled && this.ch1.dac) {
      this.ch1.phase = (this.ch1.phase + this.ch1.phaseInc) % 1;
      const raw = this.ch1.phase < DUTY_THRESH[this.ch1.duty]! ? this.ch1.vol : 0;
      const s = (raw * 2 - this.ch1.vol) / 15;
      if (this.nr51 & 0x10) left += s;
      if (this.nr51 & 0x01) right += s;
    }
    if (this.ch2.enabled && this.ch2.dac) {
      this.ch2.phase = (this.ch2.phase + this.ch2.phaseInc) % 1;
      const raw = this.ch2.phase < DUTY_THRESH[this.ch2.duty]! ? this.ch2.vol : 0;
      const s = (raw * 2 - this.ch2.vol) / 15;
      if (this.nr51 & 0x20) left += s;
      if (this.nr51 & 0x02) right += s;
    }
    if (this.ch3.enabled && this.ch3.dac) {
      this.ch3.phase = (this.ch3.phase + this.ch3.phaseInc) % 1;
      const idx = Math.floor(this.ch3.phase * 32) & 31;
      const byte = this.ch3.wave[idx >> 1]!;
      let nibble = idx & 1 ? byte & 0xf : byte >> 4;
      nibble = this.ch3.volShift === 4 ? 0 : nibble >> this.ch3.volShift;
      const s = (nibble * 2 - 15) / 15;
      if (this.nr51 & 0x40) left += s;
      if (this.nr51 & 0x04) right += s;
    }
    if (this.ch4.enabled && this.ch4.dac) {
      const period = Math.max(1, (this.ch4.divisor << this.ch4.shift) || 8);
      this.ch4.phaseTimer += CYCLES_PER_SAMPLE;
      while (this.ch4.phaseTimer >= period) {
        this.ch4.phaseTimer -= period;
        const xor = (this.ch4.lfsr & 1) ^ ((this.ch4.lfsr >> 1) & 1);
        this.ch4.lfsr = (this.ch4.lfsr >> 1) | (xor << 14);
        if (this.ch4.width) this.ch4.lfsr = (this.ch4.lfsr & ~0x40) | (xor << 6);
      }
      const raw = (~this.ch4.lfsr & 1) * this.ch4.vol;
      const s = (raw * 2 - this.ch4.vol) / 15;
      if (this.nr51 & 0x80) left += s;
      if (this.nr51 & 0x08) right += s;
    }

    left = (left / 4) * (leftVol / 8);
    right = (right / 4) * (rightVol / 8);
    return (left + right) * 0.5;
  }

  private clearBuffer(): void {
    this.bufRead = 0;
    this.bufWrite = 0;
    this.bufCount = 0;
  }

  private pushSample(s: number): void {
    if (this.useWorklet && this.workletNode) {
      this.workletFlush[this.workletFlushPos++] = s;
      if (this.workletFlushPos >= this.workletFlush.length) {
        this.workletNode.port.postMessage(this.workletFlush.slice());
        this.workletFlushPos = 0;
      }
      return;
    }
    if (this.bufCount >= MAX_BUF) {
      this.bufRead = (this.bufRead + 1) % MAX_BUF;
      this.bufCount--;
    }
    this.sampleBuf[this.bufWrite] = s;
    this.bufWrite = (this.bufWrite + 1) % MAX_BUF;
    this.bufCount++;
  }

  private popSample(): number {
    if (this.bufCount === 0) return 0;
    const s = this.sampleBuf[this.bufRead]!;
    this.bufRead = (this.bufRead + 1) % MAX_BUF;
    this.bufCount--;
    return s;
  }

  private writePulseState(buf: Uint8Array, o: number, ch: Pulse): void {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    buf[o] = ch.enabled ? 1 : 0;
    buf[o + 1] = ch.dac ? 1 : 0;
    v.setUint16(o + 2, ch.freq, true);
    v.setFloat64(o + 4, ch.phaseInc, true);
    buf[o + 12] = ch.duty;
    buf[o + 13] = ch.vol;
    v.setFloat64(o + 14, ch.phase, true);
    buf[o + 22] = ch.length;
    buf[o + 23] = ch.lengthEnable ? 1 : 0;
    buf[o + 24] = ch.envPeriod;
    buf[o + 25] = ch.envTimer;
    buf[o + 26] = ch.envDir + 1;
    buf[o + 27] = ch.envRunning ? 1 : 0;
    buf[o + 28] = ch.sweepPeriod;
    buf[o + 29] = ch.sweepTimer;
    buf[o + 30] = ch.sweepShift;
    buf[o + 31] = ((ch.sweepDir + 1) & 3) | (ch.sweepEnabled ? 4 : 0);
  }

  private readPulseState(data: Uint8Array, o: number, ch: Pulse): void {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    ch.enabled = data[o]! !== 0;
    ch.dac = data[o + 1]! !== 0;
    ch.freq = v.getUint16(o + 2, true);
    ch.phaseInc = v.getFloat64(o + 4, true);
    ch.duty = data[o + 12]!;
    ch.vol = data[o + 13]!;
    ch.phase = v.getFloat64(o + 14, true);
    ch.length = data[o + 22]!;
    ch.lengthEnable = data[o + 23]! !== 0;
    ch.envPeriod = data[o + 24]!;
    ch.envTimer = data[o + 25]!;
    ch.envDir = data[o + 26]! - 1;
    ch.envRunning = data[o + 27]! !== 0;
    ch.sweepPeriod = data[o + 28]!;
    ch.sweepTimer = data[o + 29]!;
    ch.sweepShift = data[o + 30]!;
    const sw = data[o + 31]!;
    ch.sweepDir = (sw & 3) - 1;
    ch.sweepEnabled = (sw & 4) !== 0;
  }
}
