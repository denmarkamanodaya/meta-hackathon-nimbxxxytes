import { describe, expect, it } from 'vitest';
import { isPhotoFile, photoFileProblem, photoResultLine, photoSubLine, photoTileLine, photoType, photoUploadCard, splitPicked, takenLine } from './photos';

describe('photo files', () => {
  it('types a photo by its own type or, when the picker left none, its extension', () => {
    expect(photoType('a.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(photoType('IMG_1.HEIC', '')).toBe('image/heic');
    expect(photoType('a.gif', 'image/gif')).toBeNull();
    expect(photoType('clip.mov', 'video/quicktime')).toBeNull();
  });

  it('sends images to photos and the rest to the clip upload, in pick order', () => {
    const files = [
      { name: 'a.mov', type: 'video/quicktime' },
      { name: 'b.jpg', type: 'image/jpeg' },
      { name: 'c.HEIC', type: '' },
      { name: 'd.mp4', type: '' },
    ];

    expect(splitPicked(files)).toEqual({ photos: [files[1], files[2]], videos: [files[0], files[3]] });
    expect(isPhotoFile({ name: 'x.gif', type: 'image/gif' })).toBe(true);
    expect(photoFileProblem({ name: 'x.gif', type: 'image/gif', size: 1 })).toContain('JPEG');
    expect(photoFileProblem({ name: 'x.jpg', type: 'image/jpeg', size: 40 * 1024 * 1024 + 1 })).toBe('This photo is over 40 MB.');
  });
});

describe('photo words', () => {
  const photo = {
    filename: '_MG_4210.JPG',
    taken_at: '2026-08-19T08:42:00Z',
    created_at: '2026-10-30T11:00:00Z',
    width: 6000,
    height: 4000,
    size_bytes: 9_437_184,
    camera: 'Canon EOS',
  };

  it('writes the panel line, the tile line and a search result line as the mock does', () => {
    expect(photoSubLine(photo, 'UTC')).toBe('_MG_4210.JPG · 19 Aug 2026, 8:42 AM · 6000 × 4000 · 9.4 MB · Canon EOS');
    expect(photoSubLine({ ...photo, width: null, height: null, camera: null, taken_at: null }, 'UTC')).toBe('_MG_4210.JPG · 9.4 MB');
    expect(photoTileLine(photo, 'UTC')).toBe('19 Aug 2026 · Photo');
    expect(photoTileLine({ ...photo, taken_at: null }, 'UTC')).toBe('30 Oct 2026 · Photo');
    expect(photoResultLine({ clip_filename: '_MG_4210.JPG', recorded_at: photo.taken_at }, 'UTC')).toBe('_MG_4210 · 19 Aug 2026');
    expect(takenLine(null)).toBe('');
  });

  it('shows the upload card only while photos go up', () => {
    expect(photoUploadCard(7, 12)).toEqual({ title: 'Uploading 12 photos', line: '7 of 12 · then nimbytes looks at each one', percent: 58 });
    expect(photoUploadCard(0, 1)?.title).toBe('Uploading 1 photo');
    expect(photoUploadCard(12, 12)).toBeNull();
    expect(photoUploadCard(0, 0)).toBeNull();
  });
});
