//! [`PeopleStore`] on SQLite: people, face-track names and hidden flags, speaker names.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::{PersonId, SegmentId, SpeakerId, TrackId, UserId};
use nimbytes_core::domain::index::{SpeakerView, TrackView};
use nimbytes_core::domain::people::PeopleOverviewRows;
use nimbytes_core::ports::{PeopleStore, Person, PortResult, TrackUpdate};
use sqlx::Row;

use super::SqliteCatalogue;
use crate::sqlite::db_err;

/// Escapes `%`, `_` and `\` so user text matches literally in `LIKE … ESCAPE '\'`.
fn like_prefix(prefix: &str) -> String {
    let escaped: String = prefix
        .chars()
        .flat_map(|c| {
            if matches!(c, '%' | '_' | '\\') {
                vec!['\\', c]
            } else {
                vec![c]
            }
        })
        .collect();
    format!("{escaped}%")
}

impl SqliteCatalogue {
    async fn ids_of(&self, sql: &'static str, id: &str) -> Result<Vec<SegmentId>, AppError> {
        let rows: Vec<String> = sqlx::query_scalar(sql)
            .bind(id)
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.into_iter().map(SegmentId::parse).collect()
    }

    async fn owner_of(&self, sql: &'static str, id: &str) -> Result<Option<UserId>, AppError> {
        let owner: Option<String> = sqlx::query_scalar(sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        owner.map(UserId::parse).transpose()
    }

    async fn names(&self, user: &UserId) -> Result<(Vec<String>, Vec<String>), AppError> {
        let people: Vec<String> =
            sqlx::query_scalar("SELECT name FROM people WHERE user_id = ? ORDER BY name")
                .bind(user.as_str())
                .fetch_all(&self.pool)
                .await
                .map_err(db_err)?;
        let speakers: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT sp.display_name FROM speakers sp JOIN clips c ON c.id = sp.clip_id \
             WHERE c.user_id = ? AND sp.display_name IS NOT NULL ORDER BY sp.display_name",
        )
        .bind(user.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        Ok((people, speakers))
    }

    async fn prefix(
        &self,
        user: &UserId,
        prefix: &str,
        limit: u32,
    ) -> Result<Vec<Person>, AppError> {
        let rows = sqlx::query(
            "SELECT id, name FROM people WHERE user_id = ? AND name LIKE ? ESCAPE '\\' COLLATE NOCASE \
             ORDER BY name COLLATE NOCASE LIMIT ?",
        )
        .bind(user.as_str())
        .bind(like_prefix(prefix))
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                Ok(Person {
                    id: PersonId::parse(r.try_get::<String, _>(0).map_err(db_err)?)?,
                    name: r.try_get(1).map_err(db_err)?,
                })
            })
            .collect()
    }

    async fn upsert(
        &self,
        user: &UserId,
        new_id: &PersonId,
        name: &str,
    ) -> Result<PersonId, AppError> {
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM people WHERE user_id = ? AND name = ? COLLATE NOCASE",
        )
        .bind(user.as_str())
        .bind(name)
        .fetch_optional(&self.pool)
        .await
        .map_err(db_err)?;
        if let Some(id) = existing {
            return PersonId::parse(id);
        }
        sqlx::query("INSERT INTO people (id, user_id, name) VALUES (?, ?, ?)")
            .bind(new_id.as_str())
            .bind(user.as_str())
            .bind(name)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(new_id.clone())
    }

    async fn apply(&self, id: &TrackId, u: &TrackUpdate) -> Result<(), AppError> {
        sqlx::query("UPDATE face_tracks SET person_id = COALESCE(?, person_id), hidden = COALESCE(?, hidden) WHERE id = ?")
            .bind(u.person.as_ref().map(PersonId::as_str))
            .bind(u.hidden)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    async fn track_row(&self, id: &TrackId) -> Result<Option<TrackView>, AppError> {
        let row = sqlx::query(
            "SELECT f.id, f.first_s, f.last_s, f.crop_key, f.hidden, p.name FROM face_tracks f \
             LEFT JOIN people p ON p.id = f.person_id WHERE f.id = ?",
        )
        .bind(id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(db_err)?;
        row.map(|r| {
            Ok(TrackView {
                id: TrackId::parse(r.try_get::<String, _>(0).map_err(db_err)?)?,
                first_s: r.try_get(1).map_err(db_err)?,
                last_s: r.try_get(2).map_err(db_err)?,
                crop_key: r.try_get(3).map_err(db_err)?,
                hidden: r.try_get(4).map_err(db_err)?,
                person_name: r.try_get(5).map_err(db_err)?,
            })
        })
        .transpose()
    }

    async fn speaker_row(&self, id: &SpeakerId) -> Result<Option<SpeakerView>, AppError> {
        let row = sqlx::query("SELECT id, label, display_name FROM speakers WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.map(|r| {
            Ok(SpeakerView {
                id: SpeakerId::parse(r.try_get::<String, _>(0).map_err(db_err)?)?,
                label: r.try_get(1).map_err(db_err)?,
                display_name: r.try_get(2).map_err(db_err)?,
            })
        })
        .transpose()
    }

    async fn set_speaker_name(&self, id: &SpeakerId, name: &str) -> Result<(), AppError> {
        sqlx::query("UPDATE speakers SET display_name = ? WHERE id = ?")
            .bind(name)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }
}

