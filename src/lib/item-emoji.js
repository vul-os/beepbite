// item-emoji.js — shared emoji helper used by both the POS workspace and the
// Menu page so item icons stay in sync across the app.

export const ITEM_EMOJI = [
  { match: /burger|patty/i, e: '🍔' },
  { match: /pizza/i, e: '🍕' },
  { match: /fries|chips/i, e: '🍟' },
  { match: /chicken|wing/i, e: '🍗' },
  { match: /salad/i, e: '🥗' },
  { match: /pasta|noodle/i, e: '🍜' },
  { match: /coffee|latte/i, e: '☕' },
  { match: /tea/i, e: '🍵' },
  { match: /beer/i, e: '🍺' },
  { match: /wine/i, e: '🍷' },
  { match: /coke|cola|soda|sprite/i, e: '🥤' },
  { match: /water/i, e: '💧' },
  { match: /juice/i, e: '🧃' },
  { match: /cake|brownie|cupcake/i, e: '🍰' },
  { match: /ice cream/i, e: '🍨' },
  { match: /donut/i, e: '🍩' },
  { match: /cookie/i, e: '🍪' },
];
export const emojiFor = (it) => ITEM_EMOJI.find((x) => x.match.test(it?.name || ''))?.e || '🍽️';
