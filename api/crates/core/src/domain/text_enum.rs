//! `text_enum!`: an enum stored and sent as fixed lower-case text, with `ALL`, `as_str` and a
//! `parse` that refuses unknown text with `VALIDATION_FAILED`.

macro_rules! text_enum {
    ($(#[$doc:meta])* $name:ident { $($(#[$vdoc:meta])* $variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$doc])*
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash,
            serde::Serialize, serde::Deserialize,
        )]
        pub enum $name {
            $($(#[$vdoc])* #[serde(rename = $text)] $variant),+
        }

        impl $name {
            /// Every value, in order.
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            /// Stored and wire text.
            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }

            /// Parses stored or wire text.
            ///
            /// # Errors
            /// `VALIDATION_FAILED` for unknown text.
            pub fn parse(raw: &str) -> Result<Self, $crate::error::AppError> {
                Self::ALL
                    .iter()
                    .copied()
                    .find(|v| v.as_str() == raw)
                    .ok_or_else(|| {
                        $crate::error::AppError::new(
                            $crate::error::ErrorCode::ValidationFailed,
                            format!("unknown {} {raw}", stringify!($name)),
                        )
                    })
            }
        }
    };
}

pub(crate) use text_enum;
