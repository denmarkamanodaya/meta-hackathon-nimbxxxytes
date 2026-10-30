//! An iListen world: every listen port as a fake (the narrator on), the spike's Mandarin/Japanese
//! meeting as scripted answers, and helpers that create u1's listen and run the queued job.

use std::sync::Arc;

use nimbytes_core::domain::ids::{ListenId, UserId};
use nimbytes_core::domain::listen::{
    CheckAnswer, Draft, DraftTurn, FixAnswer, FixTurn, ListenStatus, TurnCheck,
};
use nimbytes_core::domain::transcript::RawTurn;
use nimbytes_core::ports::ChunkSource;
use nimbytes_core::usecases::jobs::{JobDeps, run_next_job};
use nimbytes_core::usecases::listens::{
    ListenPorts, ListenRequest, SourceBody, create_listen, upload_listen_source,
};
use nimbytes_core::{AppError, ErrorCode};

use crate::{
    FakeBlobStore, FakeMediaTool, FakeNarrator, FakeScratch, FakeTranscriber, FixedClock,
    InMemoryCatalogue, InMemoryJobQueue, InMemoryListens, InMemoryUsage, ROOMY_CAP,
    RecordedProgress, ScriptedInterpreter, SequentialIds,
};

/// Every fake a listen test may assert on.
pub struct ListenWorld {
    /// The ports as the use cases see them.
    pub ports: ListenPorts,
    /// Listen rows.
    pub listens: Arc<InMemoryListens>,
    /// Private objects.
    pub blobs: Arc<FakeBlobStore>,
    /// Working files.
    pub scratch: Arc<FakeScratch>,
    /// ffprobe and the WAV.
    pub media: Arc<FakeMediaTool>,
    /// Voice Transcribe.
    pub transcriber: Arc<FakeTranscriber>,
    /// Spark.
    pub interpreter: Arc<ScriptedInterpreter>,
    /// Clips.
    pub catalogue: Arc<InMemoryCatalogue>,
    /// Jobs.
    pub jobs: Arc<InMemoryJobQueue>,
    /// MMS-TTS.
    pub narrator: Arc<FakeNarrator>,
    /// Step events.
    pub progress: RecordedProgress,
    /// Time.
    pub clock: Arc<FixedClock>,
}

/// The spike's line 1 translated right.
pub const GOOD_LINE_1: &str =
    "Tomorrow's meeting is from 10 AM. The location is the conference room on the third floor.";
/// The spike's line 1 with the planted errors (11 AM, second floor).
pub const BAD_LINE_1: &str =
    "Tomorrow's meeting is from 11 AM. The location is the conference room on the second floor.";

/// The spike's Mandarin/Japanese meeting as Voice Transcribe returned it (26.16 s).
pub fn mix_said() -> Vec<RawTurn> {
    let t = |s: u64, e: u64, sp: &str, text: &str| RawTurn {
        start_ms: s,
        end_ms: e,
        text: text.into(),
        speaker: Some(sp.into()),
    };
    vec![
        t(0, 4_460, "A", "我们明天的会议几点开始？我想确认一下时间。"),
        t(
            5_340,
            10_620,
            "B",
            "明日の会議は午前十時からです。場所は三階の会議室です。",
        ),
        t(
            10_780,
            15_980,
            "A",
            "好的,那我会准备产品的演示资料。需要带电脑吗？",
        ),
        t(
            16_300,
            21_420,
            "B",
            "はい、パソコンを持ってきてください。資料は英語でお願いします。",
        ),
        t(
            21_660,
            25_660,
            "A",
            "没问题, 我今天晚上晚上就把资料发给你。谢谢。",
        ),
    ]
}

/// The window files the meeting (26.16 s, no pauses scripted) is cut into.
pub const MIX_WINDOWS: [&str; 2] = ["win_0_20000.wav", "win_20000_26160.wav"];

/// Spark's English draft of the meeting, line 1 as given.
pub fn mix_draft(line_1: &str) -> Draft {
    let d = |i: u32, lang: &str, tr: &str| DraftTurn {
        index: i,
        lang: lang.into(),
        translation: tr.into(),
    };
    Draft {
        title: "Confirmation for Tomorrow's 10 AM Meeting".into(),
        turns: vec![
            d(
                0,
                "zh",
                "What time does our meeting start tomorrow? I want to confirm the time.",
            ),
            d(1, "ja", line_1),
            d(
                2,
                "zh",
                "Okay, then I will prepare the product demonstration materials.",
            ),
            d(
                3,
                "ja",
                "Yes, please bring your computer. Please prepare the materials in English.",
            ),
            d(
                4,
                "zh",
                "No problem, I will send the materials to you tonight. Thank you.",
            ),
        ],
        summary: "B confirms the meeting starts at 10 AM in the third-floor room.".into(),
        key_points: vec!["Meeting tomorrow at 10:00 AM".into()],
    }
}

/// A checker's answer with these line scores (issue on any below 90) and summary score.
pub fn checked(scores: &[u32], summary_score: u32) -> CheckAnswer {
    CheckAnswer {
        turns: (0u32..)
            .zip(scores)
            .map(|(index, &score)| TurnCheck {
                index,
                back_translation: String::new(),
                score,
                issue: if score < 90 {
                    "Time mistranslated as 11 AM.".into()
                } else {
                    String::new()
                },
            })
            .collect(),
        summary_score,
        summary_issues: if summary_score < 90 {
            vec!["Key points say 11:00 AM.".into()]
        } else {
            Vec::new()
        },
    }
}

