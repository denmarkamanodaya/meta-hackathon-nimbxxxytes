// Props of the NimbytesShort composition. The wire shape is owned by the Rust props builder
// (api/crates/contracts); this Zod schema validates it, and both sides test against
// fixtures/props.sample.json.
import { z } from 'zod';

const seconds = z.number().nonnegative();

/** One word of a phrase caption and when it is said, in seconds on the source clip. */
export const CaptionWordSchema = z.object({ text: z.string().min(1), at_s: seconds });

/**
 * One phrase caption (3–5 words). Times are seconds on the SOURCE clip, not the output, so a
 * reorder or trim in the editor moves captions with their shot without a server round trip.
 */
export const CaptionSchema = z
  .object({ start_s: seconds, end_s: seconds, text: z.string().min(1), words: z.array(CaptionWordSchema) })
  .refine((caption) => caption.end_s > caption.start_s, { message: 'end_s must be after start_s' });

/** One shot: a trimmed part of a source video, its crop zoom, and its captions. */
export const ShortClipSchema = z
  .object({
    segment_id: z.string().min(1),
    /** Presigned proxy (preview) or original (final) URL; null draws a gradient placeholder. */
    src_url: z.string().min(1).nullable(),
    in_s: seconds,
    out_s: seconds,
    /** Zoom over the cover crop, 1.0 = none. */
    punch_in: z.number().min(1).max(3),
    subject: z.string().nullable(),
    /** Phrases spoken in this segment, in source seconds; may extend beyond in/out. */
    captions: z.array(CaptionSchema),
  })
  .refine((clip) => clip.out_s > clip.in_s, { message: 'out_s must be after in_s' });

/** Everything the composition needs to draw one short. */
export const ShortPropsSchema = z.object({
  aspect: z.enum(['4:5', '1:1']),
  fps: z.literal(30),
  clips: z.array(ShortClipSchema).min(1),
  post: z.object({ caption: z.string(), hashtags: z.array(z.string()) }),
  /** Seconds of the closing card with the post caption; 0 for none. */
  end_card_s: z.number().min(0).max(3),
  theme: z.object({
    /** Brand accent, `#rrggbb`. */
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** CSS font-family stack. */
    font: z.string().min(1),
  }),
});

/** Props of NimbytesShort. */
export type ShortProps = z.infer<typeof ShortPropsSchema>;
/** One shot of a short. */
export type ShortClip = z.infer<typeof ShortClipSchema>;
/** One phrase caption. */
export type Caption = z.infer<typeof CaptionSchema>;
/** Output frame of a short. */
export type ShortAspect = ShortProps['aspect'];
