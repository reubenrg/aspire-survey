/**
 * Pure validation for customer branding (Part 12/19). Brand colour and logo
 * URL are free-text fields backing an inline CSS value and an <img src> in
 * the admin UI - rejecting garbage here keeps both usable rather than
 * silently invisible, and out of caution against being fed something like
 * a javascript: URL even though browsers already refuse that in <img src>.
 */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value.trim());
}

export function isValidLogoUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true; // logo is optional
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || url.protocol === 'http:';
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const [rl, gl, bl] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG 2.x contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The brand colour is used as a small swatch/accent against a white admin
 * background, not as text - so this uses WCAG's non-text minimum (3:1)
 * rather than the 4.5:1 text threshold. A fail here is a warning, not a
 * block: an unusually pale brand colour is still a legitimate choice.
 */
export function hasSufficientContrast(hex: string, backgroundHex = '#ffffff', minRatio = 3): boolean {
  return contrastRatio(hex, backgroundHex) >= minRatio;
}
