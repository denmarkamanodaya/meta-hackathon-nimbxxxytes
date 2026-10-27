//! `GET /api/clips` and `GET /api/clips/{id}`: library and clip screen, owner only, with
//! presigned URLs.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use nimbytes_contracts::clips::{ClipDetail, ClipSummary, Segment, Speaker, Track, Turn};
use nimbytes_core::domain::ids::ClipId;
use nimbytes_core::domain::index::{LibraryRow, SegmentView, SpeakerView, TrackView, TurnView};
use nimbytes_core::usecases::clips::delete_clip;
use nimbytes_core::usecases::library::{ClipDetailView, clip_detail, library};

use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// The signed-in user's clips, newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<ClipSummary>>, ApiError> {
    let cards = library(&state.ports.library_deps(), &user).await?;
    Ok(Json(
        cards
            .into_iter()
            .map(|c| summary(c.row, c.thumb_url))
            .collect(),
    ))
}

/// One clip with segments, transcript, speakers and face tracks.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<ClipDetail>, ApiError> {
    let id = ClipId::parse(id)?;
    let view = clip_detail(&state.ports.library_deps(), &user, &id).await?;
    Ok(Json(wire(view)))
}

fn wire(v: ClipDetailView) -> ClipDetail {
    let rows = v.rows;
    ClipDetail {
        clip: summary(rows.row, v.thumb_url),
        proxy_url: v.proxy_url,
        segments: rows
            .segments
            .into_iter()
            .zip(v.segment_thumbs)
            .map(|(s, u)| segment(s, u))
            .collect(),
        turns: rows.turns.into_iter().map(turn).collect(),
        speakers: rows.speakers.into_iter().map(speaker).collect(),
        tracks: rows
            .tracks
            .into_iter()
            .zip(v.track_crops)
            .map(|(t, u)| track(t, u))
            .collect(),
    }
}

fn turn(t: TurnView) -> Turn {
    Turn {
        turn_id: t.id.to_string(),
        start_s: t.span.start_s,
        end_s: t.span.end_s,
        text: t.text,
        speaker_id: t.speaker_id.map(|s| s.to_string()),
    }
}

fn speaker(s: SpeakerView) -> Speaker {
    Speaker {
        speaker_id: s.id.to_string(),
        label: s.label,
        display_name: s.display_name,
    }
}

fn summary(row: LibraryRow, thumb_url: Option<String>) -> ClipSummary {
    let clip = row.clip;
    ClipSummary {
        clip_id: clip.id.to_string(),
        duration_s: clip.probe.as_ref().map(|p| p.duration_s),
        recorded_at: clip.recorded_at().map(str::to_owned),
        title: clip.display_title(),
        filename: clip.filename,
        status: clip.status,
        thumb_url,
        segment_count: row.segment_count,
        people: row.people,
        duplicate_of: clip.duplicate_of.map(|d| d.to_string()),
    }
}

fn segment(s: SegmentView, thumb_url: String) -> Segment {
    let f = s.facts;
    Segment {
        segment_id: s.segment.id.to_string(),
        idx: s.segment.idx,
        start_s: s.segment.span.start_s,
        end_s: s.segment.span.end_s,
        description: f.as_ref().map(|f| f.description.clone()),
        actions: f.as_ref().map(|f| f.actions.clone()).unwrap_or_default(),
        objects: f.as_ref().map(|f| f.objects.clone()).unwrap_or_default(),
        place: f.as_ref().and_then(|f| f.place.clone()),
        mood: f.as_ref().and_then(|f| f.mood.clone()),
        quality: f.as_ref().and_then(|f| f.quality),
        hook_score: f.as_ref().and_then(|f| f.hook_score),
        thumb_url: Some(thumb_url),
    }
}

fn track(t: TrackView, crop_url: Option<String>) -> Track {
    Track {
        track_id: t.id.to_string(),
        crop_url,
        first_s: t.first_s,
        last_s: t.last_s,
        person_name: t.person_name,
        hidden: t.hidden,
    }
}

/// `DELETE /api/clips/{id}`: removes the clip, its objects and its rows.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = ClipId::parse(id)?;
    delete_clip(&state.ports.remove_deps(), &user, &id).await?;
    state.ports.usage_refresh.poke();
    Ok(StatusCode::NO_CONTENT)
}
