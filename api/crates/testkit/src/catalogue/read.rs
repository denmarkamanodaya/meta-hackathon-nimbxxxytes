//! Read models of the in-memory catalogue, built the way the SQLite queries build them.

use nimbytes_core::domain::ids::{ClipId, SegmentId, UserId};
use nimbytes_core::domain::index::{
    ClipDetailRows, DocScope, LibraryRow, SegmentDoc, SegmentView, SpeakerView, TrackView, TurnView,
};

use nimbytes_core::domain::segment::{SpeakerRow, TurnRow};

use super::{InMemoryCatalogue, State};

fn turn_texts(state: &State, clip: &ClipId, seg: &SegmentId) -> Vec<String> {
    let Some((_, rows)) = state.transcripts.iter().rev().find(|(c, _)| c == clip) else {
        return Vec::new();
    };
    rows.turns
        .iter()
        .filter(|t| rows.links.iter().any(|(s, tid)| s == seg && tid == &t.id))
        .map(|t| t.turn.text.clone())
        .collect()
}

impl InMemoryCatalogue {
    pub(super) fn transcripts_of(&self, clip: &ClipId) -> Vec<(SegmentId, Vec<String>)> {
        let state = crate::lock(&self.state);
        state
            .segments
            .iter()
            .filter(|s| &s.clip_id == clip)
            .map(|s| (s.id.clone(), turn_texts(&state, clip, &s.id)))
            .collect()
    }

    pub(super) fn docs(&self, scope: DocScope<'_>) -> Vec<SegmentDoc> {
        let state = crate::lock(&self.state);
        state
            .segments
            .iter()
            .filter(|s| match scope {
                DocScope::Clip(c) => &s.clip_id == c,
                DocScope::Segment(id) => &s.id == id,
            })
            .filter_map(|s| {
                let clip = state.clips.iter().find(|c| c.id == s.clip_id)?;
                let facts = state
                    .facts
                    .iter()
                    .rev()
                    .find(|(id, _)| id == &s.id)
                    .map(|(_, f)| f);
                Some(SegmentDoc {
                    segment_id: s.id.clone(),
                    clip_id: clip.id.clone(),
                    user_id: clip.user_id.clone(),
                    description: facts.map(|f| f.description.clone()).unwrap_or_default(),
                    actions: facts.map(|f| f.actions.join(", ")).unwrap_or_default(),
                    objects: facts.map(|f| f.objects.join(", ")).unwrap_or_default(),
                    place: facts.and_then(|f| f.place.clone()).unwrap_or_default(),
                    mood: facts.and_then(|f| f.mood.clone()).unwrap_or_default(),
                    transcript: turn_texts(&state, &clip.id, &s.id).join(" "),
                    people: String::new(),
                    speakers: String::new(),
                    recorded_at: clip.recorded_at().map(str::to_owned),
                    quality: facts.and_then(|f| f.quality),
                    hook_score: facts.and_then(|f| f.hook_score),
                })
            })
            .collect()
    }

    pub(super) fn candidate_rows(
        &self,
        user: &UserId,
        ids: &[SegmentId],
    ) -> Vec<nimbytes_core::domain::search::Candidate> {
        // Collect first: docs() takes the lock this function takes next.
        let docs: Vec<_> = ids
            .iter()
            .flat_map(|id| self.docs(DocScope::Segment(id)))
            .filter(|d| &d.user_id == user)
            .collect();
        let state = crate::lock(&self.state);
        docs.into_iter()
            .filter_map(|d| {
                let seg = state.segments.iter().find(|s| s.id == d.segment_id)?;
                let clip = state
                    .clips
                    .iter()
                    .find(|c| c.id == d.clip_id && !c.is_copy())?;
                Some(nimbytes_core::domain::search::Candidate {
                    segment_id: d.segment_id,
                    clip_id: d.clip_id,
                    clip_filename: clip.filename.clone(),
                    clip_title: clip.display_title(),
                    start_s: seg.span.start_s,
                    end_s: seg.span.end_s,
                    recorded_at: d.recorded_at,
                    description: d.description,
                    place: d.place,
                    people: Vec::new(),
                    speakers: Vec::new(),
                    speech: d.transcript,
                    quality: d.quality,
                    faces: state
                        .faces
                        .iter()
                        .filter(|(s, _)| s == &seg.id)
                        .map(|(_, f)| f.clone())
                        .collect(),
                })
            })
            .collect()
    }

