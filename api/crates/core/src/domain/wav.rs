//! Mono 16-bit PCM WAV files, as the narrator speaks them: the one writer of the 44-byte header,
//! and the join of several spoken sentences into one file with a short pause between them.

use crate::error::{AppError, ErrorCode};

/// Bytes of the header [`wav_file`] writes.
pub const HEADER_BYTES: usize = 44;
/// Pause between two joined sentences, milliseconds.
pub const GAP_MS: u32 = 250;

/// A mono 16-bit PCM WAV of `pcm` (little-endian samples) at `rate` Hz.
pub fn wav_file(rate: u32, pcm: &[u8]) -> Vec<u8> {
    let data_len = u32::try_from(pcm.len()).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(HEADER_BYTES + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&data_len.saturating_add(36).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&rate.saturating_mul(2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

/// The sample rate and samples of one mono 16-bit PCM WAV.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pcm<'a> {
    /// Samples per second.
    pub rate: u32,
    /// The `data` chunk.
    pub data: &'a [u8],
}

fn bad(msg: &str) -> AppError {
    AppError::new(ErrorCode::Internal, format!("not a mono 16-bit WAV: {msg}"))
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// Reads a WAV: walks its chunks for `fmt ` (PCM, mono, 16-bit) and `data`.
///
/// # Errors
/// `INTERNAL` for anything else.
pub fn read_wav(bytes: &[u8]) -> Result<Pcm<'_>, AppError> {
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err(bad("no RIFF/WAVE header"));
    }
    let (mut at, mut rate) = (12, None);
    while let (Some(id), Some(len)) = (bytes.get(at..at + 4), u32_at(bytes, at + 4)) {
        let body = at + 8;
        let len = usize::try_from(len).map_err(|_| bad("huge chunk"))?;
        if id == b"fmt " {
            let format = (u16_at(bytes, body), u16_at(bytes, body + 2));
            if format != (Some(1), Some(1)) || u16_at(bytes, body + 14) != Some(16) {
                return Err(bad("not PCM mono 16-bit"));
            }
            rate = u32_at(bytes, body + 4);
        } else if id == b"data" {
            let rate = rate.ok_or_else(|| bad("data before fmt"))?;
            let data = bytes
                .get(body..body + len)
                .ok_or_else(|| bad("short data"))?;
            return Ok(Pcm { rate, data });
        }
        at = body + len + len % 2;
    }
    Err(bad("no data chunk"))
}

/// One WAV of every part in order with [`GAP_MS`] of silence between two parts.
///
/// # Errors
/// `INTERNAL` when there are no parts, a part is not a mono 16-bit WAV, or the rates differ.
pub fn join_wavs(parts: &[Vec<u8>]) -> Result<Vec<u8>, AppError> {
    let read: Vec<Pcm<'_>> = parts
        .iter()
        .map(|p| read_wav(p))
        .collect::<Result<_, _>>()?;
    let rate = read.first().ok_or_else(|| bad("nothing to join"))?.rate;
    if read.iter().any(|p| p.rate != rate) {
        return Err(bad("the parts have different rates"));
    }
    let gap = vec![0u8; usize::try_from(rate / 1000 * GAP_MS * 2).unwrap_or(0)];
    let mut pcm = Vec::with_capacity(read.iter().map(|p| p.data.len() + gap.len()).sum());
    for (i, p) in read.iter().enumerate() {
        if i > 0 {
            pcm.extend_from_slice(&gap);
        }
        pcm.extend_from_slice(p.data);
    }
    Ok(wav_file(rate, &pcm))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data_len(wav: &[u8]) -> u32 {
        u32::from_le_bytes(wav[40..44].try_into().unwrap())
    }

    #[test]
    fn the_header_is_16_bit_mono_pcm_with_both_lengths() {
        let w = wav_file(16_000, &[1, 0, 2, 0, 3, 0]);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(w[4..8].try_into().unwrap()), 36 + 6);
        assert_eq!(&w[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes([w[22], w[23]]), 1, "mono");
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u32::from_le_bytes(w[28..32].try_into().unwrap()), 32_000);
        assert_eq!(u16::from_le_bytes([w[34], w[35]]), 16);
        assert_eq!((&w[36..40], data_len(&w)), (&b"data"[..], 6));
        assert_eq!(w.len(), HEADER_BYTES + 6);
    }

    #[test]
    fn joined_parts_keep_every_sample_in_order_with_a_pause_between() {
        let a = wav_file(16_000, &[1, 0, 2, 0]);
        let b = wav_file(16_000, &[3, 0]);
        let c = wav_file(16_000, &[4, 0, 5, 0, 6, 0]);

        let joined = join_wavs(&[a, b, c]).unwrap();

        let gap = 16 * GAP_MS as usize * 2;
        let want = 4 + 2 + 6 + 2 * gap;
        assert_eq!(data_len(&joined) as usize, want, "data length");
        assert_eq!(
            u32::from_le_bytes(joined[4..8].try_into().unwrap()) as usize,
            36 + want,
            "RIFF length"
        );
        assert_eq!(joined.len(), HEADER_BYTES + want);
        let pcm = read_wav(&joined).unwrap().data;
        assert_eq!(&pcm[..4], &[1, 0, 2, 0]);
        assert!(pcm[4..4 + gap].iter().all(|b| *b == 0));
        assert_eq!(&pcm[4 + gap..6 + gap], &[3, 0]);
        assert_eq!(&pcm[want - 6..], &[4, 0, 5, 0, 6, 0]);
    }

    #[test]
    fn one_part_is_returned_as_it_was() {
        let a = wav_file(16_000, &[9, 0]);
        assert_eq!(join_wavs(std::slice::from_ref(&a)).unwrap(), a);
    }

    #[test]
    fn extra_chunks_are_skipped_when_reading() {
        let plain = wav_file(22_050, &[7, 0]);
        let mut with_list = plain[..36].to_vec();
        with_list.extend_from_slice(b"LIST");
        with_list.extend_from_slice(&3u32.to_le_bytes());
        with_list.extend_from_slice(b"abc\0");
        with_list.extend_from_slice(&plain[36..]);
        let pcm = read_wav(&with_list).unwrap();
        assert_eq!((pcm.rate, pcm.data), (22_050, &[7u8, 0][..]));
    }

    #[test]
    fn nothing_mixed_rates_or_non_wav_bytes_are_refused() {
        assert!(join_wavs(&[]).is_err());
        let mixed = [wav_file(16_000, &[1, 0]), wav_file(22_050, &[1, 0])];
        assert!(join_wavs(&mixed).is_err());
        assert!(join_wavs(&[b"wav:hello".to_vec()]).is_err());
        let mut stereo = wav_file(16_000, &[1, 0]);
        stereo[22] = 2;
        assert!(read_wav(&stereo).is_err());
    }
}
