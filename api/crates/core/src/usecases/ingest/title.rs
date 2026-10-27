//! The title step: one short title for the clip, written from its segment descriptions only.

use super::IngestSteps;
use crate::domain::clip::clean_title;
use crate::domain::facts::UNTITLED;
use crate::domain::ids::ClipId;
use crate::domain::index::DocScope;
use crate::error::AppError;

impl IngestSteps {
    /// Writes and stores the clip's title. Without usable descriptions, or when the model fails
    /// or answers nothing usable, the clip keeps no title: screens then show the file name, and
    /// the title backfill at the next worker start tries again.
    pub(super) async fn title(&self, clip: &ClipId) -> Result<(), AppError> {
        let docs = self.catalogue.index_docs(DocScope::Clip(clip)).await?;
        let descriptions: Vec<String> = docs
            .into_iter()
            .map(|d| d.description.trim().to_owned())
            .filter(|d| !d.is_empty() && d != UNTITLED)
            .collect();
        if descriptions.is_empty() {
            return Ok(());
        }
        let Ok(raw) = self.titler.title(&descriptions).await else {
            return Ok(());
        };
        match clean_title(&raw) {
            Some(title) => self.catalogue.set_title(clip, &title).await,
            None => Ok(()),
        }
    }
}
