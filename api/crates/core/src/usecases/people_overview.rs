//! The people screen: named people, faces still waiting for a name, and the faces the owner hid.

use std::time::Duration;

use crate::domain::ids::UserId;
use crate::domain::people::{FaceRow, PersonRow, screen_order};
use crate::error::AppError;
use crate::keys::ObjectKey;
use crate::ports::{BlobStore, PeopleStore};

/// A named person with a signed face crop.
#[derive(Debug, Clone, PartialEq)]
pub struct PersonCard {
    /// The row.
    pub row: PersonRow,
    /// Presigned biggest face crop.
    pub crop_url: Option<String>,
}

/// An unnamed or hidden face with a signed crop.
#[derive(Debug, Clone, PartialEq)]
pub struct FaceCard {
    /// The row.
    pub row: FaceRow,
    /// Presigned face crop.
    pub crop_url: Option<String>,
}

/// The whole screen.
#[derive(Debug, Clone, PartialEq)]
pub struct PeopleOverview {
    /// Named people, most clips first.
    pub people: Vec<PersonCard>,
    /// Unnamed faces, newest clip first.
    pub unnamed: Vec<FaceCard>,
    /// Faces the user hid, newest clip first.
    pub hidden: Vec<FaceCard>,
}

async fn crop(
    blobs: &dyn BlobStore,
    key: Option<&String>,
    ttl: Duration,
) -> Result<Option<String>, AppError> {
    match key {
        Some(k) => Ok(Some(
            blobs
                .presign_get(&ObjectKey::from_stored(k.clone()), ttl)
                .await?,
        )),
        None => Ok(None),
    }
}

async fn face_cards(
    blobs: &dyn BlobStore,
    rows: Vec<FaceRow>,
    ttl: Duration,
) -> Result<Vec<FaceCard>, AppError> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let crop_url = crop(blobs, row.crop_key.as_ref(), ttl).await?;
        out.push(FaceCard { row, crop_url });
    }
    Ok(out)
}

/// The signed-in user's people screen in screen order, with crops signed for `ttl`.
///
/// # Errors
/// Store and signing errors pass through.
pub async fn people_overview(
    (people, blobs): (&dyn PeopleStore, &dyn BlobStore),
    user: &UserId,
    ttl: Duration,
) -> Result<PeopleOverview, AppError> {
    let rows = screen_order(people.overview(user).await?);
    let mut cards = Vec::with_capacity(rows.people.len());
    for row in rows.people {
        let crop_url = crop(blobs, row.crop_key.as_ref(), ttl).await?;
        cards.push(PersonCard { row, crop_url });
    }
    Ok(PeopleOverview {
        people: cards,
        unnamed: face_cards(blobs, rows.unnamed, ttl).await?,
        hidden: face_cards(blobs, rows.hidden, ttl).await?,
    })
}
