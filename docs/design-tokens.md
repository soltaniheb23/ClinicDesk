# Design tokens

ClinicDesk uses a calm, warm palette so clinic staff can work in it all day
without glare, while keeping every piece of text at WCAG AA contrast or better.
The tokens are defined as CSS custom properties in
[`client/src/tokens.css`](../client/src/tokens.css).

## Palette

| Token | Hex | Use |
|---|---|---|
| `--color-cream` | `#EBEBD8` | Page background |
| `--color-paper` | `#F6F6EA` | Cards |
| `--color-olive` | `#455230` | Text, top bar |
| `--color-green` | `#637545` | Primary buttons (white text), input borders |
| `--color-sage` | `#9BA685` | Decorative borders only, never text |

**Rationale:** cream and paper are close in tone, so cards stand out by a soft
step rather than a hard white block. Olive is dark enough for body text, and
green is reserved for the one action you should notice on each screen. Sage is
too light for text and is only used for borders and dividers.

## Status and priority colors

Each badge uses a light tint background with dark text of the same hue.

| Badge | Background | Text | Contrast |
|---|---|---|---|
| Open | `#DCE2EA` | `#3B4A5E` | 6.92 |
| In progress | `#D5DEC6` | `#364228` | 7.67 |
| Waiting | `#F3E2B8` | `#6B4A00` | 6.29 |
| Normal priority | `#DCE2EA` | `#3B4A5E` | 6.92 |
| High priority | `#F3E2B8` | `#6B4A00` | 6.29 |
| Urgent priority | `#F2D3CC` | `#8A2B1B` | 6.13 |

Open and normal share the neutral blue-grey; waiting and high share amber.
Badges always carry a text label, so color is never the only signal.

## Feedback colors

| Token | Value | Use |
|---|---|---|
| `--color-error-bg` | `#F2D3CC` (urgent tint) | Form error area background |
| `--color-error-text` | `#8A2B1B` (urgent text) | Error text and invalid-field borders |

Errors reuse the urgent tint (6.13:1) so the palette stays small.

## Spacing and shape

Spacing follows a 4px scale: `--space-1` (4px), `--space-2` (8px), `--space-3`
(12px), `--space-4` (16px), `--space-5` (24px), `--space-6` (32px), `--space-7`
(48px). Corners use `--radius-sm` (8px, inputs and buttons) and `--radius-md`
(12px, cards). `--size-touch-target` (44px) is the minimum height of buttons and
inputs (WCAG 2.5.5).

## Typography

| Role | Family | Weights | Token |
|---|---|---|---|
| Headings | Fraunces | 700 | `--font-heading` |
| Body | DM Sans | 400, 500, 700 | `--font-body` |

Both fonts are self-hosted through the `@fontsource/fraunces` and
`@fontsource/dm-sans` npm packages, so no requests go to a third-party font
CDN.

## Contrast ratios

WCAG AA needs 4.5:1 for body text and 3:1 for large text and UI components.

| Pair | Ratio | Rule |
|---|---|---|
| Olive on cream | 6.96 | OK for all text |
| White on green | 5.05 | OK for button labels |
| Green on cream | 4.18 | Large text, borders and icons only, not body text |
| Sage on cream | 2.13 | Decorative only, never text |
