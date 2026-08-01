import { IO, CPU_HZ } from "@/constants/memory.constants";

const SAMPLE_RATE = 44100;
const CYCLES_PER_SAMPLE = CPU_HZ / SAMPLE_RATE;
const DUTY_THRESH = [0.125, 0.25, 0.5, 0.75];
const MAX_BUF = 8192;

type Pulse = {
  enabled: boolean;
  dac: boolean;
  freq: number;
  duty: number;
  vol: number;
  phase: number;
  length: number;
  envPeriod: number;
  envTimer: number;
  envDir: number;
  sweepPeriod: number;
  sweepTimer: number;
  sweepShift: number;
  sweepDir: number;
  sweepShadow: number;
};

/**
 * APU with gbcore-style phase oscillators sampled at 44100 Hz
 * (CPU_HZ / 44100 cycles per sample) for correct pitch.
 */
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
    volShift: 4,
    phase: 0,
    length: 0,
    wave: new Uint8Array(16),
  };
  private ch4 = {
    enabled: false,
    dac: false,
    vol: 0,
    phaseTimer: 0,
    length: 0,
    envPeriod: 0,
    envTimer: 0,
    envDir: 0,
    lfsr: 0x7fff,
    width: false,
    divisor: 8,
    shift: 0,
  };

  private freshPulse(): Pulse {
    return {
      enabled: false,
      dac: false,
      freq: 0,
      duty: 0,
      vol: 0,
      phase: 0,
      length: 0,
      envPeriod: 0,
      envTimer: 0,
      envDir: 0,
      sweepPeriod: 0,
      sweepTimer: 0,
      sweepShift: 0,
      sweepDir: 0,
      sweepShadow: 0,
    };
  }

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
    this.ch3.phase = 0;
    this.ch3.wave.fill(0);
    this.ch4.enabled = false;
    this.ch4.dac = false;
    this.ch4.lfsr = 0x7fff;
    this.clearBuffer();
  }

  /** Idempotent — safe to call on every ROM load without duplicating nodes. */
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
    this.scriptNode = this.ctx.createScriptProcessor(1024, 0, 1);
    this.scriptNode.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < out.length; i++) {
        out[i] = this.popSample();
      }
    };
    this.scriptNode.connect(this.gain);
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
    // Or-masks for unused bits on reads (common GB quirk approximations)
    const off = addr - IO.NR10;
    const masks = [0x80, 0x3f, 0x00, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff, 0x9f, 0xff, 0xbf, 0xff, 0xff, 0x00, 0x00, 0xbf];
    return (this.regs[off] ?? 0) | (masks[off] ?? 0);
  }

  write(addr: number, value: number): void {
    if (addr === IO.NR52) {
      const wasOn = (this.nr52 & 0x80) !== 0;
      this.nr52 = value & 0x80;
      if (!this.nr52 && wasOn) {
        // Power off — clear registers except NR52
        for (let i = 0; i < 0x30; i++) {
          if (IO.NR10 + i !== IO.NR52) this.regs[i] = 0;
        }
        this.nr50 = 0;
        this.nr51 = 0;
        this.ch1.enabled = false;
        this.ch2.enabled = false;
        this.ch3.enabled = false;
        this.ch4.enabled = false;
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

    if (addr === IO.NR14 && value & 0x80) this.triggerCh1();
    if (addr === IO.NR24 && value & 0x80) this.triggerCh2();
    if (addr === IO.NR34 && value & 0x80) this.triggerCh3();
    if (addr === IO.NR44 && value & 0x80) this.triggerCh4();

    // Live period updates
    if (addr === IO.NR13 || addr === IO.NR14) {
      this.ch1.freq = this.regs[IO.NR13 - IO.NR10]! | ((this.regs[IO.NR14 - IO.NR10]! & 7) << 8);
    }
    if (addr === IO.NR23 || addr === IO.NR24) {
      this.ch2.freq = this.regs[IO.NR23 - IO.NR10]! | ((this.regs[IO.NR24 - IO.NR10]! & 7) << 8);
    }
    if (addr === IO.NR33 || addr === IO.NR34) {
      this.ch3.freq = this.regs[IO.NR33 - IO.NR10]! | ((this.regs[IO.NR34 - IO.NR10]! & 7) << 8);
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
    if (this.ch1.length === 0) this.ch1.length = 64 - (nr11 & 0x3f);
    this.ch1.vol = (nr12 >> 4) & 0xf;
    this.ch1.envPeriod = nr12 & 7;
    this.ch1.envTimer = this.ch1.envPeriod;
    this.ch1.envDir = (nr12 & 8) ? 1 : -1;
    this.ch1.freq = nr13 | ((nr14 & 7) << 8);
    this.ch1.sweepPeriod = (nr10 >> 4) & 7;
    this.ch1.sweepTimer = this.ch1.sweepPeriod || 8;
    this.ch1.sweepDir = (nr10 & 8) ? -1 : 1;
    this.ch1.sweepShift = nr10 & 7;
    this.ch1.sweepShadow = this.ch1.freq;
  }

  private triggerCh2(): void {
    const nr21 = this.regs[IO.NR21 - IO.NR10]!;
    const nr22 = this.regs[IO.NR22 - IO.NR10]!;
    const nr23 = this.regs[IO.NR23 - IO.NR10]!;
    const nr24 = this.regs[IO.NR24 - IO.NR10]!;
    this.ch2.dac = (nr22 & 0xf8) !== 0;
    this.ch2.enabled = this.ch2.dac;
    this.ch2.duty = (nr21 >> 6) & 3;
    if (this.ch2.length === 0) this.ch2.length = 64 - (nr21 & 0x3f);
    this.ch2.vol = (nr22 >> 4) & 0xf;
    this.ch2.envPeriod = nr22 & 7;
    this.ch2.envTimer = this.ch2.envPeriod;
    this.ch2.envDir = (nr22 & 8) ? 1 : -1;
    this.ch2.freq = nr23 | ((nr24 & 7) << 8);
  }

  private triggerCh3(): void {
    const nr31 = this.regs[IO.NR31 - IO.NR10]!;
    const nr32 = this.regs[IO.NR32 - IO.NR10]!;
    const nr33 = this.regs[IO.NR33 - IO.NR10]!;
    const nr34 = this.regs[IO.NR34 - IO.NR10]!;
    this.ch3.dac = (this.regs[IO.NR30 - IO.NR10]! & 0x80) !== 0;
    this.ch3.enabled = this.ch3.dac;
    if (this.ch3.length === 0) this.ch3.length = 256 - nr31;
    this.ch3.volShift = [4, 0, 1, 2][(nr32 >> 5) & 3]!;
    this.ch3.freq = nr33 | ((nr34 & 7) << 8);
    this.ch3.phase = 0;
  }

  private triggerCh4(): void {
    const nr41 = this.regs[IO.NR41 - IO.NR10]!;
    const nr42 = this.regs[IO.NR42 - IO.NR10]!;
    const nr43 = this.regs[IO.NR43 - IO.NR10]!;
    this.ch4.dac = (nr42 & 0xf8) !== 0;
    this.ch4.enabled = this.ch4.dac;
    if (this.ch4.length === 0) this.ch4.length = 64 - (nr41 & 0x3f);
    this.ch4.vol = (nr42 >> 4) & 0xf;
    this.ch4.envPeriod = nr42 & 7;
    this.ch4.envTimer = this.ch4.envPeriod;
    this.ch4.envDir = (nr42 & 8) ? 1 : -1;
    this.ch4.divisor = [8, 16, 32, 48, 64, 80, 96, 112][nr43 & 7]!;
    this.ch4.shift = (nr43 >> 4) & 0xf;
    this.ch4.width = (nr43 & 8) !== 0;
    this.ch4.lfsr = 0x7fff;
    this.ch4.phaseTimer = 0;
  }

  tick(cycles: number): void {
    // Still advance sample clock when powered off (silence)
    this.sampleAccum += cycles;
    if (this.nr52 & 0x80) {
      this.frameCounter += cycles;
      while (this.frameCounter >= 8192) {
        this.frameCounter -= 8192;
        this.clockFrameSeq();
      }
    }

    while (this.sampleAccum >= CYCLES_PER_SAMPLE) {
      this.sampleAccum -= CYCLES_PER_SAMPLE;
      if (this.soundEnabled) this.pushSample(this.mixSample());
    }
  }

  private clockFrameSeq(): void {
    if ((this.frameSeq & 1) === 0) {
      this.lengthTick(this.ch1, IO.NR14);
      this.lengthTick(this.ch2, IO.NR24);
      if (this.ch3.enabled && (this.regs[IO.NR34 - IO.NR10]! & 0x40) && this.ch3.length > 0) {
        if (--this.ch3.length === 0) this.ch3.enabled = false;
      }
      if (this.ch4.enabled && (this.regs[IO.NR44 - IO.NR10]! & 0x40) && this.ch4.length > 0) {
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

  private lengthTick(ch: Pulse, nrX4: number): void {
    if (ch.enabled && (this.regs[nrX4 - IO.NR10]! & 0x40) && ch.length > 0) {
      if (--ch.length === 0) ch.enabled = false;
    }
  }

  private envTick(ch: { enabled: boolean; vol: number; envPeriod: number; envTimer: number; envDir: number }): void {
    if (!ch.enabled || ch.envPeriod === 0) return;
    if (--ch.envTimer <= 0) {
      ch.envTimer = ch.envPeriod;
      const next = ch.vol + ch.envDir;
      if (next >= 0 && next <= 15) ch.vol = next;
    }
  }

  private sweepTick(): void {
    if (!this.ch1.enabled) return;
    if (this.ch1.sweepPeriod === 0 && this.ch1.sweepShift === 0) return;
    if (--this.ch1.sweepTimer <= 0) {
      this.ch1.sweepTimer = this.ch1.sweepPeriod || 8;
      if (this.ch1.sweepPeriod > 0) {
        const delta = this.ch1.sweepShadow >> this.ch1.sweepShift;
        const next = this.ch1.sweepShadow + delta * this.ch1.sweepDir;
        if (next > 2047 || next < 0) {
          this.ch1.enabled = false;
        } else if (this.ch1.sweepShift > 0) {
          this.ch1.sweepShadow = next;
          this.ch1.freq = next;
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

    // CH1 pulse — phase advance at sample rate
    if (this.ch1.enabled && this.ch1.dac) {
      const hz = this.hzPulse(this.ch1.freq);
      this.ch1.phase = (this.ch1.phase + hz / SAMPLE_RATE) % 1;
      const raw = this.ch1.phase < DUTY_THRESH[this.ch1.duty]! ? this.ch1.vol : 0;
      const s = (raw * 2 - this.ch1.vol) / 15;
      if (this.nr51 & 0x10) left += s;
      if (this.nr51 & 0x01) right += s;
    }
    if (this.ch2.enabled && this.ch2.dac) {
      const hz = this.hzPulse(this.ch2.freq);
      this.ch2.phase = (this.ch2.phase + hz / SAMPLE_RATE) % 1;
      const raw = this.ch2.phase < DUTY_THRESH[this.ch2.duty]! ? this.ch2.vol : 0;
      const s = (raw * 2 - this.ch2.vol) / 15;
      if (this.nr51 & 0x20) left += s;
      if (this.nr51 & 0x02) right += s;
    }
    if (this.ch3.enabled && this.ch3.dac) {
      const hz = this.hzWave(this.ch3.freq);
      this.ch3.phase = (this.ch3.phase + hz / SAMPLE_RATE) % 1;
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
      // Noise clocks at CPU rate; advance by cycles-per-sample
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

  /** Drop pending audio samples (call after savestate load / reload). */
  clearAudioBuffer(): void {
    this.clearBuffer();
  }

  private clearBuffer(): void {
    this.bufRead = 0;
    this.bufWrite = 0;
    this.bufCount = 0;
  }

  private pushSample(s: number): void {
    if (this.bufCount >= MAX_BUF) {
      // Drop oldest to avoid unbounded latency / echo
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

  exportState(): Uint8Array {
    const buf = new Uint8Array(72);
    buf.set(this.regs.subarray(0, 48), 0);
    buf[48] = this.nr52;
    buf[49] = this.nr50;
    buf[50] = this.nr51;
    buf[51] = this.frameSeq;
    buf[52] = this.ch1.enabled ? 1 : 0;
    buf[53] = this.ch2.enabled ? 1 : 0;
    buf[54] = this.ch3.enabled ? 1 : 0;
    buf[55] = this.ch4.enabled ? 1 : 0;
    buf.set(this.ch3.wave, 56);
    return buf;
  }

  importState(data: Uint8Array, offset = 0): number {
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
    this.clearBuffer();
    return 72;
  }
}
