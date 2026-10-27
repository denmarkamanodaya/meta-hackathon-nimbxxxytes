//! [`StudioPlanner`] on Muse Spark: the shot list (`shot_list.md` + schema) and the coverage judge
//! (`coverage_match.md` + schema, every shot in one call), both effort low, `store: false`,
//! strict structured output, each capped by one timeout (retries included).

use std::time::Duration;

use nimbytes_core::AppError;
use nimbytes_core::domain::production::{Act, CoverageAnswer, ShotDraft, ShotList};
use nimbytes_core::ports::{
    CoverageShot, LibrarySummary, PortResult, ShotListAttempt, ShotListRequest, StudioPlanner,
    purpose,
};
use serde_json::Value;

use super::MetaClient;
use super::prompt::{StrictSchema, Template};
use super::reasoner::{SparkReasoner, ask_spark, candidate_line, send_spark};
use super::spark::output_text;

/// Reasoning effort of both calls: they shape a whole production, and they run in the background.
const LOW: &str = "low";
/// What a library line says when nothing is known yet.
const NONE: &str = "(none yet)";

/// The two prompts and their schemas.
pub struct StudioPrompts {
    /// `shot_list.md` + schema.
    pub shot_list: (Template, StrictSchema),
    /// `coverage_match.md` + schema.
    pub coverage: (Template, StrictSchema),
}

/// Spark shot planner and coverage judge.
pub struct SparkStudio {
    client: MetaClient,
    prompts: StudioPrompts,
    timeout: Duration,
}

impl SparkStudio {
    /// Uses `prompts`; each call, retries included, must finish within `timeout`.
    pub fn new(client: MetaClient, prompts: StudioPrompts, timeout: Duration) -> Self {
        Self {
            client,
            prompts,
            timeout,
        }
    }

    /// The shot list request body.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn shot_list_body(&self, r: &ShotListRequest<'_>) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.shot_list;
        let target = format!("{:.0}", r.target_s);
        let mut user = template.fill(&[
            ("brief", r.brief),
            ("format", r.format.as_str()),
            ("target_seconds", &target),
            ("aspect", r.aspect.as_str()),
            ("library", &library_text(r.library)),
        ])?;
        if let Some(why) = r.rejection {
            user.push_str(&format!(
                "\n\nYour last answer was refused: {why}. Answer again and fix that."
            ));
        }
        Ok(SparkReasoner::body(LOW, &template.system, &user, schema))
    }

    async fn plan_shots(&self, r: &ShotListRequest<'_>) -> Result<ShotListAttempt, AppError> {
        let body = self.shot_list_body(r)?;
        let raw = send_spark(&self.client, (purpose::SHOT_LIST, self.timeout), &body).await?;
        let text = output_text(&raw);
        Ok(match self.prompts.shot_list.1.check(&text) {
            Ok(v) => ShotListAttempt::Valid(shot_list_from(&v)),
            Err(error) => ShotListAttempt::Invalid { error },
        })
    }

    /// The coverage request body.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn coverage_body(
        &self,
        brief: &str,
        shots: &[CoverageShot<'_>],
    ) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.coverage;
        let user = template.fill(&[("brief", brief), ("shots", &shots_text(shots))])?;
        Ok(SparkReasoner::body(LOW, &template.system, &user, schema))
    }

    async fn judge(
        &self,
        brief: &str,
        shots: &[CoverageShot<'_>],
    ) -> Result<Vec<CoverageAnswer>, AppError> {
        let body = self.coverage_body(brief, shots)?;
        let call = (purpose::COVERAGE_MATCH, self.timeout);
        let v = ask_spark(&self.client, call, &body, &self.prompts.coverage.1).await?;
        Ok(coverage_from(&v))
    }
}

fn list_or_none(items: &[String]) -> String {
    if items.is_empty() {
        NONE.to_owned()
    } else {
        items.join(", ")
    }
}

/// The library summary as the shot list prompt shows it.
pub fn library_text(l: &LibrarySummary) -> String {
    format!(
        "{} clips, {:.0} minutes.\nPlaces: {}\nPeople: {}\nActions: {}",
        l.clips,
        l.minutes,
        list_or_none(&l.places),
        list_or_none(&l.people),
        list_or_none(&l.actions)
    )
}

/// Every shot with its numbered header and one candidate line per moment.
pub fn shots_text(shots: &[CoverageShot<'_>]) -> String {
    let mut out = String::new();
    for s in shots {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&format!(
            "Shot {} ({}): {}. {}\n",
            s.ord,
            s.act.as_str(),
            s.title,
            s.direction
        ));
        if s.candidates.is_empty() {
            out.push_str("- (no moments found)\n");
        }
        for c in s.candidates {
            out.push_str(&format!("- {}\n", candidate_line(c)));
        }
    }
    out.trim_end().to_owned()
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

/// A schema-valid shot list answer as domain values (the caller applies the domain rules).
pub fn shot_list_from(v: &Value) -> ShotList {
    let shots = v["shots"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|s| ShotDraft {
            act: Act::parse(s["act"].as_str().unwrap_or_default()).unwrap_or(Act::Story),
            title: text(&s["title"]),
            direction: text(&s["direction"]),
            tips: s["tips"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
            query: text(&s["query"]),
            duration_s: s["duration_s"].as_f64().unwrap_or(0.0),
        })
        .collect();
    ShotList {
        title: text(&v["title"]),
        shots,
    }
}

/// A schema-valid coverage answer as raw verdicts (the caller keeps only the ones that hold).
pub fn coverage_from(v: &Value) -> Vec<CoverageAnswer> {
    v["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| {
            Some(CoverageAnswer {
                shot: u32::try_from(r["shot"].as_u64()?).ok()?,
                segment_id: r["segment_id"].as_str().map(str::to_owned),
                reason: text(&r["reason"]),
                take_count: u32::try_from(r["take_count"].as_u64().unwrap_or(0)).unwrap_or(0),
            })
        })
        .collect()
}

impl StudioPlanner for SparkStudio {
    fn shot_list<'a>(
        &'a self,
        request: &'a ShotListRequest<'a>,
    ) -> PortResult<'a, ShotListAttempt> {
        Box::pin(self.plan_shots(request))
    }

    fn match_coverage<'a>(
        &'a self,
        brief: &'a str,
        shots: &'a [CoverageShot<'a>],
    ) -> PortResult<'a, Vec<CoverageAnswer>> {
        Box::pin(self.judge(brief, shots))
    }
}

#[cfg(test)]
mod studio_tests;
