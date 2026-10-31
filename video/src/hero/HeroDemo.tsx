// NimbytesHeroDemo: the demo told through one person, Eric (61), scene by scene as the approved
// hero script (scenes 0–11). White pages (Roboto, ink text) for the disclosure, the nimbytes card,
// the models and the close; real captures, full frame, for the features (CaptureFilm, the same cuts
// as the feature films, trimmed to this voice-over). No tilts, no pans: static framings or a slow
// push-in. Voice-over: src/hero/vo-lines.json (Kokoro bf_emma, 1.1×) in public/audio/hero-vo.
// Background music as in FinalProductDemo.
import type { ReactNode } from 'react';
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, Series, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { wordsOf } from '../captions';
import { CaptureFilm, filmFrames, type Cut, type Frame, type Head } from '../components/CaptureFilm';
import { Logo } from '../components/Logo';
import { META_MODELS, META_MODELS_SOURCE } from '../components/metaModels';
import { countUp, riseStyle, useEnter, useZoomFade } from '../components/motion';
import { placeLines, type VoLine, type VoSpacing } from '../components/voTiming';
import { SEARCH_CARD_FRAMES, SearchCard } from '../filesystem/SearchCard';
import { USES_FRAMES, UsesEnd } from '../iguide/IGuide';
import { SEARCH_RESULTS_FRAMES, SearchResults } from '../filesystem/Searches';
import { DISPLAY, ROBOTO } from '../fonts';
import { MeetScene } from '../intro/MeetScene';
import { COLOR, NIGHT } from '../theme';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

const FPS = 30;
/** The app's own dark background (behind films while they zoom in). */
const APP_BG = '#141414';
// Footage is the original captures, not face-blurred (owner ruling, v3; scripts/blur-faces.swift
// stays in the repo, unused).
const VO_DIR = 'audio/hero-vo';
const ERIC = 'hero/eric.jpg';
const MUSE_CREDIT = 'Images: Meta Muse Image (AI-generated)';
/** Background music level under the voice (as FinalProductDemo). */
const BGM_LEVEL = 0.25;
/**
 * The film runs exactly as long as the music (public/audio/bgm-final.mp3, 136.05 s; owner ruling):
 * it plays from the start to its own end, with a short fade-in and no fade-out. The close takes
 * whatever time the scenes before it leave (CLOSE_FRAMES).
 */
const HERO_TOTAL_FRAMES = 136 * 30;

/** One scene's voice lines, by id, placed with its spacing. */
const vo = (ids: readonly string[], spacing: VoSpacing) => placeLines(lines.filter((line) => ids.includes(line.id)), generated, spacing);

function Voice({ lines: placed }: { lines: readonly VoLine[] }) {
  return (
    <>
      {placed.map((line) => (
        <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
          <Audio src={staticFile(`${VO_DIR}/${line.id}.wav`)} />
        </Sequence>
      ))}
    </>
  );
}

/** Plain text on the white page: Roboto light, ink. */
const PAGE_TEXT = { fontFamily: ROBOTO, fontWeight: 300, color: COLOR.ink } as const;

/** A small credit, bottom right. `light` for use over a photo or footage. */
function Credit({ children, light = false }: { children: string; light?: boolean }) {
  return (
    <div style={{ position: 'absolute', right: 48, bottom: 36, fontFamily: ROBOTO, fontWeight: 300, fontSize: 22, color: light ? COLOR.white : COLOR.inkSoft, textShadow: light ? '0 1px 8px rgba(0,0,0,0.8)' : 'none', opacity: useEnter(6) }}>{children}</div>
  );
}

/** A placed line's words, timed across it (captions.ts), for motion cued to the voice. */
const wordsIn = (line: VoLine | undefined) => (line === undefined ? [] : wordsOf({ ...line, scene: 'uses' }));
/** The frame the voice reaches the `n`-th word starting with `cue` (0 when not found). */
const cueAt = (line: VoLine | undefined, cue: string, n = 0) => wordsIn(line).filter((word) => word.text.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(cue))[n]?.from ?? 0;

/** Eric's headline for a feature scene: two tones, word by word (CaptureFilm `heads`). */
const ericHead = (first: string, second: string, from = 4): Head[] => [{ first, second, from }];

/**
 * The white-page entrance (motion.useZoomFade) used as the transition between the white pages and
 * the films: the scene fades in while settling from 125 % to place, over `bg`.
 */
function ZoomIn({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: bg, overflow: 'hidden' }}>
      <AbsoluteFill style={useZoomFade(0)}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
}

/** A slow push-in: 100% to `to` over the scene. */
const usePush = (frames: number, to = 1.06) => {
  const frame = useCurrentFrame();
  return `scale(${String(interpolate(frame, [0, frames], [1, to], { extrapolateRight: 'clamp' }))})`;
};

