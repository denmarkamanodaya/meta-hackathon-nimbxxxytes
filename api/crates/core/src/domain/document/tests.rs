//! The iRead rules: uploads, questions, titles, the tidied reading and the sentence and part split.

use super::*;

fn upload(content_type: &str, size_bytes: u64) -> NewDocument {
    NewDocument {
        filename: "letter.jpg".into(),
        content_type: content_type.into(),
        size_bytes,
    }
}

#[test]
fn photos_and_pdfs_up_to_20_mb_are_accepted() {
    let cases = [
        ("image/jpeg", DocFormat::Jpeg, "jpg"),
        ("image/png", DocFormat::Png, "png"),
        ("IMAGE/WEBP", DocFormat::Webp, "webp"),
        ("application/pdf; charset=binary", DocFormat::Pdf, "pdf"),
    ];
    for (ct, want, ext) in cases {
        let f = checked_upload(&upload(ct, MAX_BYTES)).unwrap();
        assert_eq!((f, f.ext()), (want, ext), "{ct}");
    }
}

#[test]
fn other_types_empty_or_oversized_files_and_bad_names_are_refused() {
    let mut nameless = upload("image/jpeg", 10);
    nameless.filename = "  ".into();
    let mut long = upload("image/jpeg", 10);
    long.filename = "a".repeat(256);
    for bad in [
        upload("image/gif", 10),
        upload("video/mp4", 10),
        upload("image/jpeg", 0),
        upload("image/jpeg", MAX_BYTES + 1),
        nameless,
        long,
    ] {
        let err = checked_upload(&bad).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationFailed, "{bad:?}");
    }
}

#[test]
fn a_question_is_trimmed_and_1_to_500_characters() {
    assert_eq!(checked_question("  How much?  ").unwrap(), "How much?");
    assert!(checked_question(&"é".repeat(500)).is_ok());
    assert!(checked_question(&"é".repeat(501)).is_err());
    assert!(checked_question(" \n ").is_err());
}

#[test]
fn a_typed_title_is_tidied_and_at_most_60_characters() {
    assert_eq!(document_title(" Water  bill ").unwrap(), "Water bill");
    assert_eq!(
        document_title(&"x".repeat(61)).unwrap_err().message,
        "a document title is at most 60 characters"
    );
}

#[test]
fn the_reading_is_tidied_and_an_empty_title_gets_the_fallback() {
    let raw = Reading {
        title: "  Water\nbill  ".into(),
        kind: kind_of("bill"),
        sender: " City   Water ".into(),
        date: " 1 October 2026 ".into(),
        text: "\n Amount due: $142.60 \n".into(),
        summary: " Pay $142.60. ".into(),
    };
    let tidy = tidied_reading(&raw);
    assert_eq!(tidy.title, "Water bill");
    assert_eq!(tidy.kind, DocKind::Bill);
    assert_eq!(
        (tidy.sender.as_str(), tidy.date.as_str()),
        ("City Water", "1 October 2026")
    );
    assert_eq!(tidy.text, "Amount due: $142.60");
    assert_eq!(tidy.summary, "Pay $142.60.");
    let untitled = tidied_reading(&Reading {
        title: " ".into(),
        ..raw
    });
    assert_eq!(untitled.title, FALLBACK_TITLE);
    assert_eq!(kind_of("receipt"), DocKind::Other);
}

#[test]
fn sentences_end_at_stops_before_a_space_and_at_line_breaks() {
    let text = "Your bill is $142.60. Pay by 14 November 2026!  Questions? Call us.\n\
                Amount due: $142.60\nDue date:   14 November 2026\n\n\"Thank you.\" Bye";
    assert_eq!(
        sentences(text),
        [
            "Your bill is $142.60.",
            "Pay by 14 November 2026!",
            "Questions?",
            "Call us.",
            "Amount due: $142.60",
            "Due date: 14 November 2026",
            "\"Thank you.\"",
            "Bye",
        ]
    );
    assert!(sentences("  \n \n").is_empty());
    assert_eq!(
        sentences("Visit nimbytes.app today"),
        ["Visit nimbytes.app today"]
    );
}

#[test]
fn parts_hold_whole_sentences_up_to_about_the_limit() {
    let s = |n: usize| format!("{}.", "a".repeat(n - 1));
    let text = [s(150), s(150), s(150), s(500), s(10)].join(" ");

    let parts = text_parts(&text, PART_CHARS);

    let lens: Vec<Vec<usize>> = parts
        .iter()
        .map(|p| p.iter().map(String::len).collect())
        .collect();
    assert_eq!(lens, [vec![150, 150], vec![150], vec![500], vec![10]]);
    assert_eq!(part_text(&parts[0]).len(), 301);
    assert!(text_parts("", PART_CHARS).is_empty());
}

#[test]
fn every_sentence_lands_in_exactly_one_part_in_order() {
    let text = "One. Two is longer. Three!\nFour\nFive? Six.";
    let joined: Vec<String> = text_parts(text, 12).into_iter().flatten().collect();
    assert_eq!(joined, sentences(text));
}
