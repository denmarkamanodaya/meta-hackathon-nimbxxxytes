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

const share = z.number().min(0).max(1);

/** A face at one second of its clip, as shares (0–1) of the upright source frame. */
export const FaceBoxSchema = z.object({ t_s: seconds, x: share, y: share, w: share, h: share });

/** One hidden face in the shots of one segment: its boxes in clip seconds, in time order. */
export const BlurSchema = z.object({
  segment_id: z.string().min(1),
  /** Width / height of the upright source, so the boxes follow the cover crop. */
  aspect: z.number().positive(),
  boxes: z.array(FaceBoxSchema).min(1),
});

/** The brand look every composition draws with. */
export const ThemeSchema = z.object({
  /** Brand accent, `#rrggbb`. */
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** CSS font-family stack. */
  font: z.string().min(1),
});

/** Everything the composition needs to draw one short. */
export const ShortPropsSchema = z.object({
  aspect: z.enum(['4:5', '1:1']),
  fps: z.literal(30),
  clips: z.array(ShortClipSchema).min(1),
  post: z.object({ caption: z.string(), hashtags: z.array(z.string()) }),
  /** Seconds of the closing card with the post caption; 0 for none. */
  end_card_s: z.number().min(0).max(3),
  theme: ThemeSchema,
  /** Faces hidden in People, blurred wherever their segment plays; absent means none. */
  blur: z.array(BlurSchema).optional(),
  /** Export frame when it differs from `aspect` (a 9:16 platform export); absent for the short. */
  export_aspect: z.enum(['4:5', '1:1', '9:16']).optional(),
});

/** Props of NimbytesShort. */
export type ShortProps = z.infer<typeof ShortPropsSchema>;
/** One shot of a short. */
export type ShortClip = z.infer<typeof ShortClipSchema>;
/** One phrase caption. */
export type Caption = z.infer<typeof CaptionSchema>;
/** One face box. */
export type FaceBox = z.infer<typeof FaceBoxSchema>;
/** One hidden face in one segment. */
export type Blur = z.infer<typeof BlurSchema>;
/** Output frame of a short. */
export type ShortAspect = ShortProps['aspect'];
/** The frame a render draws: the short's own, or an export's (which adds 9:16). */
export type FrameAspect = ShortAspect | NonNullable<ShortProps['export_aspect']>;