// 0. The disclosure (required first line).
// Timing rule (owner, 2026-10-31): no dead air. Each scene ends about 0.2 s after its last voice
// line (or the app's own read-aloud) and the next starts its line about 0.3 s in, so silences
// between lines stay near 0.5 s. Holds that matter (Get Info, results) run under the voice.
const S0 = vo(['h0'], { min: 0, lead: 0.5, gap: 0, tail: 0.2 });
function Disclosure() {
  return (
    <AbsoluteFill style={{ background: COLOR.white, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...PAGE_TEXT, fontSize: 44, opacity: useEnter(4) }}>Everything in nimbytes was built from scratch during this hackathon.</div>
      <Voice lines={S0.lines} />
    </AbsoluteFill>
  );
}

// 1. Eric, a still photo with a slow push-in.
// A longer hold on Eric (music carries it; silences mid-film stay at 1.5 s or less).
const S1 = vo(['h1'], { min: 0, lead: 0.3, gap: 0, tail: 1.2 });
function Eric() {
  return (
    <AbsoluteFill style={{ background: COLOR.ink, overflow: 'hidden' }}>
      <Img src={staticFile(ERIC)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: usePush(S1.durationInFrames) }} />
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: 900, height: 360, background: 'radial-gradient(ellipse at 0% 100%, rgba(5,8,10,0.6) 0%, transparent 70%)' }} />
      <div style={{ position: 'absolute', left: 96, bottom: 96, fontFamily: ROBOTO, fontWeight: 300, fontSize: 72, color: COLOR.white, textShadow: '0 2px 12px rgba(0,0,0,0.6)', opacity: useEnter(12) }}>Eric, 61</div>
      <Credit light>{MUSE_CREDIT}</Credit>
      <Voice lines={S1.lines} />
    </AbsoluteFill>
  );
}

