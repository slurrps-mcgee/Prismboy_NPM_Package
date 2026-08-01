export enum Button {
  Right = 0,
  Left = 1,
  Up = 2,
  Down = 3,
  A = 4,
  B = 5,
  Select = 6,
  Start = 7,
}

/** Default keyboard → button map (KeyboardEvent.code) */
export const DEFAULT_KEYBOARD_MAPPING: Record<string, Button> = {
  ArrowRight: Button.Right,
  ArrowLeft: Button.Left,
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  KeyZ: Button.A,
  KeyX: Button.B,
  ShiftRight: Button.Select,
  ShiftLeft: Button.Select,
  Enter: Button.Start,
};
