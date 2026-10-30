// Dragging Gallery entries onto a segment (redesign v2): tiles and rows carry their Gallery ids (a
// clip id, or `listen:`, `doc:`, `photo:` ids) in a private drag type, and the sidebar's segments
// and the segment page's "Drag items here" box read them.
import { useState, type DragEvent } from 'react';

/** The drag data type that marks a nimbytes clip drag. */
export const CLIP_DRAG_TYPE = 'application/x-nimbytes-clips';

/** The parts of `DataTransfer` the helpers use. */
export interface DragData {
  readonly types: readonly string[];
  getData(format: string): string;
  setData(format: string, data: string): void;
  effectAllowed: DataTransfer['effectAllowed'];
}

/**
 * Puts the Gallery ids on a drag.
 * @param data - The drag's `dataTransfer`.
 * @param clipIds - The Gallery ids dragged.
 */
export function writeClipDrag(data: DragData, clipIds: readonly string[]): void {
  data.setData(CLIP_DRAG_TYPE, JSON.stringify(clipIds));
  data.effectAllowed = 'copy';
}

/**
 * Whether a drag carries clips (readable while dragging over, before the drop).
 * @param data - The drag's `dataTransfer`.
 * @returns True for a clip drag.
 */
export const isClipDrag = (data: DragData): boolean => data.types.includes(CLIP_DRAG_TYPE);

/** A drop target's state and the handlers to spread on it. */
export interface ClipDrop {
  isOver: boolean;
  handlers: {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
  };
}

/**
 * Makes an element take clip drags.
 * @param onClips - Called with the dropped Gallery ids.
 * @returns Whether a clip drag is over it, and its handlers.
 */
export function useClipDrop(onClips: (clipIds: string[]) => void): ClipDrop {
  const [isOver, setOver] = useState(false);
  return {
    isOver,
    handlers: {
      onDragOver: (event) => {
        if (!isClipDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      },
      onDragLeave: () => {
        setOver(false);
      },
      onDrop: (event) => {
        setOver(false);
        const ids = readClipDrag(event.dataTransfer);
        if (ids.length === 0) return;
        event.preventDefault();
        onClips(ids);
      },
    },
  };
}

/**
 * Reads the Gallery ids of a drop.
 * @param data - The drop's `dataTransfer`.
 * @returns The ids; empty for anything else or a malformed payload.
 */
export function readClipDrag(data: DragData): string[] {
  try {
    const value: unknown = JSON.parse(data.getData(CLIP_DRAG_TYPE));
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return []; // Recovers: a foreign or empty drop adds nothing.
  }
}