// 2. The family's footage: a Muse Image venue still (no real business names or signs anywhere),
// then cuts from the owner's own 60th birthday video, cropped out of the nimbytes player with its
// controls and captions cropped off, and the library's gallery. The line starts 1.2 s in and the
// last word holds 2.4 s over the footage (owner, v5: a longer montage).
const S2 = vo(['h2'], { min: 0, lead: 1.2, gap: 0, tail: 2.4 });
const VENUE = 'hero/venue.jpg';
/** A clip, its pixel size, where the video sits in it (px) and the second to start from; or a still. */
const MONTAGE = [
  // The venue from outside: Muse Image (AI-generated), no text or signs.
  { clip: VENUE, still: true, srcW: 1920, crop: { x: 0, y: 0, w: 1920 }, fromS: 0 },
  // The couple walking in (player; the hover thumbnail bottom left cropped off).
  { clip: 'raw/play.mp4', srcW: 2560, crop: { x: 860, y: 128, w: 932 }, fromS: 7.6 },
  // Kristoff's speech by the flower wall (player, above its captions).
  { clip: 'raw/kristoff-play.mp4', srcW: 2560, crop: { x: 680, y: 165, w: 940 }, fromS: 6.0 },
  // The gallery: concerts and a temple trip, rows of clips (above the search box's status line).
  { clip: 'raw/who.mp4', srcW: 2560, crop: { x: 296, y: 520, w: 1240 }, fromS: 0.1 },
  // A song at the mic (player, above its captions; the hover thumbnail right cropped off).
  { clip: 'live/zero-play.mp4', srcW: 2560, crop: { x: 820, y: 140, w: 860 }, fromS: 14.5 },
  // The dance floor (player).
  { clip: 'live/irecall-play.mp4', srcW: 3840, crop: { x: 918, y: 201, w: 1776 }, fromS: 0.5 },
] as const;
const MONTAGE_DISSOLVE = 10;
const MONTAGE_CUT = Math.ceil((S2.durationInFrames + MONTAGE_DISSOLVE * (MONTAGE.length - 1)) / MONTAGE.length);
function MontageCut({ cut, first }: { cut: (typeof MONTAGE)[number]; first: boolean }) {
  const frame = useCurrentFrame();
  const opacity = first ? 1 : interpolate(frame, [0, MONTAGE_DISSOLVE], [0, 1], { extrapolateRight: 'clamp' });
  // Scale the capture so the cropped video is 1920 wide, shifted so the crop's corner is the frame's.
  const scale = 1920 / cut.crop.w;
  return (
    <AbsoluteFill style={{ opacity, overflow: 'hidden', transform: usePush(MONTAGE_CUT, 1.04) }}>
      {'still' in cut ? (
        <Img src={staticFile(cut.clip)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <OffthreadVideo src={staticFile(cut.clip)} trimBefore={Math.round(cut.fromS * FPS)} muted style={{ position: 'absolute', width: cut.srcW * scale, left: -cut.crop.x * scale, top: -cut.crop.y * scale }} />
      )}
    </AbsoluteFill>
  );
}
/**
 * "Thousands of videos he can't search. / Letters he can't read. / Calls he can't follow.": each
 * line rolls up as the voice starts it, its last word in the accent.
 */
const CANT = [
  { cue: 'thousands', lead: "Thousands of videos he can't", word: 'search.' },
  { cue: 'letters', lead: "Letters he can't", word: 'read.' },
  { cue: 'calls', lead: "Calls he can't", word: 'follow.' },
] as const;
function CantRoll() {
  const frame = useCurrentFrame();
  const line = S2.lines[0];
  const starts = CANT.map((row) => cueAt(line, row.cue) - 4);
  const current = starts.reduce((idx, at, i) => (frame >= at ? i : idx), 0);
  const prev = starts[current] ?? 0;
  const offset = current === 0 ? 0 : interpolate(frame, [prev, prev + 12], [current - 1, current], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const enter = useEnter(starts[0] ?? 0);
  const ROW = 96;
  const text = { fontFamily: DISPLAY, fontWeight: 200, fontSize: 72, color: COLOR.white, whiteSpace: 'nowrap', textShadow: '0 2px 16px rgba(0,0,0,0.6)' } as const;
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 420, background: 'linear-gradient(to top, rgba(5,8,10,0.75), transparent)', opacity: enter }} />
      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 96, height: ROW, overflow: 'hidden', ...riseStyle(enter) }}>
        {CANT.map((row, i) => (
          <div key={row.cue} style={{ ...text, position: 'absolute', top: (i - offset) * ROW + 2, opacity: 1 - Math.min(1, Math.abs(i - offset)) }}>
            {row.lead} <span style={{ color: NIGHT.accent }}>{row.word}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Family() {
  return (
    <AbsoluteFill style={{ background: COLOR.ink }}>
      {MONTAGE.map((cut, index) => (
        <Sequence key={cut.clip} from={index * (MONTAGE_CUT - MONTAGE_DISSOLVE)} durationInFrames={MONTAGE_CUT}>
          <MontageCut cut={cut} first={index === 0} />
        </Sequence>
      ))}
      {/* The credit shows only over the AI-generated still, never over the real footage. */}
      <Sequence durationInFrames={MONTAGE_CUT}>
        <Credit light>{MUSE_CREDIT}</Credit>
      </Sequence>
      <CantRoll />
      <Voice lines={S2.lines} />
    </AbsoluteFill>
  );
}

// 3. nimbytes: the intro's own design (MeetScene), with the tagline's second line as text only,
// no Meta logo.
const S3 = vo(['h3'], { min: 0, lead: 0.3, gap: 0, tail: 0.2 });
function NimbytesCard() {
  return (
    <AbsoluteFill>
      <MeetScene second="built with Meta AI models" />
      <Voice lines={S3.lines} />
    </AbsoluteFill>
  );
}

// 4. The filesystem: Finder, then Get Info ("Zero bytes on disk", held about 3 s), then it plays.
// Same capture as NimbytesFeatureFilesystem, reframed so no third-party names show (the Finder
// sidebar, the context menu's app entries, the Get Info preview and the venue sign in the video's
// opening seconds all stay out of frame). Static framings with a slow push-in, no pans.
const FS_CLIP = 'live/fs-owner.mp4';
const PLAYER_STILL = { x: 0.425, y: 0.335, zoom: 1.32 } as const;
const FINDER: Frame = { x: 0.42, y: 0.45, zoom: 1.6 };
const GET_INFO: Frame = { x: 0.1, y: 0.16, zoom: 2.0 };
const FS_CUTS: readonly Cut[] = [
  // Finder: the 3.4 GB file, right-click > Get Info.
  { clip: FS_CLIP, fromS: 4.24, toS: 5.6, start: FINDER, end: { ...FINDER, zoom: 1.65 } },
  // Get Info: "3,403,757,823 bytes (Zero bytes on disk)".
  { clip: FS_CLIP, fromS: 5.7, toS: 7.28, holdS: 1.7, start: GET_INFO, end: { ...GET_INFO, zoom: 2.15 } },
  // Playing, from 11.0 s (the video's first second shows a venue sign).
  { clip: FS_CLIP, fromS: 11.0, toS: 14.48, holdS: 0.6, start: PLAYER_STILL, end: PLAYER_STILL },
];
const S4 = vo(['h4'], { min: 0, lead: 0.3, gap: 0, tail: 0 });
/** Ends 0.2 s after the line (the film runs at least that long). */
const S4_FRAMES = S4.durationInFrames + Math.round(0.2 * FPS);
function FilesystemScene() {
  return <CaptureFilm name="" cuts={FS_CUTS} heads={ericHead("Eric's family videos", 'Zero bytes on his Mac')} vo={S4.lines} voDir={VO_DIR} />;
}

// 5. Search: the white search card rolling "Search by scene / people / dialogue" to "Search the way
// you want" (filesystem/SearchCard.tsx, with its own voice), then Eric's query typed close on the
// iRecall box, then the results shuffle (filesystem/Searches.tsx) ending on the "sacrifices"
// results, held in front.
const SEARCH_HEAD = { first: 'Eric asks', second: "who said 'sacrifices'?" } as const;
/** The card's own timing ends 0.6 s after its voice; the hero cut ends it 0.2 s after. */
const CARD_FRAMES = SEARCH_CARD_FRAMES - Math.round(0.4 * FPS);
const QUERY_BOX: Frame = { x: 0.47, y: 0.948, zoom: 2.25 };
/** The query is fully typed by 3.0 s; the cut stops reading at 3.3 s (0.43 s before the clip's end) and holds. */
const TYPING_CUTS: readonly Cut[] = [{ clip: 'live/fs3-type2.mp4', fromS: 0, toS: 3.3, holdS: 0.43, start: QUERY_BOX, end: { ...QUERY_BOX, zoom: 2.3 } }];
/** The typing capture's own length: the query finishes as the line ends. */
const TYPING_FRAMES = Math.round(3.73 * FPS);
const S5 = vo(['h5a', 'h5b'], { min: 0, lead: 0.2, gap: 0, tail: 0 });
/**
 * The shuffle starts at its second card (SKIP frames in), so the voice fills it: the temple results
 * are already in front, Kristoff's come over them, then the "sacrifices" results, held about 2 s.
 */
const SHUFFLE_SKIP = 34;
const RESULTS_FRAMES = SEARCH_RESULTS_FRAMES - SHUFFLE_SKIP;
const S5_FRAMES = CARD_FRAMES + TYPING_FRAMES + RESULTS_FRAMES;
function SearchScene() {
  const typingLine = S5.lines[0];
  const resultsLine = S5.lines[1];
  return (
    <Series>
      <Series.Sequence durationInFrames={CARD_FRAMES}>
        <ZoomIn bg={COLOR.white}>
          <SearchCard />
        </ZoomIn>
      </Series.Sequence>
      <Series.Sequence durationInFrames={TYPING_FRAMES}>
        <ZoomIn bg={APP_BG}>
          <CaptureFilm name="" cuts={TYPING_CUTS} heads={ericHead(SEARCH_HEAD.first, SEARCH_HEAD.second)} vo={typingLine === undefined ? [] : [typingLine]} voDir={VO_DIR} />
        </ZoomIn>
      </Series.Sequence>
      <Series.Sequence durationInFrames={RESULTS_FRAMES}>
        <Sequence from={-SHUFFLE_SKIP}>
          <SearchResults order={[0, 2, 1]} head={SEARCH_HEAD} />
        </Sequence>
        {resultsLine !== undefined && <Voice lines={[{ ...resultsLine, from: Math.round(0.2 * FPS) }]} />}
      </Series.Sequence>
    </Series>
  );
}

// 6. Memory Lane, made from iRecall (public/live/memory-lane-v3.mp4, 3840 × 2160, constant 30 fps,
// used as it is, not face-blurred): Eric's request typed into the iRecall box, the Memory Lane plan
// card, its four steps running, Ready with the agent's check ("6 lines checked against their frames;
// every line held."), all under h6; the session's start card; then two moments full screen, each
// read aloud by the app (its own sound, on its own track) while the line types on, large, over the
// card's own caption. Moment 1 ends on the "Ann" name chip; moment 2 on Eric with the "Eric" and
// "Kristoff" chips. The capture's moment 2 drifts to Ann at 146.9–149 s, so that stretch is cut.
const ML = 'live/memory-lane-v3.mp4';
const ML_ASPECT = 2160 / 3840;
// `free`: a framing may pass the capture's edges (the app's own dark background shows), so the
// card sits below Eric's headline.
const mlHold = (frame: Frame) => ({ start: frame, end: { ...frame, zoom: frame.zoom * 1.03 }, aspect: ML_ASPECT, free: true });
/** The session card fills the frame edge to edge, so it stays still (a push-in would crop its names). */
const mlStill = (frame: Frame) => ({ start: frame, end: frame, aspect: ML_ASPECT });
/** The iRecall box (capture x 0.27–0.66, y 0.92–0.98), close. */
const ML_BOX: Frame = { x: 0.465, y: 0.95, zoom: 2.2 };
/** The Memory Lane card above the box (capture x 0.27–0.66, y 0.64–0.95), low in the frame. */
const ML_PLAN: Frame = { x: 0.465, y: 0.634, zoom: 2.0 };
/** The session card full screen (a moment, its line, the name chips). */
const ML_CARD: Frame = { x: 0.555, y: 0.37, zoom: 1.05 };
/** h6 starts 1.0 s in, over the typing; the steps and Ready run under it. */
const S6 = vo(['h6'], { min: 0, lead: 1.0, gap: 0, tail: 0 });
const H6_END = (S6.lines[0]?.from ?? 0) + (S6.lines[0]?.durationInFrames ?? 0);
/**
 * The app reading each moment aloud: capture seconds (speech start to end), that speech cut once to
 * a wav (ffmpeg -ss … -to … -vn; moment 2 runs past the video stream's end), and its line as the app
 * shows it.
 */
const ML_MOMENTS = [
  { fromS: 128.85, toS: 135.02, audio: 'hero/ml-moment-1.wav', text: 'At the 60th birthday celebration, Ann sits on the white sofa by the floral wall, talking then laughing.' },
  { fromS: 140.91, toS: 149.41, audio: 'hero/ml-moment-2.wav', text: 'With Kristoff in the bright glass-walled hall, you share a warm hug as a gift bag is handed over.' },
] as const;
const momentFrames = (index: number) => Math.round(((ML_MOMENTS[index]?.toS ?? 0) - (ML_MOMENTS[index]?.fromS ?? 0)) * FPS);
/**
 * Where things land in the scene (frames). The start card follows h6 by 0.4 s; moment 1's voice
 * starts 1.1 s later with its picture; moment 2's voice follows the "Ann" chip (0.7 s after moment
 * 1's voice); the scene holds 1.2 s on Eric and the names after moment 2's voice.
 */
const START_CARD_AT = H6_END + Math.round(0.4 * FPS);
const MOMENT_1_AT = START_CARD_AT + Math.round(1.1 * FPS);
const MOMENT_2_AT = MOMENT_1_AT + momentFrames(0) + Math.round(0.7 * FPS);
const S6_FRAMES = MOMENT_2_AT + momentFrames(1) + Math.round(1.2 * FPS);
/** Cut lengths (seconds of capture) that land each picture on those marks; each cut overlaps the last by 10 frames. */
const ML_CUTS: readonly Cut[] = [
  // "Show Eric his memories of his 60th birthday" typed into iRecall.
  { clip: ML, fromS: 26.5, toS: 28.6, holdS: 0.4, ...mlHold(ML_BOX) },
  // The plan card: Eric's 60th birthday memories, four steps and their Meta models.
  { clip: ML, fromS: 38.0, toS: 41.0, ...mlHold(ML_PLAN) },
  // Make memory session: the steps run.
  { clip: ML, fromS: 60.5, toS: 66.0, ...mlHold(ML_PLAN) },
  // Ready: "6 lines checked against their frames; every line held."
  { clip: ML, fromS: 67.0, toS: 67.0 + (START_CARD_AT + 10 - (75 + 90 + 165 - 30)) / FPS, ...mlHold(ML_PLAN) },
  // The session's start card: "A Joyful Birthday Together", Start.
  { clip: ML, fromS: 125.0, toS: 125.0 + (MOMENT_1_AT - START_CARD_AT + 10) / FPS, ...mlStill(ML_CARD) },
  // Moment 1: Ann on the white sofa, read aloud.
  { clip: ML, fromS: 129.6, toS: 129.6 + (MOMENT_2_AT - MOMENT_1_AT - 36 + 20) / FPS, ...mlStill(ML_CARD) },
  // "Who is this?": the "Ann" chip appears (138.0 s).
  { clip: ML, fromS: 137.6, toS: 138.8, ...mlStill(ML_CARD) },
  // Moment 2: "With Kristoff…", the hug, then the gift bag (cut before it drifts to Ann).
  { clip: ML, fromS: 141.0, toS: 146.8, ...mlStill(ML_CARD) },
  // Eric, with the "Eric" and "Kristoff" chips, held to the scene's end: the capture's frame at
  // 149.2 s saved once (public/hero/ml-eric-names.png), because the video stream ends at 149.33 s
  // and the renderer cannot extract frames that close to its end.
  { clip: 'hero/ml-eric-names.png', fromS: 0, toS: 6.3, ...mlStill(ML_CARD) },
];

/**
 * A moment's line, large, typing on word by word as the app reads it (timed across the read-aloud,
 * captions.ts), on a dark band over the card's own caption, Again and Next.
 */
function MomentCaption({ text, frames }: { text: string; frames: number }) {
  const frame = useCurrentFrame();
  const words = wordsOf({ id: 'moment', scene: 'uses', text, from: 0, durationInFrames: frames });
  const shown = words.filter((word) => frame >= word.from).length;
  return (
    <div style={{ position: 'absolute', left: 26, right: 20, top: 590, height: 230, background: 'linear-gradient(to bottom, rgba(10,12,13,0) 0%, rgba(10,12,13,0.9) 30%, rgba(10,12,13,0.96) 100%)', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}>
      <div style={{ position: 'absolute', left: 72, right: 200, top: 64, fontFamily: ROBOTO, fontWeight: 300, fontSize: 50, lineHeight: 1.25, color: COLOR.white }}>
        {words.map((word, index) => (
          <span key={`${word.text}-${String(index)}`} style={{ opacity: index < shown ? 1 : 0 }}>
            {word.text}{' '}
          </span>
        ))}
      </div>
    </div>
  );
}

function MemoryLane() {
  const moments = [MOMENT_1_AT, MOMENT_2_AT];
  return (
    <AbsoluteFill>
      <CaptureFilm name="" cuts={ML_CUTS} heads={ericHead("Eric's 60th birthday", 'Memory Lane')} vo={S6.lines} voDir={VO_DIR} />
      {ML_MOMENTS.map((moment, index) => {
        const at = moments[index] ?? 0;
        const until = index === 0 ? MOMENT_2_AT : S6_FRAMES;
        return (
          <Sequence key={moment.fromS} from={at} durationInFrames={until - at}>
            <MomentCaption text={moment.text} frames={momentFrames(index)} />
            <Sequence durationInFrames={momentFrames(index)}>
              <Audio src={staticFile(moment.audio)} volume={0.7} />
            </Sequence>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

// 7. iRead: the bill sent, the question asked, then the answer enlarged and read aloud by the app
// (capture sound 74.5–81.5 s: "Your amount due is $79.87. It is due on 27 April 2022."), held.
const IREAD = 'live/iread-making.mp4';
/** The answer card (capture x 0.28–0.65, y 0.70–0.88), filling most of the frame width. */
const ANSWER: Frame = { x: 0.47, y: 0.79, zoom: 2.3 };
const IREAD_CUTS: readonly Cut[] = [
  { clip: IREAD, fromS: 19.5, toS: 21.0, start: { x: 0.44, y: 0.36, zoom: 1.45 }, end: { x: 0.44, y: 0.36, zoom: 1.5 } },
  { clip: IREAD, fromS: 34.45, toS: 37.5, start: { x: 0.47, y: 0.95, zoom: 2.4 }, end: { x: 0.47, y: 0.95, zoom: 2.5 } },
  { clip: IREAD, fromS: 74.3, toS: 81.55, start: ANSWER, end: { ...ANSWER, zoom: 2.38 }, audio: true, audioGain: 0.7 },
];
const S7 = vo(['h7'], { min: 0, lead: 0.3, gap: 0, tail: 0 });
/**
 * Film scenes drop most of the film's end hold, so the next line follows the app's voice closely.
 * In iRead, iListen and iGuide the cut lengths are set so the app's own voice starts about 0.3 s
 * after the voice-over line before it (no overlap, no dead air).
 */
const END_TRIM = 10;
const S7_FRAMES = filmFrames(IREAD_CUTS) - END_TRIM;
function IReadScene() {
  return (
    <CaptureFilm
      name=""
      cuts={IREAD_CUTS}
      heads={ericHead("Eric's power bill", 'iRead')}
      vo={S7.lines}
      voDir={VO_DIR}
      note="For privacy, I've used a free-to-use sample bill. Source: AER, Better Bills illustrative example bill. © Commonwealth of Australia, CC BY 4.0."
    />
  );
}

// 8. iListen: the voicemail arrives, translated, every line checked (the capture shows the check at
// 100%, no fix, so the line says "checks every line"), the Japanese original, then English aloud.
const IL_MAKING = 'live/ilisten-making.mp4';
const IL_PLAY = 'live/ilisten-play.mp4';
const hold = (frame: Frame) => ({ start: frame, end: { ...frame, zoom: frame.zoom * 1.04 } });
/** The right-hand panel (capture x 0.85–0.99), against the right edge and close enough to read. */
const PANEL = (y: number): Frame => ({ x: 1, y, zoom: 3.0 });
/** Cut lengths land the Japanese original 0.3 s after h8b ends. */
const ILISTEN_CUTS: readonly Cut[] = [
  { clip: IL_MAKING, fromS: 10.0, toS: 14.0, ...hold(PANEL(0.3)) },
  { clip: IL_PLAY, fromS: 0.2, toS: 2.2, ...hold(PANEL(0.85)) },
  { clip: IL_MAKING, fromS: 50.0, toS: 52.2, ...hold(PANEL(0.3)) },
  { clip: IL_PLAY, fromS: 2.2, toS: 5.05, audioUntilS: 4.8, ...hold(PANEL(0.85)), audio: true },
  { clip: IL_PLAY, fromS: 17.85, toS: 21.25, ...hold(PANEL(0.45)), audio: true },
];
const S8 = vo(['h8a', 'h8b'], { min: 0, lead: 0.2, gap: 0.4, tail: 0 });
const S8_FRAMES = filmFrames(ILISTEN_CUTS) - END_TRIM;
function IListenScene() {
  return <CaptureFilm name="" cuts={ILISTEN_CUTS} heads={ericHead("Eric's voicemail", 'iListen')} vo={S8.lines} voDir={VO_DIR} note="Sample voicemail made for this demo with a macOS Japanese voice." />;
}

// 9. iGuide: the cooking clip attached, the plan, Ready, then step 1 with SAM 3.1's outline, read
// aloud by the app.
const IG_MAKING = 'live/iguide-making.mp4';
const IG_READ = 'live/iguide-read-aloud.mp4';
/** The plan card, close enough to read. */
const IG_CARD: Frame = { x: 0.47, y: 0.66, zoom: 2.0 };
/** Cut lengths land the app's read-aloud 0.3 s after h9 ends. */
const IGUIDE_CUTS: readonly Cut[] = [
  // The clip picker: "Seasoning chicken breasts" ticked. public/live/iguide-picker.mp4 is
  // iguide-making.mp4 4.5–7.9 s with the terminal thumbnail behind the picker blurred (it showed a
  // personal file path).
  { clip: 'live/iguide-picker.mp4', fromS: 0.27, toS: 3.1, ...hold({ x: 0.44, y: 0.35, zoom: 2.4 }) },
  { clip: IG_MAKING, fromS: 26.6, toS: 28.4, ...hold(IG_CARD) },
  { clip: IG_MAKING, fromS: 90.8, toS: 92.5, ...hold(IG_CARD) },
  { clip: IG_READ, fromS: 2.4, toS: 6.95, ...hold({ x: 0.37, y: 0.28, zoom: 1.85 }), label: { text: 'SAM 3.1 outlines the step' }, audio: true },
];
const S9 = vo(['h9'], { min: 0, lead: 0.1, gap: 0, tail: 0 });
const S9_FRAMES = filmFrames(IGUIDE_CUTS) - END_TRIM;
function IGuideScene() {
  return <CaptureFilm name="" cuts={IGUIDE_CUTS} heads={ericHead("Eric's daughter's recipe", 'iGuide')} vo={S9.lines} voDir={VO_DIR} />;
}

// 10. The six Meta models on the white page: each card pops in as the voice names its model, with
// larger text (role and model). Then the proof line counts up.
// A 1.2 s hold after the line, so the cards (and the proof line) read with the music.
const S10 = vo(['h10'], { min: 0, lead: 0.2, gap: 0, tail: 1.2 });
/** The word in h10 that names each model, in META_MODELS order (the second "Muse" is Muse Image). */
const MODEL_CUES = [['muse', 0], ['sam', 0], ['perception', 0], ['voice', 0], ['muse', 1], ['mms', 0]] as const;
/**
 * Measured cost of one memory session in US cents, every Meta model included (the lead supplies it
 * from the API cost log). Never a guessed figure: while it is null the proof line is left out.
 */
const PROOF_CENTS: number | null = 5;

/** One model card: pops in (no bounce) at its cue; icon, role and name, larger than the outro's. */
function HeroModelCard({ model, at }: { model: (typeof META_MODELS)[number]; at: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - at, fps, durationInFrames: 14, config: { damping: 200 } });
  return (
    <div style={{ padding: '36px 40px', borderRadius: 24, background: COLOR.white, border: `1px solid ${COLOR.cardBorder}`, boxShadow: '0 20px 50px rgba(13, 27, 30, 0.08)', opacity: pop, transform: `scale(${String(0.86 + 0.14 * pop)})` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <model.Icon size={46} color={COLOR.teal} strokeWidth={1.8} />
        <span style={{ fontFamily: ROBOTO, fontWeight: 400, fontSize: 28, letterSpacing: 3, textTransform: 'uppercase', color: COLOR.teal }}>{model.role}</span>
      </div>
      <div style={{ fontFamily: ROBOTO, fontWeight: 300, fontSize: 54, color: COLOR.ink, marginTop: 16 }}>{model.name}</div>
    </div>
  );
}

/** "≈ N¢ per memory session, every Meta model included", N counting up from 0. */
function ProofLine({ cents, at }: { cents: number; at: number }) {
  const frame = useCurrentFrame();
  const value = countUp(frame, 0, cents, at, 24);
  return (
    <div style={{ ...PAGE_TEXT, fontSize: 48, ...riseStyle(useEnter(at)) }}>
      ≈ <span style={{ color: COLOR.teal }}>{String(Math.round(value))}¢</span> per memory session, every Meta model included
    </div>
  );
}

function ModelsScene() {
  const line = S10.lines[0];
  const ats = MODEL_CUES.map(([cue, n]) => cueAt(line, cue, n) - 3);
  return (
    <AbsoluteFill style={{ background: COLOR.white }}>
      <div style={{ position: 'absolute', left: 120, top: 90, ...PAGE_TEXT, fontSize: 72, ...riseStyle(useEnter(4)) }}>Six Meta models, working together.</div>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 260, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32 }}>
        {META_MODELS.map((model, index) => (
          <HeroModelCard key={model.name} model={model} at={ats[index] ?? 0} />
        ))}
      </div>
      {PROOF_CENTS !== null && (
        <div style={{ position: 'absolute', left: 120, right: 120, top: 850 }}>
          <ProofLine cents={PROOF_CENTS} at={(ats[5] ?? 0) + 12} />
        </div>
      )}
      <div style={{ position: 'absolute', left: 120, right: 120, bottom: 52, fontFamily: ROBOTO, fontWeight: 300, fontSize: 21, lineHeight: 1.4, color: COLOR.inkSoft, opacity: useEnter(40) }}>{META_MODELS_SOURCE}</div>
      <Voice lines={S10.lines} />
    </AbsoluteFill>
  );
}

// 11. The close, on the white page: Eric's portrait (a slow push) with the nimbytes logo and "Built
// with Meta AI models" below it, h11 over it, held until the music ends. The close is as long as the
// music leaves (CLOSE_FRAMES).
const S11 = vo(['h11'], { min: 0, lead: 0.3, gap: 0, tail: 2.5 });

function Close() {
  return (
    <AbsoluteFill style={{ background: COLOR.white, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', ...useZoomFade(0) }}>
        <div style={{ width: 960, height: 540, borderRadius: 24, overflow: 'hidden', boxShadow: '0 30px 80px rgba(13, 27, 30, 0.18)' }}>
          <Img src={staticFile(ERIC)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: usePush(CLOSE_FRAMES, 1.08) }} />
        </div>
        <div style={{ marginTop: 56, ...riseStyle(useEnter(20)) }}>
          <Logo size={110} color={COLOR.ink} />
        </div>
        <div style={{ ...PAGE_TEXT, fontSize: 34, color: COLOR.inkSoft, marginTop: 22, ...riseStyle(useEnter(34)) }}>Built with Meta AI models</div>
      </div>
      <Credit>{MUSE_CREDIT}</Credit>
      <Voice lines={S11.lines} />
    </AbsoluteFill>
  );
}

/** Scenes coming in from a white page, or going onto one, zoom-fade in (ZoomIn) over their own background. */
const zoomIn = (bg: string, Scene: () => ReactNode) =>
  function Zoomed() {
    return (
      <ZoomIn bg={bg}>
        <Scene />
      </ZoomIn>
    );
  };

/** The scenes in script order, with their lengths in frames. */
const SCENES = [
  { id: 'disclosure', Scene: Disclosure, frames: S0.durationInFrames },
  { id: 'eric', Scene: zoomIn(COLOR.white, Eric), frames: S1.durationInFrames },
  { id: 'family', Scene: Family, frames: S2.durationInFrames },
  { id: 'nimbytes', Scene: NimbytesCard, frames: S3.durationInFrames },
  { id: 'filesystem', Scene: zoomIn(APP_BG, FilesystemScene), frames: S4_FRAMES },
  { id: 'search', Scene: SearchScene, frames: S5_FRAMES },
  { id: 'memory-lane', Scene: MemoryLane, frames: S6_FRAMES },
  { id: 'iread', Scene: IReadScene, frames: S7_FRAMES },
  { id: 'ilisten', Scene: IListenScene, frames: S8_FRAMES },
  { id: 'iguide', Scene: IGuideScene, frames: S9_FRAMES },
  // "Show someone how to…", the task rolling as the voice names it (iGuide's own ending).
  { id: 'iguide-uses', Scene: UsesEnd, frames: USES_FRAMES },
  { id: 'models', Scene: zoomIn(COLOR.white, ModelsScene), frames: S10.durationInFrames },
] as const;
/** The close fills the rest of the music: the line, then the logo held until the music ends. */
const CLOSE_FRAMES = Math.max(S11.durationInFrames, HERO_TOTAL_FRAMES - SCENES.reduce((sum, scene) => sum + scene.frames, 0));
const ALL_SCENES = [...SCENES, { id: 'close', Scene: Close, frames: CLOSE_FRAMES }] as const;

/** The hero demo's length in frames. */
export const HERO_FRAMES = ALL_SCENES.reduce((sum, scene) => sum + scene.frames, 0);

export function HeroDemo() {
  const bgmVolume = (f: number) => BGM_LEVEL * interpolate(f, [0, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <Audio src={staticFile('audio/bgm-final.mp3')} volume={bgmVolume} />
      <Series>
        {ALL_SCENES.map(({ id, Scene, frames }) => (
          <Series.Sequence key={id} durationInFrames={frames}>
            <Scene />
          </Series.Sequence>
        ))}
      </Series>
    </>
  );
}
