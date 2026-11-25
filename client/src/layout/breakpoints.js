// Layout breakpoints (docs/design-tokens.md, "Breakpoints and responsive rules").
// CSS cannot read custom properties inside @media, so every stylesheet writes these same
// two values; src/layout/breakpoints.test.js fails if a stylesheet uses any other.
// They are in em so they follow the user's default text size and browser zoom: with larger
// text, the phone or tablet layout starts earlier.
export const BREAKPOINTS = Object.freeze({
  tablet: '40em', // 640px at the default 16px text size
  desktop: '64em', // 1024px
});

export const MEDIA = Object.freeze({
  tablet: `(min-width: ${BREAKPOINTS.tablet})`,
  desktop: `(min-width: ${BREAKPOINTS.desktop})`,
});
