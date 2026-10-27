//! Read models: search documents, library rows and the clip screen.

use nimbytes_core::AppError;
use nimbytes_core::domain::facts::{FactsStatus, SegmentFacts};
use nimbytes_core::domain::ids::{ClipId, SegmentId, SpeakerId, TrackId, TurnId, UserId};
use nimbytes_core::domain::index::{
    ClipDetailRows, DocScope, LibraryRow, SegmentDoc, SegmentView, SpeakerView, TrackView, TurnView,
};
use nimbytes_core::domain::search::Candidate;
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use sqlx::Row;
use sqlx::sqlite::SqliteRow;

use super::SqliteCatalogue;
use super::uploads::clip_from_row;
use crate::sqlite::db_err;

/// Library columns added to `clips.*`. People names are joined with U+001F (never in a name).
const LIBRARY_COLUMNS: &str = "c.*, \
    (SELECT COUNT(*) FROM segments s WHERE s.clip_id = c.id) AS segment_count, \
    (SELECT s.id FROM segments s WHERE s.clip_id = c.id ORDER BY s.start_s LIMIT 1) AS first_segment, \
    (SELECT group_concat(name, char(31)) FROM (SELECT DISTINCT p.name AS name FROM face_tracks f \
       JOIN people p ON p.id = f.person_id WHERE f.clip_id = c.id AND f.hidden = 0 ORDER BY p.name)) \
       AS people";

/// Facts and per-segment text joined for search documents.
const DOC_COLUMNS: &str = "s.id, s.clip_id, s.description, s.actions, s.objects, s.place, s.mood, \
    s.quality, s.hook_score, s.facts_status, s.idx, s.start_s, s.end_s, \
    (SELECT group_concat(t.text, ' ' ORDER BY t.start_s) FROM segment_turns st \
       JOIN transcript_turns t ON t.id = st.turn_id WHERE st.segment_id = s.id) AS transcript, \
    (SELECT group_concat(DISTINCT p.name) FROM track_segments ts JOIN face_tracks f ON f.id = ts.track_id \
       JOIN people p ON p.id = f.person_id WHERE ts.segment_id = s.id AND f.hidden = 0) AS people, \
    (SELECT group_concat(DISTINCT sp.display_name) FROM segment_turns st \
       JOIN transcript_turns t ON t.id = st.turn_id JOIN speakers sp ON sp.id = t.speaker_id \
       WHERE st.segment_id = s.id) AS speakers";

fn get<T: for<'r> sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>>(
    r: &SqliteRow,
    col: &str,
) -> Result<T, AppError> {
    r.try_get(col).map_err(db_err)
}

fn list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_default()
}

fn library_row(r: &SqliteRow) -> Result<LibraryRow, AppError> {
    let first: Option<String> = get(r, "first_segment")?;
    let people: Option<String> = get(r, "people")?;
    Ok(LibraryRow {
        clip: clip_from_row(r)?,
        segment_count: u32::try_from(get::<i64>(r, "segment_count")?).unwrap_or(0),
        first_segment: first.map(SegmentId::parse).transpose()?,
        people: people
            .map(|p| p.split('\u{1f}').map(str::to_owned).collect())
            .unwrap_or_default(),
    })
}

fn segment_view(r: &SqliteRow, clip: &ClipId) -> Result<SegmentView, AppError> {
    let status: Option<String> = get(r, "facts_status")?;
    let facts = match status.as_deref() {
        Some(s) => Some(SegmentFacts {
            description: get::<Option<String>>(r, "description")?.unwrap_or_default(),
            actions: list(get(r, "actions")?),
            objects: list(get(r, "objects")?),
            place: get(r, "place")?,
            mood: get(r, "mood")?,
            quality: get(r, "quality")?,
            hook_score: get(r, "hook_score")?,
            status: if s == "ok" {
                FactsStatus::Ok
            } else {
                FactsStatus::Fallback
            },
        }),
        None => None,
    };
    let segment = Segment {
        id: SegmentId::parse(get::<String>(r, "id")?)?,
        clip_id: clip.clone(),
        idx: get(r, "idx")?,
        span: Span {
            start_s: get(r, "start_s")?,
            end_s: get(r, "end_s")?,
        },
    };
    Ok(SegmentView { segment, facts })
}

