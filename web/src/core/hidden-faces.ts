// The Finish screen's privacy line: how many faces hidden in People appear in this short's shots.

/**
 * "3 hidden faces across 4 shots".
 * @param hiddenClipIds - The clip of every face hidden in People (one entry per face).
 * @param shotClipIds - The clip of every shot of the cut, in cut order.
 * @returns The line.
 */
export function hiddenFacesLine(hiddenClipIds: readonly string[], shotClipIds: readonly string[]): string {
  const inCut = new Set(shotClipIds);
  const faces = hiddenClipIds.filter((clip) => inCut.has(clip)).length;
  if (faces === 0) return 'No hidden faces in this short';
  const withFaces = new Set(hiddenClipIds);
  const shots = shotClipIds.filter((clip) => withFaces.has(clip)).length;
  const faceWord = faces === 1 ? 'hidden face' : 'hidden faces';
  const shotWord = shots === 1 ? 'shot' : 'shots';
  return `${String(faces)} ${faceWord} across ${String(shots)} ${shotWord}`;
}
