//! Fakes for the SAM features: a scripted tracker, the subject store, an object namer and the
//! renderer's mask work. Requests are recorded so tests can assert what was asked.

use std::path::Path;
use std::sync::Mutex;

use nimbytes_core::domain::faces::BoxPx;
use nimbytes_core::domain::ids::{ShortId, UserId};
use nimbytes_core::domain::objects::FindMatch;
use nimbytes_core::domain::reframe::ShotReframe;
use nimbytes_core::domain::render::{BoxRect, CutoutRequest, StepStillProps};
use nimbytes_core::domain::sam::{
    MaskEncoding, MaskRef, Propagation, SamMedia, SamPrompt, SamRecord, SamRequest,
};
use nimbytes_core::ports::{
    MaskRenderer, ObjectNamer, ObjectTrack, PortResult, SubjectStore, SubjectTracker,
};
use nimbytes_core::{AppError, ErrorCode};

/// One request the tracker saw.
#[derive(Debug, Clone, PartialEq)]
pub struct SeenSam {
    /// File name of the media.
    pub media: String,
    /// Whether the media was an image.
    pub image: bool,
    /// The prompt.
    pub prompt: SamPrompt,
    /// The propagation asked for.
    pub propagation: Option<Propagation>,
    /// The cost-log purpose.
    pub purpose: String,
}

/// [`SubjectTracker`] answering by prompt: a concept answers what was scripted for its phrase,
/// a point or box answers the `point` script; anything unscripted answers nothing. `fail` makes
/// every call `MODEL_UNAVAILABLE`.
#[derive(Debug, Default)]
pub struct ScriptedTracker {
    concepts: Mutex<Vec<(String, Vec<SamRecord>)>>,
    point: Mutex<Vec<SamRecord>>,
    fail: Mutex<bool>,
    hang: Mutex<bool>,
    seen: Mutex<Vec<SeenSam>>,
}

impl ScriptedTracker {
    /// Records answered for the phrase `phrase`.
    pub fn concept(&self, phrase: &str, records: Vec<SamRecord>) {
        crate::lock(&self.concepts).push((phrase.to_owned(), records));
    }

    /// Records answered for any point or box prompt.
    pub fn point(&self, records: Vec<SamRecord>) {
        *crate::lock(&self.point) = records;
    }

    /// Every call fails from now on.
    pub fn fail(&self) {
        *crate::lock(&self.fail) = true;
    }

    /// Every call never answers from now on (a caller's deadline must end it).
    pub fn hang(&self) {
        *crate::lock(&self.hang) = true;
    }

    /// Requests so far.
    pub fn seen(&self) -> Vec<SeenSam> {
        crate::lock(&self.seen).clone()
    }
}

impl SubjectTracker for ScriptedTracker {
    fn segment<'a>(&'a self, request: &'a SamRequest<'a>) -> PortResult<'a, Vec<SamRecord>> {
        Box::pin(async move {
            let (path, image) = match request.media {
                SamMedia::Video(p) => (p, false),
                SamMedia::Image(p) => (p, true),
            };
            crate::lock(&self.seen).push(SeenSam {
                media: name(path),
                image,
                prompt: request.prompt.clone(),
                propagation: request.propagation,
                purpose: request.purpose.to_owned(),
            });
            let hang = *crate::lock(&self.hang);
            if hang {
                std::future::pending::<()>().await;
            }
            if *crate::lock(&self.fail) {
                return Err(AppError::new(ErrorCode::ModelUnavailable, "sam down"));
            }
            Ok(match &request.prompt {
                SamPrompt::Concept(phrase) => crate::lock(&self.concepts)
                    .iter()
                    .find(|(p, _)| p == phrase)
                    .map(|(_, r)| r.clone())
                    .unwrap_or_default(),
                _ => crate::lock(&self.point).clone(),
            })
        })
    }
}

fn name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// A record of object `id` in frame `frame` of a 480×640 frame, with a one-bit mask.
pub fn sam_record(frame: u32, id: u32, (x1, y1, x2, y2): (f64, f64, f64, f64)) -> SamRecord {
    SamRecord {
        frame,
        id,
        bbox: BoxPx { x1, y1, x2, y2 },
        frame_w: 480,
        frame_h: 640,
        conf: 0.9,
        mask: Some(MaskRef {
            encoding: MaskEncoding::OneBit,
            width: 10,
            height: 10,
            payload: format!("!!!!!m{frame}"),
        }),
    }
}

/// In-memory [`SubjectStore`]; KNN answers are scripted.
#[derive(Debug, Default)]
pub struct InMemorySubjects {
    blur: Mutex<Vec<UserId>>,
    reframes: Mutex<Vec<ShotReframe>>,
    objects: Mutex<Vec<(ObjectTrack, Vec<f32>)>>,
    near_objects: Mutex<Vec<FindMatch>>,
    near_faces: Mutex<Vec<FindMatch>>,
}

