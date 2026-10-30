import { describe, expect, it } from 'vitest';
import { pickVoice, type VoiceInfo } from './voice-choice';

const v = (name: string, lang: string, localService = true): VoiceInfo => ({ name, lang, localService });

describe('pickVoice', () => {
  it('prefers en-GB, then en-AU, then en-US, then other English among equal voices', () => {
    expect(pickVoice([v('Samantha', 'en-US'), v('Karen', 'en-AU'), v('Serena', 'en-GB')])?.name).toBe('Serena');
    expect(pickVoice([v('Samantha', 'en-US'), v('Karen', 'en-AU')])?.name).toBe('Karen');
    expect(pickVoice([v('Moira', 'en-IE'), v('Samantha', 'en-US')])?.name).toBe('Samantha');
  });

  it('puts Premium or Enhanced above a compact voice', () => {
    expect(pickVoice([v('Serena', 'en-GB'), v('Samantha (Enhanced)', 'en-US')])?.name).toBe('Samantha (Enhanced)');
    expect(pickVoice([v('Kate', 'en-GB'), v('Karen (Premium)', 'en-AU')])?.name).toBe('Karen (Premium)');
  });

  it('puts the known natural voices above other English voices', () => {
    expect(pickVoice([v('Daniel', 'en-GB'), v('Google UK English Female', 'en-GB', false), v('Tessa', 'en-ZA')])?.name).toBe('Tessa');
    expect(pickVoice([v('Google UK English Female', 'en-GB', false), v('Rishi', 'en-IN')])?.name).toBe('Google UK English Female');
  });

  it('prefers an on-device voice when all else is equal', () => {
    expect(pickVoice([v('Google UK English Male', 'en-GB', false), v('Daniel', 'en-GB')])?.name).toBe('Daniel');
  });

  it('never picks a novelty voice or a non-English one', () => {
    const novelties = ['Albert', 'Bad News', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News', 'Jester', 'Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Fred', 'Junior', 'Ralph', 'Kathy'];
    expect(pickVoice([...novelties.map((name) => v(name, 'en-US')), v('Amélie', 'fr-CA')])).toBeNull();
    expect(pickVoice([v('Zarvox', 'en-US'), v('Fred (English (US))', 'en_US'), v('Eddy (English (UK))', 'en-GB')])?.name).toBe('Eddy (English (UK))');
  });

  it('has no voice for an empty list', () => {
    expect(pickVoice([])).toBeNull();
  });

  it('picks a voice of the asked language only, a mainland voice first for Chinese', () => {
    const voices = [v('Samantha', 'en-US'), v('Meijia', 'zh-TW'), v('Tingting', 'zh-CN'), v('Kyoko', 'ja-JP')];
    expect(pickVoice(voices, 'zh')?.name).toBe('Tingting');
    expect(pickVoice(voices, 'ja')?.name).toBe('Kyoko');
    expect(pickVoice(voices, 'ko')).toBeNull();
    expect(pickVoice(voices)?.name).toBe('Samantha');
  });
});
