//! A small library for shorts tests: two moments of user `u1` (one with speech), one moment of
//! `u2`, and every fake the shorts use cases and job steps need.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_core::AppError;
use nimbytes_core::domain::captions::SpokenTurn;
use nimbytes_core::domain::critique::{Critique, CritiqueNote, Scores, Verdict};
use nimbytes_core::domain::ids::{ClipId, SegmentId, ShortId, UserId};
use nimbytes_core::domain::job::{Job, JobKind};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::short::ShortSegment;
use nimbytes_core::domain::timeline::{
    Aspect, CaptionPlan, CaptionSource, CaptionStyle, Post, Revision, RevisionAction,
    RevisionChange, Timeline, TimelineClip,
};
use nimbytes_core::ports::StepRunner;
use nimbytes_core::usecases::shorts::{NewShort, ShortDeps, ShortSteps, create_short};

use nimbytes_core::domain::agent::AgentBudget;

use crate::{
    FakeBlobStore, FakeRenderer, FakeScratch, FixedClock, InMemoryJobQueue, InMemoryLedger,
    InMemoryShorts, ScriptedReasoner, SequentialIds,
};

/// 2026-10-27T03:00:00Z.
pub const NOW: i64 = 1_793_070_000_000;

/// A user id.
pub fn user(id: &str) -> UserId {
    UserId::parse(id).unwrap_or_else(|_| unreachable!("valid test id"))
}

/// A segment id.
pub fn seg(id: &str) -> SegmentId {
    SegmentId::parse(id).unwrap_or_else(|_| unreachable!("valid test id"))
}

/// A 7/6-scored moment `id` of `clip` over a span, with one 2 s turn saying `speech`.
pub fn moment(
    id: &str,
    clip: &str,
    (start_s, end_s): (f64, f64),
    speech: Option<&str>,
) -> ShortSegment {
    ShortSegment {
        segment_id: seg(id),
        clip_id: ClipId::parse(clip).unwrap_or_else(|_| unreachable!("valid test id")),
        clip_ext: MediaExt::Mov,
        span: Span { start_s, end_s },
        description: Some(format!("moment {id}")),
        hook_score: Some(7),
        quality: Some(6),
        turns: speech
            .map(|text| SpokenTurn {
                span: Span {
                    start_s: start_s + 1.0,
                    end_s: start_s + 3.0,
                },
                text: text.to_owned(),
            })
            .into_iter()
            .collect(),
    }
}

/// A timeline over `shots` of `(segment, in, out)`.
pub fn timeline(shots: &[(&str, f64, f64)]) -> Timeline {
    Timeline {
        aspect: Aspect::Portrait,
        target_seconds: 6.0,
        clips: shots
            .iter()
            .map(|(id, in_s, out_s)| TimelineClip {
                segment_id: seg(id),
                in_s: *in_s,
                out_s: *out_s,
                subject: None,
                punch_in: 1.0,
                reason: "because".into(),
            })
            .collect(),
        captions: CaptionPlan {
            style: CaptionStyle::Phrase,
            source: CaptionSource::Transcript,
        },
        post: Post {
            caption: "Slow mornings".into(),
            hashtags: vec!["#pov".into()],
        },
        rationale: "Open on the pour.".into(),
        revision: None,
    }
}

/// A critique scoring `hook` for the hook (the other four 5 each) with `notes` notes.
pub fn critique(hook: u8, notes: usize, verdict: Verdict) -> Critique {
    let scores = Scores {
        hook,
        pacing: 5,
        continuity: 5,
        captions: 5,
        length: 5,
    };
    Critique {
        version: 0,
        scores,
        total: scores.total(),
        notes: (0..notes)
            .map(|i| CritiqueNote {
                at: 1.0,
                issue: format!("issue {i}"),
                fix: format!("fix {i}"),
            })
            .collect(),
        verdict,
    }
}

/// `timeline(shots)` as a revision of `from`, answering critique note 0.
pub fn revised(shots: &[(&str, f64, f64)], from: u32) -> Timeline {
    let mut t = timeline(shots);
    t.revision = Some(Revision {
        from_version: from,
        changes: vec![RevisionChange {
            action: RevisionAction::Trim,
            detail: "the latte pour is shorter".into(),
            why: "the hook held too long".into(),
            note_index: Some(0),
        }],
    });
    t.rationale = format!("Revision of version {from}.");
    t
}

