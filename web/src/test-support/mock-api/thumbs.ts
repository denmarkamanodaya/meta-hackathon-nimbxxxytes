// Placeholder images for mock mode: soft gradient SVGs as data URLs, so no binary file is
// committed. The hue comes from the id, so the same scene always gets the same picture.

function hueOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

const toDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * A 3:4 scene thumbnail.
 * @param id - Segment or clip id.
 * @returns An SVG data URL.
 */
export function sceneThumb(id: string): string {
  const hue = hueOf(id);
  const second = (hue + 50) % 360;
  return toDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="hsl(${String(hue)} 55% 62%)"/>` +
      `<stop offset="1" stop-color="hsl(${String(second)} 60% 32%)"/></linearGradient></defs>` +
      `<rect width="300" height="400" fill="url(#g)"/>` +
      `<circle cx="210" cy="120" r="46" fill="hsl(${String(hue)} 80% 88% / 0.55)"/>` +
      `<path d="M0 300 Q90 240 170 290 T300 270 V400 H0z" fill="hsl(${String(second)} 45% 20% / 0.5)"/>` +
      `</svg>`,
  );
}

/**
 * A square face crop placeholder: a head-and-shoulders silhouette.
 * @param id - Track id.
 * @returns An SVG data URL.
 */
export function faceCrop(id: string): string {
  const hue = hueOf(id);
  return toDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
      `<rect width="120" height="120" fill="hsl(${String(hue)} 45% 70%)"/>` +
      `<circle cx="60" cy="48" r="22" fill="hsl(${String(hue)} 35% 92%)"/>` +
      `<path d="M20 120 Q24 80 60 78 Q96 80 100 120z" fill="hsl(${String(hue)} 35% 92%)"/>` +
      `</svg>`,
  );
}