impl SqliteCatalogue {
    pub(super) async fn library_rows(&self, user: &UserId) -> Result<Vec<LibraryRow>, AppError> {
        let sql = format!(
            "SELECT {LIBRARY_COLUMNS} FROM clips c WHERE c.user_id = ? ORDER BY c.created_at DESC, c.id DESC"
        );
        let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter().map(library_row).collect()
    }

    async fn library_row_of(&self, id: &ClipId) -> Result<Option<LibraryRow>, AppError> {
        let sql = format!("SELECT {LIBRARY_COLUMNS} FROM clips c WHERE c.id = ?");
        let row = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(library_row).transpose()
    }

    async fn segment_rows_with(&self, filter: &str, id: &str) -> Result<Vec<SqliteRow>, AppError> {
        let sql =
            format!("SELECT {DOC_COLUMNS} FROM segments s WHERE {filter} = ? ORDER BY s.start_s");
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(id)
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)
    }

    pub(super) async fn docs(&self, scope: DocScope<'_>) -> Result<Vec<SegmentDoc>, AppError> {
        let rows = match scope {
            DocScope::Clip(c) => self.segment_rows_with("s.clip_id", c.as_str()).await?,
            DocScope::Segment(s) => self.segment_rows_with("s.id", s.as_str()).await?,
        };
        let mut docs = Vec::with_capacity(rows.len());
        for r in &rows {
            let clip_id = ClipId::parse(get::<String>(r, "clip_id")?)?;
            if let Some(clip) = self.clip_row(&clip_id).await? {
                docs.push(doc(r, &clip)?);
            }
        }
        Ok(docs)
    }

    pub(super) async fn candidate_rows(
        &self,
        user: &UserId,
        ids: &[SegmentId],
    ) -> Result<Vec<Candidate>, AppError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        // Only `?` placeholders are formatted in; every id is bound.
        let marks = vec!["?"; ids.len()].join(", ");
        let sql = format!(
            "SELECT {DOC_COLUMNS} FROM segments s JOIN clips c ON c.id = s.clip_id \
             WHERE c.user_id = ? AND c.status != 'duplicate' AND s.id IN ({marks})"
        );
        let mut q = sqlx::query(sqlx::AssertSqlSafe(sql)).bind(user.as_str());
        for id in ids {
            q = q.bind(id.as_str());
        }
        let rows = q.fetch_all(&self.pool).await.map_err(db_err)?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let clip_id = ClipId::parse(get::<String>(r, "clip_id")?)?;
            if let Some(clip) = self.clip_row(&clip_id).await? {
                out.push(candidate(r, &clip)?);
            }
        }
        self.fill_faces(&mut out).await?;
        Ok(out)
    }

    pub(super) async fn detail(&self, id: &ClipId) -> Result<Option<ClipDetailRows>, AppError> {
        let Some(row) = self.library_row_of(id).await? else {
            return Ok(None);
        };
        let segments = self.segment_rows_with("s.clip_id", id.as_str()).await?;
        let segments = segments
            .iter()
            .map(|r| segment_view(r, id))
            .collect::<Result<_, _>>()?;
        Ok(Some(ClipDetailRows {
            row,
            segments,
            turns: self.turn_views(id).await?,
            speakers: self.speaker_views(id).await?,
            tracks: self.track_views(id).await?,
        }))
    }

    async fn turn_views(&self, id: &ClipId) -> Result<Vec<TurnView>, AppError> {
        let rows = sqlx::query("SELECT id, start_s, end_s, text, speaker_id FROM transcript_turns WHERE clip_id = ? ORDER BY start_s, turn_no")
            .bind(id.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                Ok(TurnView {
                    id: TurnId::parse(get::<String>(r, "id")?)?,
                    span: Span {
                        start_s: get(r, "start_s")?,
                        end_s: get(r, "end_s")?,
                    },
                    text: get(r, "text")?,
                    speaker_id: get::<Option<String>>(r, "speaker_id")?
                        .map(SpeakerId::parse)
                        .transpose()?,
                })
            })
            .collect()
    }

    async fn speaker_views(&self, id: &ClipId) -> Result<Vec<SpeakerView>, AppError> {
        let rows = sqlx::query(
            "SELECT id, label, display_name FROM speakers WHERE clip_id = ? ORDER BY id",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                Ok(SpeakerView {
                    id: SpeakerId::parse(get::<String>(r, "id")?)?,
                    label: get(r, "label")?,
                    display_name: get(r, "display_name")?,
                })
            })
            .collect()
    }

    async fn track_views(&self, id: &ClipId) -> Result<Vec<TrackView>, AppError> {
        let rows = sqlx::query(
            "SELECT f.id, f.first_s, f.last_s, f.crop_key, f.hidden, p.name FROM face_tracks f \
             LEFT JOIN people p ON p.id = f.person_id WHERE f.clip_id = ? ORDER BY f.first_s, f.ordinal",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                Ok(TrackView {
                    id: TrackId::parse(get::<String>(r, "id")?)?,
                    first_s: get(r, "first_s")?,
                    last_s: get(r, "last_s")?,
                    crop_key: get(r, "crop_key")?,
                    person_name: get(r, "name")?,
                    hidden: get(r, "hidden")?,
                })
            })
            .collect()
    }
}