    pub(super) fn library_rows(&self, user: &UserId) -> Vec<LibraryRow> {
        let mut clips = crate::lock(&self.state).clips.clone();
        clips.retain(|c| &c.user_id == user);
        clips.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        clips.into_iter().map(|c| self.row(c)).collect()
    }

    fn row(&self, clip: nimbytes_core::domain::clip::Clip) -> LibraryRow {
        let state = crate::lock(&self.state);
        let mut segs: Vec<_> = state
            .segments
            .iter()
            .filter(|s| s.clip_id == clip.id)
            .collect();
        segs.sort_by(|a, b| a.span.start_s.total_cmp(&b.span.start_s));
        let turns = state
            .transcripts
            .iter()
            .rev()
            .find(|(c, _)| c == &clip.id)
            .map_or(0, |(_, t)| t.turns.len());
        let tracks = state
            .tracks
            .iter()
            .rev()
            .find(|t| t.clip == clip.id)
            .map_or(0, |t| t.rows.len());
        LibraryRow {
            segment_count: u32::try_from(segs.len()).unwrap_or(u32::MAX),
            first_segment: segs.first().map(|s| s.id.clone()),
            // People are linked to tracks only through the naming endpoints (later phase).
            people: Vec::new(),
            // Set by `put_in_project`.
            project_ids: state
                .projects
                .iter()
                .filter(|(c, _)| c == &clip.id)
                .map(|(_, p)| p.clone())
                .collect(),
            speech_count: u32::try_from(turns).unwrap_or(u32::MAX),
            // Tracks here are never hidden (hiding goes through the people store).
            face_count: u32::try_from(tracks).unwrap_or(u32::MAX),
            clip,
        }
    }

    pub(super) fn detail(&self, id: &ClipId) -> Option<ClipDetailRows> {
        let row = self.row(self.clip(id)?);
        let state = crate::lock(&self.state);
        let transcript = state
            .transcripts
            .iter()
            .rev()
            .find(|(c, _)| c == id)
            .map(|(_, t)| t.clone())
            .unwrap_or_default();
        Some(ClipDetailRows {
            row,
            segments: segment_views(&state, id),
            turns: transcript.turns.iter().map(turn_view).collect(),
            speakers: transcript.speakers.iter().map(speaker_view).collect(),
            tracks: track_views(&state, id),
        })
    }
}

fn segment_views(state: &State, id: &ClipId) -> Vec<SegmentView> {
    let mut segments: Vec<SegmentView> = state
        .segments
        .iter()
        .filter(|s| &s.clip_id == id)
        .map(|s| SegmentView {
            segment: s.clone(),
            facts: state
                .facts
                .iter()
                .rev()
                .find(|(f, _)| f == &s.id)
                .map(|(_, f)| f.clone()),
        })
        .collect();
    segments.sort_by(|a, b| a.segment.span.start_s.total_cmp(&b.segment.span.start_s));
    segments
}

fn turn_view(t: &TurnRow) -> TurnView {
    TurnView {
        id: t.id.clone(),
        span: t.turn.span,
        text: t.turn.text.clone(),
        speaker_id: t.speaker_id.clone(),
    }
}

fn speaker_view(s: &SpeakerRow) -> SpeakerView {
    SpeakerView {
        id: s.id.clone(),
        label: s.label.clone(),
        display_name: None,
    }
}

fn track_views(state: &State, id: &ClipId) -> Vec<TrackView> {
    let Some(stored) = state.tracks.iter().rev().find(|t| &t.clip == id) else {
        return Vec::new();
    };
    stored
        .rows
        .iter()
        .map(|t| TrackView {
            id: t.id.clone(),
            first_s: t.first_s,
            last_s: t.last_s,
            crop_key: Some(t.crop_key.clone()),
            person_name: None,
            hidden: false,
        })
        .collect()
}
