// Pure mapping from a commander color identity to a deck banner style.
// No React, no D1, no fs.

import { WUBRG_ORDER, type ColorIdentity, type WUBRG } from "./color-identity";

/** Banner swatch per color, tuned to stay visible on the dark UI. */
export const BANNER_COLORS: Readonly<Record<WUBRG, string>> = {
  W: "#efe6c8",
  U: "#3b7bc4",
  B: "#5b4f66",
  R: "#d0503a",
  G: "#3f9a55",
};

/** Colorless commanders (empty identity) get brown. */
export const COLORLESS_BANNER = "#8a6440";

const COLOR_NAMES: Readonly<Record<WUBRG, string>> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

export type DeckBanner = { background: string; label: string };

/**
 * Banner for a resolved commander identity.
 * - undefined (no commander) -> null: no banner.
 * - empty set (colorless)    -> solid brown.
 * - one color                -> solid swatch.
 * - several colors           -> equal hard-edged stripes in WUBRG order.
 */
export function deckBanner(identity: ColorIdentity | undefined): DeckBanner | null {
  if (identity === undefined) return null;
  const colors = WUBRG_ORDER.filter((c) => identity.has(c));
  if (colors.length === 0) {
    return { background: COLORLESS_BANNER, label: "Color identity: Colorless" };
  }
  const label = `Color identity: ${colors.map((c) => COLOR_NAMES[c]).join(", ")}`;
  if (colors.length === 1) return { background: BANNER_COLORS[colors[0]], label };
  const step = 100 / colors.length;
  const stops = colors.map((c, i) => {
    const from = +(i * step).toFixed(4);
    const to = +((i + 1) * step).toFixed(4);
    return `${BANNER_COLORS[c]} ${from}% ${to}%`;
  });
  return { background: `linear-gradient(90deg, ${stops.join(", ")})`, label };
}
