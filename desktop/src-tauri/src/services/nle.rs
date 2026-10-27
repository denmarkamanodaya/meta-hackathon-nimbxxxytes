//! The editor bridge: writes `Projects/<short>.fcpxml` on the drive with media linked to the
//! originals on the drive (they stream as the editor reads them), opens it in Final Cut Pro when
//! installed, else reveals it in Finder (for DaVinci Resolve or Premiere). Also the Finder
//! reveals.

use std::path::PathBuf;
use std::sync::Arc;

use nimbytes_contracts::shorts::ShortDetail;
use serde::Serialize;

use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::fcpxml::write;
use crate::core::naming::project_file;
use crate::core::nle_project::{clip_ids, project};
use crate::ports::Desktop;
use crate::services::originals::MediaKind;
use crate::services::sync::SyncEngine;

/// The app opened first when installed.
const FINAL_CUT: &str = "Final Cut Pro";

/// What opened the FCPXML.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum OpenedWith {
    /// Final Cut Pro.
    #[serde(rename = "final-cut")]
    FinalCut,
    /// Revealed in Finder.
    #[serde(rename = "finder")]
    Finder,
}

/// `open_in_nle` result.
#[derive(Debug, Clone, Serialize)]
pub struct Opened {
    /// Absolute FCPXML path.
    pub fcpxml_path: String,
    /// What opened it.
    pub opened_with: OpenedWith,
}

/// What `reveal` shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevealKind {
    /// The sync folder.
    Folder,
    /// A short's FCPXML.
    Fcpxml,
    /// A short's render.
    Render,
    /// A clip's original.
    Original,
}

/// FCPXML writer and Finder bridge.
pub struct NleService {
    sync: Arc<SyncEngine>,
    desktop: Arc<dyn Desktop>,
}

impl NleService {
    /// Builds the service.
    pub fn new(sync: Arc<SyncEngine>, desktop: Arc<dyn Desktop>) -> Self {
        Self { sync, desktop }
    }

    /// Writes the short's FCPXML and opens it.
    ///
    /// # Errors
    /// `NOT_FOUND` for an unknown short or a cut without media, or an API, download or `IO` error.
    pub async fn open_in_nle(&self, short_id: &str) -> DesktopResult<Opened> {
        let path = self.write_project(short_id).await?;
        let opened_with = if self.desktop.has_app(FINAL_CUT) {
            self.desktop.open_with(&path, FINAL_CUT)?;
            OpenedWith::FinalCut
        } else {
            self.desktop.reveal(&path)?;
            OpenedWith::Finder
        };
        Ok(Opened {
            fcpxml_path: path.to_string_lossy().into_owned(),
            opened_with,
        })
    }

    async fn write_project(&self, short_id: &str) -> DesktopResult<PathBuf> {
        if short_id.contains(['/', '.']) {
            return Err(DesktopError::new(ErrorCode::NotFound, "unknown short"));
        }
        let detail: ShortDetail = self
            .sync
            .api
            .get_json(&format!("/api/shorts/{short_id}"), None)
            .await?
            .ok_or_else(|| DesktopError::new(ErrorCode::BadResponse, "no short body"))?;
        let ids = clip_ids(&detail)?;
        let local = self.sync.media_for_export(&ids).await?;
        let xml = write(&project(&detail, &local)?);
        let file = project_file(&detail.short.prompt, short_id);
        let drive = self.sync.drive().ok_or_else(|| {
            DesktopError::new(ErrorCode::NotFound, "the nimbytes drive is not ready")
        })?;
        let path = drive.put_project(&file, xml.into_bytes())?;
        self.sync.update_state(|s| {
            s.projects.insert(short_id.to_owned(), file);
            s.project_clips.insert(short_id.to_owned(), ids);
        })?;
        Ok(path)
    }

    /// Reveals a folder or file in Finder.
    ///
    /// # Errors
    /// `NOT_FOUND` when the file is not on disk, the FCPXML write failures, or `IO`.
    pub async fn reveal(&self, kind: RevealKind, id: Option<&str>) -> DesktopResult<()> {
        let missing = || DesktopError::new(ErrorCode::NotFound, "not on this Mac yet");
        let path = match (kind, id) {
            (RevealKind::Folder, _) => self.sync.folder(),
            (RevealKind::Render, Some(id)) => self
                .sync
                .media_path(MediaKind::Render, id)
                .ok_or_else(missing)?,
            (RevealKind::Original, Some(id)) => self
                .sync
                .media_path(MediaKind::Original, id)
                .ok_or_else(missing)?,
            // Written fresh, so the reveal always shows the current cut.
            (RevealKind::Fcpxml, Some(id)) => self.write_project(id).await?,
            (_, None) => return Err(missing()),
        };
        self.desktop.reveal(&path)
    }
}
