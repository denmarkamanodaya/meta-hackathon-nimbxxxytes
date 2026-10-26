//! People autocomplete, naming face tracks and speakers, and the costs screen.

use axum::Json;
use axum::extract::{Path, Query, State};
use nimbytes_contracts::clips::{Speaker, Track};
use nimbytes_contracts::people::{
    CostReport, ModelCost, Person, SpeakerUpdateRequest, TrackUpdateRequest,
};
use nimbytes_core::domain::ids::{SpeakerId, TrackId};
use nimbytes_core::usecases::people::{TrackChange, change_track, rename_speaker, suggest_people};
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
