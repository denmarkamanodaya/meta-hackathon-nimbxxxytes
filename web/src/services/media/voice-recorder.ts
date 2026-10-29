// Records a voice note for the Ask box (hold to talk): asks for the microphone, records with
// MediaRecorder, and hands back the audio as one Blob of the recorder's type. Every failure is a
// `VoiceError` with a code the box words; the microphone is released when a note stops or is
// dropped.

/** Why a note could not start. */
export type VoiceErrorCode = 'MIC_DENIED' | 'MIC_MISSING' | 'MIC_FAILED';

/** A recording failure with its code. */
export class VoiceError extends Error {
  /**
   * @param code - Why.
   * @param message - What happened, for the log.
   */
  constructor(
    readonly code: VoiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}

/** One note being recorded. */
export interface VoiceRecording {
  /** Stops and resolves the audio. */
  stop: () => Promise<Blob>;
  /** Stops and drops the audio. */
  cancel: () => void;
}

/** Starts voice notes. */
export interface VoiceRecorder {
  /** Asks for the microphone and starts recording; rejects with a `VoiceError`. */
  start: () => Promise<VoiceRecording>;
}

/** The parts of a media stream the recorder uses. */
export interface MicStream {
  getTracks: () => { stop: () => void }[];
}

/** The parts of a MediaRecorder the recorder uses; tests pass a fake. */
export interface RecorderTarget {
  readonly mimeType: string;
  /** Starts; `onData` gets each chunk, `onStop` runs once after the last one. */
  start: (onData: (chunk: Blob) => void, onStop: () => void) => void;
  stop: () => void;
}

/**
 * A browser MediaRecorder as a `RecorderTarget`.
 * @param recorder - The recorder.
 * @returns The target.
 */
export function mediaRecorderTarget(recorder: MediaRecorder): RecorderTarget {
  return {
    get mimeType() {
      return recorder.mimeType;
    },
    start: (onData, onStop) => {
      recorder.ondataavailable = (event) => {
        onData(event.data);
      };
      recorder.onstop = () => {
        onStop();
      };
      recorder.start();
    },
    stop: () => {
      recorder.stop();
    },
  };
}

/** The browser pieces, absent where the browser has none. */
export interface VoiceRecorderDeps<S extends MicStream> {
  getUserMedia: ((constraints: { audio: true }) => Promise<S>) | undefined;
  makeRecorder: ((stream: S) => RecorderTarget) | undefined;
}

/** Audio types the server takes, in the order the recorder prefers them. */
export const VOICE_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg'] as const;

/**
 * The first type this browser records, or undefined to let it choose.
 * @param isSupported - `MediaRecorder.isTypeSupported`.
 * @returns The type.
 */
export const pickVoiceType = (isSupported: (type: string) => boolean): string | undefined => VOICE_TYPES.find((type) => isSupported(type));

function micError(thrown: unknown): VoiceError {
  const name = thrown instanceof Error || thrown instanceof DOMException ? thrown.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new VoiceError('MIC_DENIED', 'microphone not allowed');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new VoiceError('MIC_MISSING', 'no microphone');
  return new VoiceError('MIC_FAILED', thrown instanceof Error ? thrown.message : 'microphone failed');
}

/**
 * Builds the recorder.
 * @param deps - `getUserMedia` and a MediaRecorder factory.
 * @returns The recorder.
 */
export function createVoiceRecorder<S extends MicStream>(deps: VoiceRecorderDeps<S>): VoiceRecorder {
  return {
    start: async () => {
      const { getUserMedia, makeRecorder } = deps;
      if (getUserMedia === undefined || makeRecorder === undefined) throw new VoiceError('MIC_MISSING', 'this browser cannot record');
      let stream: S;
      try {
        stream = await getUserMedia({ audio: true });
      } catch (thrown) {
        throw micError(thrown);
      }
      const release = () => {
        for (const track of stream.getTracks()) track.stop();
      };
      const chunks: Blob[] = [];
      let recorder: RecorderTarget;
      let onStopped: () => void = () => undefined;
      try {
        recorder = makeRecorder(stream);
        recorder.start(
          (chunk) => {
            if (chunk.size > 0) chunks.push(chunk);
          },
          () => {
            release();
            onStopped();
          },
        );
      } catch (thrown) {
        release();
        throw micError(thrown);
      }
      let ended: Promise<void> | null = null;
      const end = (): Promise<void> => {
        ended ??= new Promise((resolve) => {
          onStopped = resolve;
          recorder.stop();
        });
        return ended;
      };
      return {
        stop: async () => {
          await end();
          return new Blob(chunks, { type: recorder.mimeType });
        },
        cancel: () => {
          void end();
        },
      };
    },
  };
}
