//! The Tantivy schema for segment documents: fields and their query-time boosts.

use tantivy::schema::{FAST, Field, INDEXED, STORED, STRING, Schema, TEXT};

/// Text fields with the boost each match gets.
pub const TEXT_FIELDS: [(&str, f32); 8] = [
    ("description", 3.0),
    ("actions", 1.5),
    ("objects", 1.5),
    ("place", 1.2),
    ("mood", 1.0),
    ("transcript", 1.5),
    ("people", 2.0),
    ("speakers", 1.0),
];

/// Field handles, resolved once.
#[derive(Debug, Clone)]
pub struct Fields {
    /// Document key (raw, stored).
    pub segment_id: Field,
    /// Owning clip (raw, stored).
    pub clip_id: Field,
    /// Owner (raw, stored); every query filters on it.
    pub user_id: Field,
    /// The text fields in [`TEXT_FIELDS`] order.
    pub text: Vec<Field>,
    /// Recording time (fast date).
    pub recorded_at: Field,
    /// Quality 0–10 (fast).
    pub quality: Field,
    /// Hook score 0–10 (fast).
    pub hook_score: Field,
}

/// Builds the schema and its field handles.
pub fn build() -> (Schema, Fields) {
    let mut b = Schema::builder();
    let segment_id = b.add_text_field("segment_id", STRING | STORED);
    let clip_id = b.add_text_field("clip_id", STRING | STORED);
    let user_id = b.add_text_field("user_id", STRING | STORED);
    let text = TEXT_FIELDS
        .iter()
        .map(|(name, _)| b.add_text_field(name, TEXT))
        .collect();
    let recorded_at = b.add_date_field("recorded_at", INDEXED | FAST);
    let quality = b.add_f64_field("quality", INDEXED | FAST);
    let hook_score = b.add_f64_field("hook_score", INDEXED | FAST);
    let fields = Fields {
        segment_id,
        clip_id,
        user_id,
        text,
        recorded_at,
        quality,
        hook_score,
    };
    (b.build(), fields)
}
