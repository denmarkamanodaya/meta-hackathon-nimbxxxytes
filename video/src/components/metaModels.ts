// The six Meta models nimbytes uses, with their role and what each does, and the source note. One
// list for the promo's models scene and the outro.
import { Brain, Ear, Eye, Fingerprint, Palette, Volume2 } from 'lucide-react';

export const META_MODELS = [
  { Icon: Brain, role: 'The brain', name: 'Muse Spark 1.3', line: 'Understands clips, ranks search, reads letters, plans guides.' },
  { Icon: Eye, role: 'The eyes', name: 'SAM 3.1', line: 'Finds objects and circles the real button.' },
  { Icon: Fingerprint, role: 'The memory', name: 'Perception Encoder', line: 'Matches words to pictures, and faces. On our server.' },
  { Icon: Ear, role: 'The ears', name: 'Voice Transcribe 1.0', line: 'Transcribes every clip, and hears what you ask.' },
  { Icon: Palette, role: 'The artist', name: 'Muse Image 1.0', line: 'Draws covers, storyboards and key art.' },
  { Icon: Volume2, role: 'The voice', name: 'MMS-TTS', line: 'Reads guides and letters aloud. On our server, as fallback.' },
] as const;

export const META_MODELS_SOURCE =
  'Every AI model in nimbytes is from Meta. Muse Spark, SAM 3.1, Voice Transcribe and Muse Image via the Meta API; Perception Encoder (PE-Core-B16-224) and MMS-TTS (facebook/mms-tts-eng) run on our server.';
