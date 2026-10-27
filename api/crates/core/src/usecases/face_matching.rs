//! Opt-in face match suggestions: the switch, and the job that embeds a user's face crops with
//! Perception Encoder and lets Muse Spark check the close pairs. The job only proposes and stores
//! verdicts; the people screen turns them into suggestions, and nothing is named until the owner
//! confirms.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::domain::face_match::{MAX_PAIRS_PER_RUN, PROPOSE_K, PROPOSE_MIN};
use crate::domain::ids::{JobId, UserId};
use crate::domain::job::{Job, JobKind};
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;
use crate::ports::{
    BlobStore, Clock, Embedder, FaceMatchStore, FaceMatcher, IdGenerator, JobQueue, NewJob,
    PortResult, Scratch, StepRunner,
};

/// Ports the switch needs.
pub struct SettingsDeps<'a> {
    /// The switch.
    pub faces: &'a dyn FaceMatchStore,
    /// Where the embed job goes.
    pub jobs: &'a dyn JobQueue,
    /// Job ids.
    pub ids: &'a dyn IdGenerator,
    /// Job times.
    pub clock: &'a dyn Clock,
}

/// Queues (or reruns) the user's face matching job.
///
/// # Errors
/// Queue errors pass through.
pub async fn queue_face_vectors(
    jobs: &dyn JobQueue,
    (ids, clock): (&dyn IdGenerator, &dyn Clock),
    user: &UserId,
) -> Result<(), AppError> {
    let now = clock.now_millis();
    let id = JobId::parse(ids.new_id())?;
    let job = NewJob {
        id: &id,
        kind: JobKind::FaceVectors,
        subject_id: user.as_str(),
    };
    jobs.enqueue(job, now).await?;
    jobs.restart(JobKind::FaceVectors, user.as_str(), now).await
}

/// Turns face matching on or off and returns the new value. On queues the job that embeds the
/// user's existing faces; off deletes every face vector and verdict of the user.
///
/// # Errors
/// Store and queue errors pass through.
pub async fn set_face_matching(
    deps: &SettingsDeps<'_>,
    user: &UserId,
    on: bool,
) -> Result<bool, AppError> {
    deps.faces.set_matching(user, on).await?;
    if on {
        queue_face_vectors(deps.jobs, (deps.ids, deps.clock), user).await?;
    }
    Ok(on)
}

/// The `face_vectors` job: `embed` then `match`, for the user the job names. Both steps do
/// nothing once the user's switch is off.
pub struct FaceSteps {
    /// Switch, vectors, verdicts.
    pub faces: Arc<dyn FaceMatchStore>,
    /// Face crops.
    pub blobs: Arc<dyn BlobStore>,
    /// Where crops are downloaded.
    pub scratch: Arc<dyn Scratch>,
    /// Perception Encoder.
    pub embedder: Arc<dyn Embedder>,
    /// Muse Spark.
    pub matcher: Arc<dyn FaceMatcher>,
}

impl FaceSteps {
    async fn dispatch(&self, job: &Job, step: &str) -> Result<(), AppError> {
        let user = UserId::parse(job.subject_id.as_str())?;
        if !self.faces.matching(&user).await? {
            return Ok(());
        }
        match step {
            "embed" => self.embed(&user).await,
            "match" => self.check_pairs(&user).await,
            other => Err(AppError::new(
                ErrorCode::Internal,
                format!("unknown face step {other}"),
            )),
        }
    }

    /// Downloads the crop into the user's directory unless an earlier step already did.
    async fn local_crop(&self, dir: &Path, track: &str, key: &str) -> Result<PathBuf, AppError> {
        let path = dir.join(format!("{track}.jpg"));
        if !self.scratch.exists(&path).await? {
            let key = ObjectKey::from_stored(key.to_owned());
            self.blobs.get_to_file(&key, &path).await?;
        }
        Ok(path)
    }

    async fn embed(&self, user: &UserId) -> Result<(), AppError> {
        let dir = self.scratch.user_dir(user).await?;
        for face in self.faces.unembedded(user).await? {
            let crop = self
                .local_crop(&dir, face.track.as_str(), &face.crop_key)
                .await?;
            let vector = self.embedder.embed_image(&crop).await?;
            self.faces.put_vector(&face.track, user, &vector).await?;
        }
        Ok(())
    }

    async fn check_pairs(&self, user: &UserId) -> Result<(), AppError> {
        let dir = self.scratch.user_dir(user).await?;
        let pairs = self.faces.proposals(user, PROPOSE_MIN, PROPOSE_K).await?;
        for pair in pairs.iter().take(MAX_PAIRS_PER_RUN) {
            let a = self.local_crop(&dir, pair.a.0.as_str(), &pair.a.1).await?;
            let b = self.local_crop(&dir, pair.b.0.as_str(), &pair.b.1).await?;
            let verdict = self.matcher.same_face(&a, &b).await?;
            self.faces
                .put_verdict(user, (&pair.a.0, &pair.b.0), &verdict)
                .await?;
        }
        self.scratch.remove_user_dir(user).await
    }
}

impl StepRunner for FaceSteps {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.dispatch(job, step))
    }

    /// A failed run changes nothing the user sees; the next ingest or switch-on runs it again.
    fn failed<'a>(&'a self, _job: &'a Job, _error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(async { Ok(()) })
    }
}
