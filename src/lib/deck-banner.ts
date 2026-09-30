// Pure mapping from a commander color identity to a deck row background.
// No React, no D1, no fs.

import { WUBRG_ORDER, type ColorIdentity, type WUBRG } from "./color-identity";

/**
 * Background tone per color: the fills of the mana symbols printed on Magic
 * cards. All five are light, so the row's dark text keeps at least 7:1
 * contrast anywhere along the gradient.
 */
export const BANNER_COLORS: Readonly<Record<WUBRG, string>> = {
  W: "#fffbd5",
  U: "#aae0fa",
  B: "#cbc2bf",
  R: "#f9aa8f",
  G: "#9bd3ae",
};

/** Colorless commanders (empty identity) get a light brown in the same family. */
export const COLORLESS_BANNER = "#c9a57e";

/** Direction of the multicolor gradient. */
export const GRADIENT_ANGLE = "45deg";

const COLOR_NAMES: Readonly<Record<WUBRG, string>> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

export type DeckBanner = { background: string; label: string };

/**
 * Row background for a resolved commander identity.
 * - undefined (no commander) -> null: default row styling.
 * - empty set (colorless)    -> solid brown.
 * - one color                -> solid tone.
 * - several colors           -> smooth 45deg gradient in WUBRG order with the
 *                               color stops spaced evenly from 0% to 100%.
 */
export function deckBanner(identity: ColorIdentity | undefined): DeckBanner | null {
  if (identity === undefined) return null;
  const colors = WUBRG_ORDER.filter((c) => identity.has(c));
  if (colors.length === 0) {
    return { background: COLORLESS_BANNER, label: "Color identity: Colorless" };
  }
  const label = `Color identity: ${colors.map((c) => COLOR_NAMES[c]).join(", ")}`;
  if (colors.length === 1) return { background: BANNER_COLORS[colors[0]], label };
  const last = colors.length - 1;
  const stops = colors.map((c, i) => `${BANNER_COLORS[c]} ${+((i / last) * 100).toFixed(4)}%`);
  return { background: `linear-gradient(${GRADIENT_ANGLE}, ${stops.join(", ")})`, label };
}
