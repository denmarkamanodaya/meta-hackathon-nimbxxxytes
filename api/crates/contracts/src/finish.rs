//! `GET/PUT /api/shorts/{id}/finish`: how a short is finished before rendering. The effect is the
//! core's serde type, re-exported so there is one shape.

pub use nimbytes_core::domain::privacy::Effect;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A short's finish: the GET answer and the PUT body (the PUT answers with what was stored).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ShortFinishBody {
    /// Blur the faces hidden in People in previews and renders. Defaults to the production's
    /// choice for a story short, else true.
    pub blur_bystanders: bool,
    /// Opening title text (at most 80 characters); null for none.
    #[serde(default)]
    pub title_text: Option<String>,
    /// Colour captions by speaker.
    pub speaker_colors: bool,
    /// `none`, `spotlight` or `blur_bg`.
    #[schemars(with = "String")]
    pub effect: Effect,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_finish_reads_snake_case_effects_and_refuses_unknown_fields() {
        let f: ShortFinishBody = serde_json::from_str(
            r#"{"blur_bystanders":true,"speaker_colors":false,"effect":"blur_bg"}"#,
        )
        .unwrap();
        assert_eq!((f.effect, f.title_text), (Effect::BlurBg, None));
        assert!(
            serde_json::from_str::<ShortFinishBody>(
                r#"{"blur_bystanders":true,"speaker_colors":false,"effect":"none","x":1}"#
            )
            .is_err()
        );
    }
}
