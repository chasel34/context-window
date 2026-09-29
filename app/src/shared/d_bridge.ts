// Bridge handoffs (s09 compress → s10 bullet list → s11 oracle). The whole chat history of s09 is
// pressed into one line; s10 opens on exactly that line and unfolds it into a face. Both scenes read
// this constant so the hard cut between them lands on the same pixels.
export const BRIDGE_LINE = {
  x0: 460,
  x1: 1460,
  y: 540,
  /** Stroke width (logical px). */
  width: 3.5,
} as const;

/**
 * The select-all highlight shared by s08's exit and s09's opening (one continuous action across the cut):
 * bone bars at partial alpha behind the selected text, which turns ink. No blue: the film's only
 * off-palette accent is s07's green ✓.
 */
export const SELECT_ALPHA = 0.82;
