//! The planner's library lookups (`search_moments`, `get_segment`) for one planned version. Each
//! call counts against the run's lookup budget and is logged as a `tool_call` / `tool_result` pair,
//! and every moment it shows becomes usable in the answer.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use super::steps::ShortSteps;
use crate::domain::ids::SegmentId;
use crate::domain::short::{MomentCard, Short, StepKind};
use crate::error::AppError;
use crate::ports::{BoxFuture, PlannerToolCall, PlannerTools};
use crate::usecases::search::{SearchDeps, search};

/// Moments one `search_moments` call returns.
const SEARCH_LIMIT: usize = 8;

/// Lookups while planning version `version` of `short`.
pub(super) struct Lookup<'a> {
    pub steps: &'a ShortSteps,
    pub short: &'a Short,
    pub version: u32,
    /// The run's lookup counter (its own budget, apart from model and render calls).
    pub lookups: &'a AtomicU32,
    /// Ids the lookups showed the planner.
    pub found: Mutex<Vec<SegmentId>>,
}

impl Lookup<'_> {
    /// The moments the lookups showed, other than `known`.
    pub fn found_except(&self, known: &[SegmentId]) -> Vec<SegmentId> {
        let found = self.found.lock().map(|f| f.clone()).unwrap_or_default();
        found.into_iter().filter(|id| !known.contains(id)).collect()
    }

    async fn search_moments(&self, query: &str) -> Result<Vec<MomentCard>, AppError> {
        let s = self.steps;
        let deps = SearchDeps {
            catalogue: s.library.catalogue.as_ref(),
            people: s.library.people.as_ref(),
            reasoner: s.reasoner.as_ref(),
            text: s.library.text.as_ref(),
            embedder: s.library.embedder.as_ref(),
            vectors: s.library.vectors.as_ref(),
            blobs: s.blobs.as_ref(),
            clock: s.clock.as_ref(),
            url_ttl: s.media_ttl,
            ledger: s.ledger.as_ref(),
            // The planner cuts video, so photos are not searched.
            photos: None,
        };
        let hits = search(&deps, &self.short.user_id, query).await?;
        let ids: Vec<SegmentId> = hits
            .results
            .iter()
            .take(SEARCH_LIMIT)
            .map(|h| h.candidate.key().clone())
            .collect();
        let moments = s.shorts.moments(&self.short.user_id, &ids).await?;
        Ok(ids
            .iter()
            .filter_map(|id| {
                let m = moments.iter().find(|m| &m.segment_id == id)?;
                let hit = hits.results.iter().find(|h| h.candidate.key() == id);
                Some(MomentCard::of(m, hit.and_then(|h| h.reason.clone())))
            })
            .collect())
    }

    async fn get_segment(&self, id: &str) -> Result<Vec<MomentCard>, AppError> {
        let id = SegmentId::parse(id)?;
        let moments = self
            .steps
            .shorts
            .moments(&self.short.user_id, std::slice::from_ref(&id))
            .await?;
        Ok(moments.iter().map(|m| MomentCard::of(m, None)).collect())
    }

    async fn answer(&self, call: PlannerToolCall) -> Result<Vec<MomentCard>, String> {
        let used = self.lookups.fetch_add(1, Ordering::SeqCst) + 1;
        if used > self.steps.budget.max_lookups {
            return Err("The lookup budget is used up. Answer with the timeline now.".into());
        }
        let (tool, asked) = match &call {
            PlannerToolCall::SearchMoments { query } => ("search_moments", format!("\"{query}\"")),
            PlannerToolCall::GetSegment { segment_id } => ("get_segment", segment_id.clone()),
        };
        let at = (Some(tool), Some(self.version));
        let id = &self.short.id;
        let log = |kind, summary| self.steps.log(id, (kind, at.0, at.1), summary);
        log(StepKind::ToolCall, format!("{tool}({asked})"))
            .await
            .map_err(|e| e.message)?;
        let result = match &call {
            PlannerToolCall::SearchMoments { query } => self.search_moments(query).await,
            PlannerToolCall::GetSegment { segment_id } => self.get_segment(segment_id).await,
        };
        let summary = match &result {
            Ok(cards) if cards.is_empty() => "No moments found".to_owned(),
            Ok(cards) => found_line(cards),
            Err(e) => format!("Lookup failed: {}", e.message),
        };
        log(StepKind::ToolResult, summary)
            .await
            .map_err(|e| e.message)?;
        let cards = result.map_err(|e| e.message)?;
        if let Ok(mut found) = self.found.lock() {
            found.extend(cards.iter().map(|c| c.segment_id.clone()));
        }
        Ok(cards)
    }
}

/// `3 moments: id (description), …` for the step log.
fn found_line(cards: &[MomentCard]) -> String {
    let names: Vec<String> = cards
        .iter()
        .map(|c| {
            let what = c.description.as_deref().unwrap_or("no description");
            let short: String = what.chars().take(40).collect();
            format!("{} ({short})", c.segment_id)
        })
        .collect();
    let n = cards.len();
    format!(
        "{n} moment{}: {}",
        if n == 1 { "" } else { "s" },
        names.join(", ")
    )
}

impl PlannerTools for Lookup<'_> {
    fn call<'a>(&'a self, call: PlannerToolCall) -> BoxFuture<'a, Result<Vec<MomentCard>, String>> {
        Box::pin(self.answer(call))
    }
}
