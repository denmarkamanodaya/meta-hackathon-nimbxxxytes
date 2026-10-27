//! People autocomplete, naming face tracks and speakers, and the costs screen.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use nimbytes_contracts::clips::{Speaker, Track};
use nimbytes_contracts::people::{
    CostReport, FaceSuggestion, HiddenTrack, ModelCost, NameTracksRequest, PeopleOverview, Person,
    PersonCard, SpeakerUpdateRequest, TrackUpdateRequest, UnnamedTrack,
};
use nimbytes_core::domain::ids::{SpeakerId, TrackId};
use nimbytes_core::domain::people::on_screen_s;
use nimbytes_core::usecases::people::{
    TrackChange, change_track, name_tracks, rename_speaker, suggest_people,
};
use nimbytes_core::usecases::people_overview::{FaceCard, people_overview};
use serde::Deserialize;

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// `?prefix=` of the autocomplete.
#[derive(Debug, Deserialize)]
pub struct PrefixQuery {
    /// Name prefix; empty lists every person.
    #[serde(default)]
    pub prefix: String,
}

/// `GET /api/people?prefix=`.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<PrefixQuery>,
) -> Result<Json<Vec<Person>>, ApiError> {
    let people = suggest_people(state.ports.people.as_ref(), &user, &q.prefix).await?;
    Ok(Json(
        people
            .into_iter()
            .map(|p| Person {
                person_id: p.id.to_string(),
                name: p.name,
            })
            .collect(),
    ))
}

/// `PUT /api/tracks/{id}` with only the changed field.
pub async fn update_track(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<TrackUpdateRequest>,
) -> Result<Json<Track>, ApiError> {
    let id = TrackId::parse(id)?;
    let change = TrackChange {
        name: body.name,
        hidden: body.hidden,
    };
    let (t, crop_url) = change_track(&state.ports.people_deps(), &user, &id, change).await?;
    Ok(Json(Track {
        track_id: t.id.to_string(),
        crop_url,
        first_s: t.first_s,
        last_s: t.last_s,
        person_name: t.person_name,
        hidden: t.hidden,
    }))
}

/// `PUT /api/speakers/{id}`.
pub async fn update_speaker(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<SpeakerUpdateRequest>,
) -> Result<Json<Speaker>, ApiError> {
    let id = SpeakerId::parse(id)?;
    let s = rename_speaker(&state.ports.people_deps(), &user, &id, &body.display_name).await?;
    Ok(Json(Speaker {
        speaker_id: s.id.to_string(),
        label: s.label,
        display_name: s.display_name,
    }))
}

/// `GET /api/costs`: spend per model (demo transparency; signed-in users only).
pub async fn costs(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
) -> Result<Json<CostReport>, ApiError> {
    let spend = state.ports.ledger.spend().await?;
    let by_model: Vec<ModelCost> = spend
        .into_iter()
        .map(|m| ModelCost {
            model: m.model,
            calls: m.calls,
            cost_usd: m.cost_usd,
        })
        .collect();
    Ok(Json(CostReport {
        total_usd: by_model.iter().map(|m| m.cost_usd).sum(),
        by_model,
    }))
}

/// `GET /api/people/overview`.
pub async fn overview(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<PeopleOverview>, ApiError> {
    let p = &state.ports;
    let ports = (p.people.as_ref(), p.blobs.as_ref(), p.faces.as_ref());
    let o = people_overview(ports, &user, p.url_ttl).await?;
    Ok(Json(PeopleOverview {
        people: o
            .people
            .into_iter()
            .map(|c| PersonCard {
                person_id: c.row.id.to_string(),
                name: c.row.name,
                clip_count: c.row.clip_count,
                crop_url: c.crop_url,
            })
            .collect(),
        hidden_count: u32::try_from(o.hidden.len()).unwrap_or(u32::MAX),
        unnamed: o.unnamed.into_iter().map(unnamed).collect(),
        hidden: o.hidden.into_iter().map(hidden).collect(),
    }))
}

fn hidden(c: FaceCard) -> HiddenTrack {
    let r = c.row;
    HiddenTrack {
        track_id: r.track_id.to_string(),
        clip_id: r.clip.id.to_string(),
        clip_title: r.clip.display_title(),
        recorded_at: r.clip.recorded_at().map(str::to_owned),
        crop_url: c.crop_url,
    }
}

fn unnamed(c: FaceCard) -> UnnamedTrack {
    let r = c.row;
    UnnamedTrack {
        track_id: r.track_id.to_string(),
        clip_id: r.clip.id.to_string(),
        clip_title: r.clip.display_title(),
        recorded_at: r.clip.recorded_at().map(str::to_owned),
        on_screen_s: on_screen_s(r.first_s, r.last_s),
        crop_url: c.crop_url,
        group_id: c.matching.group_id,
        suggested: c.matching.suggested.map(|s| FaceSuggestion {
            person_id: s.person_id.to_string(),
            name: s.name,
            similarity: s.similarity,
        }),
    }
}

/// `POST /api/tracks/name`: all of the user's tracks or nothing.
pub async fn name_many(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<NameTracksRequest>,
) -> Result<StatusCode, ApiError> {
    let ids = body
        .track_ids
        .into_iter()
        .map(TrackId::parse)
        .collect::<Result<Vec<_>, _>>()?;
    name_tracks(&state.ports.people_deps(), &user, &ids, &body.name).await?;
    Ok(StatusCode::NO_CONTENT)
}
