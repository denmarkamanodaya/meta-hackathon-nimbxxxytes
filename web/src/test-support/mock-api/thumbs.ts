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

/**
 * A 9:16 cutout cover: a title, and a person in front of it over a scene or a blurred frame.
 * @param id - Cover id (picks the hue).
 * @param background - `scene` (a flat drawn scene) or `blur` (a soft blurred frame).
 * @returns An SVG data URL.
 */
export function cutoutCover(id: string, background: 'scene' | 'blur'): string {
  const hue = hueOf(id);
  const ground =
    background === 'scene'
      ? `<rect width="270" height="480" fill="hsl(190 85% 28%)"/><path d="M0 330 Q120 280 270 320 V480 H0z" fill="hsl(190 60% 20%)"/>`
      : `<defs><filter id="b"><feGaussianBlur stdDeviation="12"/></filter></defs>` +
        `<g filter="url(#b)"><rect width="270" height="480" fill="hsl(${String(hue)} 25% 40%)"/>` +
        `<circle cx="70" cy="140" r="60" fill="hsl(${String(hue)} 30% 60%)"/></g>`;
  return toDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">${ground}` +
      `<text x="20" y="90" font-family="sans-serif" font-weight="700" font-size="40" fill="white">SIXTY AND</text>` +
      `<text x="20" y="132" font-family="sans-serif" font-weight="700" font-size="40" fill="white">SHINING</text>` +
      `<ellipse cx="135" cy="215" rx="46" ry="54" fill="hsl(25 45% 72%)"/>` +
      `<path d="M50 480 Q60 280 135 270 Q210 280 220 480z" fill="hsl(25 45% 72%)"/>` +
      `<path d="M75 480 Q85 380 135 370 Q185 380 195 480z" fill="hsl(35 30% 90%)"/>` +
      `</svg>`,
  );
}

/**
 * A cut-out object on a transparent ground, with an optional white sticker outline.
 * @param label - What was cut out (picks the hue).
 * @param isSticker - Draw the white outline.
 * @returns An SVG data URL.
 */
export function cutoutImage(label: string, isSticker: boolean): string {
  const hue = hueOf(label);
  const outline = isSticker ? ` stroke="white" stroke-width="12" stroke-linejoin="round" paint-order="stroke"` : '';
  return toDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260">` +
      `<path d="M60 200 Q40 120 90 110 Q100 60 140 70 Q180 60 190 110 Q230 130 210 200 Q200 225 135 225 Q70 225 60 200z" fill="hsl(${String(hue)} 40% 55%)"${outline}/>` +
      `</svg>`,
  );
}
