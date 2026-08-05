/** Typed event map for GameBoy host callbacks. */
export type GameBoyEvents = {
  frame: [frame: ImageData, fps: number];
  save: [data: Uint8Array];
  pause: [];
  resume: [];
  reset: [];
  romloaded: [title: string];
  error: [error: Error];
  breakpoint: [address: number];
  gamepadconnected: [pad: Gamepad];
  gamepaddisconnected: [pad: Gamepad];
};

type Handler<T extends unknown[]> = (...args: T) => void;

/** Tiny typed pub/sub for host UI callbacks. */
export class EventEmitter<E extends Record<string, unknown[]>> {
  private listeners = new Map<keyof E, Set<Handler<unknown[]>>>();

  // ── Public ──────────────────────────────────────────────────────────────

  // Add a listener to an event
  on<K extends keyof E>(event: K, handler: Handler<E[K]>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler<unknown[]>);
  }

  // Remove a listener from an event
  off<K extends keyof E>(event: K, handler: Handler<E[K]>): void {
    this.listeners.get(event)?.delete(handler as Handler<unknown[]>);
  }

  // Emit an event
  emit<K extends keyof E>(event: K, ...args: E[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as Handler<E[K]>)(...args);
      } catch (err) {
        console.error(`[GameBoy] event "${String(event)}" listener failed:`, err);
      }
    }
  }

  // Clear all listeners
  clear(): void {
    this.listeners.clear();
  }
}
