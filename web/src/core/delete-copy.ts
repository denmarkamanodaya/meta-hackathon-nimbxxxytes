// What the delete confirm sheets say (mocks V3/V4).

/** The words of one confirm sheet. */
export interface DeleteCopy {
  title: string;
  body: string;
  confirmLabel: string;
}

/**
 * The clip delete sheet for one clip or several.
 * @param titles - Titles of the clips to delete, at least one.
 * @returns Title, body and the red button's label.
 */
export function clipDeleteCopy(titles: readonly string[]): DeleteCopy {
  if (titles.length === 1) {
    return {
      title: 'Delete this clip?',
      body: `“${titles[0] ?? ''}” and its moments, faces and transcript are removed from nimbytes on every device. Shorts that used it keep their render but can’t be re-cut with it. This can’t be undone.`,
      confirmLabel: 'Delete clip',
    };
  }
  const n = String(titles.length);
  return {
    title: `Delete ${n} clips?`,
    body: `These ${n} clips and their moments, faces and transcripts are removed from nimbytes on every device. Shorts that used them keep their render but can’t be re-cut with them. This can’t be undone.`,
    confirmLabel: `Delete ${n} clips`,
  };
}

/** The short delete sheet. */
export const SHORT_DELETE_COPY: DeleteCopy = {
  title: 'Delete this short?',
  body: 'Its drafts and render are removed. The clips it used stay.',
  confirmLabel: 'Delete short',
};

/** The guide delete confirm (MyWay; the PWA sheet and the Mac dialog). */
export const GUIDE_DELETE_COPY: DeleteCopy = {
  title: 'Delete guide?',
  body: 'The steps, pictures and voice are removed. The clip stays in your library.',
  confirmLabel: 'Delete guide',
};
