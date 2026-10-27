//! [`BrandStore`] on SQLite: `brand_kits`, one row per user (colours and reference keys as JSON
//! arrays).

use nimbytes_core::domain::brand::{BrandKit, TitleFont};
use nimbytes_core::domain::ids::UserId;
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{BrandStore, PortResult};
use nimbytes_core::{AppError, ErrorCode};
use sqlx::SqlitePool;

use super::db_err;

/// Brand kits on the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteBrandStore {
    pool: SqlitePool,
}

/// `colors, title_font, logo_key, ref_keys, updated_at` of a `brand_kits` row.
type KitRow = (String, String, Option<String>, String, String);

fn bad_json(e: serde_json::Error) -> AppError {
    AppError::new(ErrorCode::Internal, format!("stored brand kit: {e}"))
}

impl SqliteBrandStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn read(&self, user: &UserId) -> Result<Option<BrandKit>, AppError> {
        let row: Option<KitRow> = sqlx::query_as(
            "SELECT colors, title_font, logo_key, ref_keys, updated_at FROM brand_kits \
             WHERE user_id = ?",
        )
        .bind(user.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(db_err)?;
        let Some((colors, font, logo, refs, updated_at)) = row else {
            return Ok(None);
        };
        let refs: Vec<String> = serde_json::from_str(&refs).map_err(bad_json)?;
        Ok(Some(BrandKit {
            colors: serde_json::from_str(&colors).map_err(bad_json)?,
            title_font: TitleFont::parse(&font).map_err(|_| {
                AppError::new(ErrorCode::Internal, format!("bad title font {font}"))
            })?,
            logo_key: logo.map(ObjectKey::from_stored),
            ref_keys: refs.into_iter().map(ObjectKey::from_stored).collect(),
            updated_at,
        }))
    }

    async fn write(&self, user: &UserId, kit: &BrandKit) -> Result<(), AppError> {
        let refs: Vec<&str> = kit.ref_keys.iter().map(ObjectKey::as_str).collect();
        sqlx::query(
            "INSERT INTO brand_kits (user_id, colors, title_font, logo_key, ref_keys, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET \
             colors = excluded.colors, title_font = excluded.title_font, \
             logo_key = excluded.logo_key, ref_keys = excluded.ref_keys, \
             updated_at = excluded.updated_at",
        )
        .bind(user.as_str())
        .bind(serde_json::to_string(&kit.colors).map_err(bad_json)?)
        .bind(kit.title_font.as_str())
        .bind(kit.logo_key.as_ref().map(ObjectKey::as_str))
        .bind(serde_json::to_string(&refs).map_err(bad_json)?)
        .bind(&kit.updated_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }
}

impl BrandStore for SqliteBrandStore {
    fn brand_kit<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Option<BrandKit>> {
        Box::pin(self.read(user))
    }

    fn put_brand_kit<'a>(&'a self, user: &'a UserId, kit: &'a BrandKit) -> PortResult<'a, ()> {
        Box::pin(self.write(user, kit))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    #[tokio::test]
    async fn a_kit_round_trips_and_a_second_save_replaces_it() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO users (id, created_at) VALUES ('u1', 't')")
            .execute(&pool)
            .await
            .unwrap();
        let store = SqliteBrandStore::new(pool);
        let user = UserId::parse("u1").unwrap();
        assert_eq!(store.brand_kit(&user).await.unwrap(), None);
        let mut kit = BrandKit {
            colors: vec!["#0b6e85".into(), "#ffffff".into()],
            title_font: TitleFont::Bricolage,
            logo_key: Some(ObjectKey::from_stored("users/u1/brand/logo.png".into())),
            ref_keys: vec![ObjectKey::from_stored("users/u1/brand/ref_0.jpg".into())],
            updated_at: "2026-10-27T10:00:00.000Z".into(),
        };

        store.put_brand_kit(&user, &kit).await.unwrap();
        assert_eq!(store.brand_kit(&user).await.unwrap(), Some(kit.clone()));

        kit.logo_key = None;
        kit.title_font = TitleFont::Geist;
        store.put_brand_kit(&user, &kit).await.unwrap();
        assert_eq!(store.brand_kit(&user).await.unwrap(), Some(kit));
    }
}
