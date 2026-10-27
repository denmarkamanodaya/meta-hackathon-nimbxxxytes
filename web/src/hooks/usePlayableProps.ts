// Player props with each shot's clip URL passed through the composed MediaResolver, so the Mac app's
// Remotion preview reads synced proxies from ~/nimbytes. The PWA resolver keeps every cloud URL, so
// there the props come back unchanged (same object).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ShortProps } from '@nimbytes/composition';
import type { ShortSegment } from '../services/api/types';
import { useServices } from './services-context';

/** A finished lookup per clip id: the local URL, or null when the cloud URL stays. */
type Lookups = ReadonlyMap<string, string | null>;

interface ClipRef {
  clipId: string;
  cloudUrl: string;
}

function clipRefs(props: ShortProps | null, clipOf: ReadonlyMap<string, string>): ClipRef[] {
  if (props === null) return [];
  const refs = new Map<string, ClipRef>();
  for (const clip of props.clips) {
    const clipId = clipOf.get(clip.segment_id);
    if (clipId !== undefined && clip.src_url !== null) refs.set(clipId, { clipId, cloudUrl: clip.src_url });
  }
  return [...refs.values()];
}

/**
 * Resolves the shots' proxy URLs once per clip (a draft edit does not look them up again).
 * @param props - Player props, or null (no Player).
 * @param segments - The short's candidate segments (segment id to clip id).
 * @returns The props with local URLs where synced; null while the Mac app is still looking them
 *   up, so the Player never starts on the cloud copy first.
 */
export function usePlayableProps(props: ShortProps | null, segments: readonly ShortSegment[]): ShortProps | null {
  const { media } = useServices();
  const clipOf = useMemo(() => new Map(segments.map((s) => [s.segment_id, s.clip_id])), [segments]);
  const [lookups, setLookups] = useState<Lookups>(new Map());
  const inFlight = useRef(new Set<string>());
  const refs = useMemo(() => clipRefs(props, clipOf), [props, clipOf]);

  useEffect(() => {
    for (const ref of refs) {
      if (lookups.has(ref.clipId) || inFlight.current.has(ref.clipId)) continue;
      inFlight.current.add(ref.clipId);
      void media.resolve({ kind: 'proxy', id: ref.clipId, cloudUrl: ref.cloudUrl }).then((url) => {
        inFlight.current.delete(ref.clipId);
        setLookups((current) => new Map(current).set(ref.clipId, url === ref.cloudUrl ? null : url));
      });
    }
  }, [media, refs, lookups]);

  return useMemo(() => {
    if (props === null) return null;
    // undefined = the Mac app is still looking this shot up.
    const srcOf = (clip: ShortProps['clips'][number]): string | null | undefined => {
      const clipId = clipOf.get(clip.segment_id);
      if (clipId === undefined || clip.src_url === null) return clip.src_url;
      const looked = lookups.get(clipId);
      if (looked !== undefined) return looked ?? clip.src_url;
      return media.immediate({ kind: 'proxy', id: clipId, cloudUrl: clip.src_url }) ?? undefined;
    };
    const srcs = props.clips.map(srcOf);
    if (srcs.includes(undefined)) return null;
    if (srcs.every((src, i) => src === props.clips[i]?.src_url)) return props;
    return { ...props, clips: props.clips.map((clip, i) => ({ ...clip, src_url: srcs[i] ?? null })) };
  }, [props, clipOf, lookups, media]);
}