/// The fixer's answer: every line of the draft, line 1 right, and an unasked change to line 0.
pub fn fixed_line_1() -> FixAnswer {
    FixAnswer {
        turns: vec![
            FixTurn {
                index: 0,
                translation: "UNASKED CHANGE".into(),
            },
            FixTurn {
                index: 1,
                translation: GOOD_LINE_1.into(),
            },
        ],
        summary: "Fixed summary.".into(),
        key_points: vec!["Meeting at 10:00 AM".into()],
    }
}

/// What a client sends to create a file listen of `content_type`.
pub fn file_request(name: &str, content_type: &str, target: &str) -> ListenRequest {
    ListenRequest {
        filename: Some(name.into()),
        content_type: Some(content_type.into()),
        size_bytes: Some(400_000),
        clip_id: None,
        target: target.into(),
    }
}

/// A request body handed out in the given pieces.
#[derive(Debug, Default)]
pub struct Body(pub Vec<Vec<u8>>);

impl ChunkSource for Body {
    fn next_chunk(
        &mut self,
    ) -> nimbytes_core::ports::BoxFuture<'_, Result<Option<Vec<u8>>, AppError>> {
        let next = (!self.0.is_empty()).then(|| self.0.remove(0));
        Box::pin(async move { Ok(next) })
    }
}

impl ListenWorld {
    /// Fresh fakes with the narrator on; the media tool reports 26.16 s with sound and the
    /// transcriber hears the meeting.
    pub fn new() -> Self {
        let scratch = Arc::new(FakeScratch::default());
        let blobs = Arc::new(FakeBlobStore::writing_to(scratch.clone()));
        let media = Arc::new(FakeMediaTool::writing_to(
            crate::world::probe(26.16, true),
            Vec::new(),
            scratch.clone(),
        ));
        let transcriber = Arc::new(FakeTranscriber::default());
        // The full pass hears the meeting; a window hears nothing unless a test scripts it, so
        // the full pass (with its speakers) is kept.
        transcriber.returns_for("audio.wav", mix_said());
        Self::over((blobs, scratch), (media, transcriber))
    }

    /// The world over these storage and media fakes; every other fake starts empty.
    fn over(
        (blobs, scratch): (Arc<FakeBlobStore>, Arc<FakeScratch>),
        (media, transcriber): (Arc<FakeMediaTool>, Arc<FakeTranscriber>),
    ) -> Self {
        let (listens, interpreter, catalogue, jobs, narrator) = Default::default();
        let clock = Arc::new(FixedClock::at(1_793_062_923_456));
        let ports = ListenPorts {
            store: Arc::clone(&listens) as Arc<InMemoryListens>,
            blobs: blobs.clone(),
            scratch: scratch.clone(),
            media: media.clone(),
            transcriber: transcriber.clone(),
            interpreter: Arc::clone(&interpreter) as Arc<ScriptedInterpreter>,
            catalogue: Arc::clone(&catalogue) as Arc<InMemoryCatalogue>,
            jobs: Arc::clone(&jobs) as Arc<InMemoryJobQueue>,
            narrator: Some(Arc::clone(&narrator) as Arc<FakeNarrator>),
            clock: clock.clone(),
            ids: Arc::new(SequentialIds::new("l")),
            usage: Arc::new(InMemoryUsage::default()),
            cap: ROOMY_CAP,
            url_ttl: std::time::Duration::from_secs(3600),
        };
        Self {
            ports,
            listens,
            blobs,
            scratch,
            media,
            transcriber,
            interpreter,
            catalogue,
            jobs,
            narrator,
            progress: RecordedProgress::default(),
            clock,
        }
    }

    /// u1 creates a listen of a file and uploads it through the API.
    ///
    /// # Errors
    /// Whatever create or upload answer.
    pub async fn uploaded(&self, target: &str) -> Result<ListenId, AppError> {
        let u1 = UserId::parse("u1")?;
        let request = file_request("meeting.m4a", "audio/x-m4a", target);
        let made = create_listen(&self.ports, &u1, request).await?;
        let mut body = Body(vec![b"RIFF".to_vec(), b"....".to_vec()]);
        let source = SourceBody {
            content_type: Some("audio/x-m4a"),
            chunks: &mut body,
        };
        let status = upload_listen_source(&self.ports, &u1, &made.id, source).await?;
        if status != ListenStatus::Listening {
            return Err(AppError::new(ErrorCode::Internal, "not listening"));
        }
        Ok(made.id)
    }

    /// Claims and runs one job; `INTERNAL` when nothing was runnable.
    ///
    /// # Errors
    /// Queue errors, or nothing runnable.
    pub async fn run_once(&self) -> Result<(), AppError> {
        let deps = JobDeps {
            queue: self.jobs.as_ref(),
            runner: &self.ports,
            clock: self.clock.as_ref(),
            progress: &self.progress,
        };
        if run_next_job(&deps).await? {
            Ok(())
        } else {
            Err(AppError::new(ErrorCode::Internal, "no job was runnable"))
        }
    }
}

impl Default for ListenWorld {
    fn default() -> Self {
        Self::new()
    }
}