impl InMemorySubjects {
    /// What `nearest_objects` answers.
    pub fn objects_answer(&self, hits: Vec<FindMatch>) {
        *crate::lock(&self.near_objects) = hits;
    }

    /// What `nearest_faces` answers.
    pub fn faces_answer(&self, hits: Vec<FindMatch>) {
        *crate::lock(&self.near_faces) = hits;
    }

    /// Stored objects.
    pub fn stored_objects(&self) -> Vec<(ObjectTrack, Vec<f32>)> {
        crate::lock(&self.objects).clone()
    }

    /// Stored reframe rows.
    pub fn stored_reframes(&self) -> Vec<ShotReframe> {
        crate::lock(&self.reframes).clone()
    }
}

impl SubjectStore for InMemorySubjects {
    fn blur_objects<'a>(&'a self, user: &'a UserId) -> PortResult<'a, bool> {
        Box::pin(async move { Ok(crate::lock(&self.blur).contains(user)) })
    }

    fn set_blur_objects<'a>(&'a self, user: &'a UserId, on: bool) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut b = crate::lock(&self.blur);
            b.retain(|u| u != user);
            if on {
                b.push(user.clone());
            }
            Ok(())
        })
    }

    fn reframes<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Vec<ShotReframe>> {
        Box::pin(async move {
            Ok(crate::lock(&self.reframes)
                .iter()
                .filter(|r| &r.short_id == short)
                .cloned()
                .collect())
        })
    }

    fn put_reframe<'a>(&'a self, row: &'a ShotReframe) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut rows = crate::lock(&self.reframes);
            rows.retain(|r| {
                !(r.short_id == row.short_id
                    && r.version_n == row.version_n
                    && r.segment_id == row.segment_id)
            });
            rows.push(row.clone());
            Ok(())
        })
    }

    fn put_object<'a>(&'a self, track: &'a ObjectTrack, vector: &'a [f32]) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.objects).push((track.clone(), vector.to_vec()));
            Ok(())
        })
    }

    fn nearest_objects<'a>(
        &'a self,
        _user: &'a UserId,
        _vector: &'a [f32],
        _k: u32,
    ) -> PortResult<'a, Vec<FindMatch>> {
        Box::pin(async move { Ok(crate::lock(&self.near_objects).clone()) })
    }

    fn nearest_faces<'a>(
        &'a self,
        _user: &'a UserId,
        _vector: &'a [f32],
        _k: u32,
    ) -> PortResult<'a, Vec<FindMatch>> {
        Box::pin(async move { Ok(crate::lock(&self.near_faces).clone()) })
    }
}

/// [`ObjectNamer`] answering a set name (an error when none is set).
#[derive(Debug, Default)]
pub struct FakeNamer {
    name: Mutex<Option<String>>,
}

impl FakeNamer {
    /// Answers `name` from now on.
    pub fn answering(name: &str) -> Self {
        Self {
            name: Mutex::new(Some(name.to_owned())),
        }
    }
}

impl ObjectNamer for FakeNamer {
    fn name_object<'a>(&'a self, _crop: &'a Path) -> PortResult<'a, String> {
        Box::pin(async move {
            crate::lock(&self.name)
                .clone()
                .ok_or_else(|| AppError::new(ErrorCode::ModelUnavailable, "no name"))
        })
    }
}

/// [`MaskRenderer`] answering `M{x1} {y1}Z` paths and recording cut-outs and step stills with
/// their upload URL; `fail_stills` makes every step still `RENDER_FAILED`.
#[derive(Debug, Default)]
pub struct FakeMasks {
    cutouts: Mutex<Vec<(CutoutRequest, String)>>,
    stills: Mutex<Vec<(StepStillProps, String)>>,
    fail_stills: Mutex<bool>,
}

impl FakeMasks {
    /// Cut-outs asked for so far.
    pub fn cutouts(&self) -> Vec<(CutoutRequest, String)> {
        crate::lock(&self.cutouts).clone()
    }

    /// Step stills asked for so far.
    pub fn stills(&self) -> Vec<(StepStillProps, String)> {
        crate::lock(&self.stills).clone()
    }

    /// Every step still fails from now on.
    pub fn fail_stills(&self) {
        *crate::lock(&self.fail_stills) = true;
    }
}

impl MaskRenderer for FakeMasks {
    fn mask_path<'a>(&'a self, _mask: &'a MaskRef, bbox: BoxRect) -> PortResult<'a, String> {
        Box::pin(async move { Ok(format!("M{} {}Z", bbox.x1, bbox.y1)) })
    }

    fn cutout<'a>(&'a self, request: &'a CutoutRequest, out_url: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.cutouts).push((request.clone(), out_url.to_owned()));
            Ok(())
        })
    }

    fn step_still<'a>(&'a self, props: &'a StepStillProps, out_url: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.stills).push((props.clone(), out_url.to_owned()));
            if *crate::lock(&self.fail_stills) {
                return Err(AppError::new(ErrorCode::RenderFailed, "still failed"));
            }
            Ok(())
        })
    }
}