impl PeopleStore for SqliteCatalogue {
    fn overview<'a>(&'a self, user: &'a UserId) -> PortResult<'a, PeopleOverviewRows> {
        Box::pin(self.overview_rows(user))
    }

    fn known_names<'a>(&'a self, user: &'a UserId) -> PortResult<'a, (Vec<String>, Vec<String>)> {
        Box::pin(self.names(user))
    }

    fn people_with_prefix<'a>(
        &'a self,
        user: &'a UserId,
        prefix: &'a str,
        limit: u32,
    ) -> PortResult<'a, Vec<Person>> {
        Box::pin(self.prefix(user, prefix, limit))
    }

    fn upsert_person<'a>(
        &'a self,
        user: &'a UserId,
        new_id: &'a PersonId,
        name: &'a str,
    ) -> PortResult<'a, PersonId> {
        Box::pin(self.upsert(user, new_id, name))
    }

    fn track_owner<'a>(&'a self, id: &'a TrackId) -> PortResult<'a, Option<UserId>> {
        Box::pin(self.owner_of(
            "SELECT c.user_id FROM face_tracks f JOIN clips c ON c.id = f.clip_id WHERE f.id = ?",
            id.as_str(),
        ))
    }

    fn update_track<'a>(&'a self, id: &'a TrackId, update: &'a TrackUpdate) -> PortResult<'a, ()> {
        Box::pin(self.apply(id, update))
    }

    fn track<'a>(&'a self, id: &'a TrackId) -> PortResult<'a, Option<TrackView>> {
        Box::pin(self.track_row(id))
    }

    fn track_segments<'a>(&'a self, id: &'a TrackId) -> PortResult<'a, Vec<SegmentId>> {
        Box::pin(self.ids_of(
            "SELECT segment_id FROM track_segments WHERE track_id = ? ORDER BY segment_id",
            id.as_str(),
        ))
    }

    fn speaker_owner<'a>(&'a self, id: &'a SpeakerId) -> PortResult<'a, Option<UserId>> {
        Box::pin(self.owner_of(
            "SELECT c.user_id FROM speakers sp JOIN clips c ON c.id = sp.clip_id WHERE sp.id = ?",
            id.as_str(),
        ))
    }

    fn rename_speaker<'a>(&'a self, id: &'a SpeakerId, name: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.set_speaker_name(id, name))
    }

    fn speaker<'a>(&'a self, id: &'a SpeakerId) -> PortResult<'a, Option<SpeakerView>> {
        Box::pin(self.speaker_row(id))
    }

    fn speaker_segments<'a>(&'a self, id: &'a SpeakerId) -> PortResult<'a, Vec<SegmentId>> {
        Box::pin(self.ids_of(
            "SELECT DISTINCT st.segment_id FROM segment_turns st JOIN transcript_turns t ON t.id = st.turn_id \
             WHERE t.speaker_id = ? ORDER BY st.segment_id",
            id.as_str(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::like_prefix;

    #[test]
    fn like_wildcards_in_user_text_are_escaped() {
        assert_eq!(like_prefix("an"), "an%");
        assert_eq!(like_prefix("50%_a\\"), "50\\%\\_a\\\\%");
    }
}