/// Every fake behind the shorts use cases.
pub struct ShortsWorld {
    /// Shorts store.
    pub shorts: Arc<InMemoryShorts>,
    /// Blob store.
    pub blobs: Arc<FakeBlobStore>,
    /// Job queue.
    pub jobs: InMemoryJobQueue,
    /// Ids `id-1`, `id-2`, ….
    pub ids: SequentialIds,
    /// Time.
    pub clock: Arc<FixedClock>,
    /// Planner.
    pub reasoner: Arc<ScriptedReasoner>,
    /// Renderer.
    pub renderer: Arc<FakeRenderer>,
    /// Scratch space.
    pub scratch: Arc<FakeScratch>,
    /// Model spend.
    pub ledger: Arc<InMemoryLedger>,
}

/// The production budget: 12 calls, 2 revisions, 150 s, $0.25.
pub const BUDGET: AgentBudget = AgentBudget {
    max_tool_calls: 12,
    max_revisions: 2,
    max_wall_ms: 150_000,
    max_cost_usd: 0.25,
};

impl Default for ShortsWorld {
    fn default() -> Self {
        Self::new()
    }
}

impl ShortsWorld {
    /// Moments `s0` (clip c1, 0–8 s, speech at 1–3 s) and `s1` (clip c2, 10–18 s) of `u1`, and
    /// `x0` of `u2`.
    pub fn new() -> Self {
        let shorts = Arc::new(InMemoryShorts::default());
        let speech = Some("okay latte art attempt");
        shorts.add_moment(moment("s0", "c1", (0.0, 8.0), speech), &user("u1"));
        shorts.add_moment(moment("s1", "c2", (10.0, 18.0), None), &user("u1"));
        shorts.add_moment(moment("x0", "c9", (0.0, 8.0), None), &user("u2"));
        Self {
            shorts,
            blobs: Arc::new(FakeBlobStore::default()),
            jobs: InMemoryJobQueue::default(),
            ids: SequentialIds::new("id"),
            clock: Arc::new(FixedClock::at(NOW)),
            reasoner: Arc::new(ScriptedReasoner::default()),
            renderer: Arc::new(FakeRenderer::default()),
            scratch: Arc::new(FakeScratch::default()),
            ledger: Arc::new(InMemoryLedger::default()),
        }
    }

    /// Deps for the endpoint use cases.
    pub fn deps(&self) -> ShortDeps<'_> {
        ShortDeps {
            shorts: self.shorts.as_ref(),
            blobs: self.blobs.as_ref(),
            jobs: &self.jobs,
            ids: &self.ids,
            clock: self.clock.as_ref(),
            url_ttl: Duration::from_secs(3600),
        }
    }

    /// The job steps with the production budget.
    pub fn steps(&self) -> ShortSteps {
        self.steps_with(BUDGET)
    }

    /// The job steps with `budget`.
    pub fn steps_with(&self, budget: AgentBudget) -> ShortSteps {
        ShortSteps {
            shorts: self.shorts.clone(),
            blobs: self.blobs.clone(),
            reasoner: self.reasoner.clone(),
            renderer: self.renderer.clone(),
            clock: self.clock.clone(),
            media_ttl: Duration::from_secs(7200),
            scratch: self.scratch.clone(),
            ledger: self.ledger.clone(),
            budget,
        }
    }

    /// A 4:5, 6 s short of `u1` over `s1` then `s0`.
    ///
    /// # Errors
    /// What `create_short` returns.
    pub async fn create(&self) -> Result<ShortId, AppError> {
        let new = NewShort {
            prompt: "calm morning".into(),
            segment_ids: vec![seg("s1"), seg("s0")],
            aspect: Aspect::Portrait,
            target_s: 6.0,
        };
        create_short(&self.deps(), &user("u1"), new).await
    }

    /// The queued job of `kind`.
    pub fn job(&self, kind: JobKind) -> Option<Job> {
        let all = self.jobs.all();
        all.into_iter().map(|j| j.job).find(|j| j.kind == kind)
    }

    /// The id of the job on `subject`.
    pub fn job_for(&self, subject: &str) -> nimbytes_core::domain::ids::JobId {
        let all = self.jobs.all();
        let found = all.into_iter().find(|j| j.job.subject_id == subject);
        found.map_or_else(|| unreachable!("a job on {subject}"), |j| j.job.id)
    }

    /// Runs `step` of the `kind` job.
    ///
    /// # Errors
    /// What the step returns.
    pub async fn run(&self, kind: JobKind, step: &str) -> Result<(), AppError> {
        let job = self
            .job(kind)
            .unwrap_or_else(|| unreachable!("a {} job is queued", kind.as_str()));
        self.steps().run(&job, step).await
    }
}