/// A search candidate from a segment row (with its joined text columns) and its clip.
fn candidate(
    r: &SqliteRow,
    clip: &nimbytes_core::domain::clip::Clip,
) -> Result<Candidate, AppError> {
    let d = doc(r, clip)?;
    let names = |s: &str| {
        s.split(',')
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_owned)
            .collect()
    };
    Ok(Candidate {
        people: names(&d.people),
        speakers: names(&d.speakers),
        segment_id: d.segment_id,
        clip_id: d.clip_id,
        clip_filename: clip.filename.clone(),
        clip_title: clip.display_title(),
        start_s: get(r, "start_s")?,
        end_s: get(r, "end_s")?,
        recorded_at: d.recorded_at,
        description: d.description,
        place: d.place,
        speech: d.transcript,
        quality: d.quality,
        faces: Vec::new(),
    })
}

/// A search document from a segment row (with its joined text columns) and its clip.
fn doc(r: &SqliteRow, clip: &nimbytes_core::domain::clip::Clip) -> Result<SegmentDoc, AppError> {
    let view = segment_view(r, &clip.id)?;
    let facts = view.facts;
    let text = |f: Option<&String>| f.cloned().unwrap_or_default();
    Ok(SegmentDoc {
        segment_id: view.segment.id,
        clip_id: clip.id.clone(),
        user_id: clip.user_id.clone(),
        description: facts
            .as_ref()
            .map(|f| f.description.clone())
            .unwrap_or_default(),
        actions: facts
            .as_ref()
            .map(|f| f.actions.join(", "))
            .unwrap_or_default(),
        objects: facts
            .as_ref()
            .map(|f| f.objects.join(", "))
            .unwrap_or_default(),
        place: text(facts.as_ref().and_then(|f| f.place.as_ref())),
        mood: text(facts.as_ref().and_then(|f| f.mood.as_ref())),
        transcript: get::<Option<String>>(r, "transcript")?.unwrap_or_default(),
        people: get::<Option<String>>(r, "people")?.unwrap_or_default(),
        speakers: get::<Option<String>>(r, "speakers")?.unwrap_or_default(),
        recorded_at: clip.recorded_at().map(str::to_owned),
        quality: facts.as_ref().and_then(|f| f.quality),
        hook_score: facts.as_ref().and_then(|f| f.hook_score),
    })
}
