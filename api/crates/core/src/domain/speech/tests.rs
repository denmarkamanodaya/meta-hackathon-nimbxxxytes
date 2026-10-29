use super::*;

fn line(text: &str) -> String {
    spoken_line(&speakable(text))
}

fn check(rows: &[(&str, &str)]) {
    for (written, spoken) in rows {
        assert_eq!(line(written), *spoken, "{written}");
    }
}

#[test]
fn money_is_dollars_and_cents() {
    check(&[
        (
            "$142.60",
            "one hundred and forty-two dollars and sixty cents",
        ),
        ("$1,860.00", "one thousand eight hundred and sixty dollars"),
        ("$465", "four hundred and sixty-five dollars"),
        ("$1.01", "one dollar and one cent"),
        ("$0.95", "ninety-five cents"),
        ("-$20", "minus twenty dollars"),
        (
            "$7,989.99",
            "seven thousand nine hundred and eighty-nine dollars and ninety-nine cents",
        ),
    ]);
}

#[test]
fn plain_numbers_years_and_decimals_are_words() {
    check(&[
        ("38", "thirty-eight"),
        ("2026", "two thousand and twenty-six"),
        ("1905", "nineteen oh five"),
        ("2007", "two thousand and seven"),
        ("1,222", "one thousand two hundred and twenty-two"),
        ("1005", "one thousand and five"),
        ("1300", "one thousand three hundred"),
        ("4455", "four thousand four hundred and fifty-five"),
        ("2.5", "two point five"),
        ("-4", "minus four"),
        ("789", "seven hundred and eighty-nine"),
        ("1,000,070", "one million and seventy"),
        ("007", "zero zero seven"),
    ]);
}

#[test]
fn phone_and_account_numbers_are_digits_in_their_printed_groups() {
    check(&[
        (
            "1300 555 019",
            "one three zero zero, five five five, zero one nine",
        ),
        ("4471 2093", "four four seven one, two zero nine three"),
        (
            "08 9555 0100",
            "zero eight, nine five five five, zero one zero zero",
        ),
        (
            "1800-787-999",
            "one eight zero zero, seven eight seven, nine nine nine",
        ),
        (
            "+61 8 9555 0100",
            "plus six one, eight, nine five five five, zero one zero zero",
        ),
        ("881204", "eight eight one two zero four"),
        (
            "0412345678",
            "zero four one two three four five six seven eight",
        ),
    ]);
}

#[test]
fn dates_and_ordinals_are_said_day_first() {
    check(&[
        (
            "14 November 2026",
            "the fourteenth of november, two thousand and twenty-six",
        ),
        (
            "14/11/2026",
            "the fourteenth of november, two thousand and twenty-six",
        ),
        ("30 Nov", "the thirtieth of november"),
        ("1st July", "the first of july"),
        (
            "November 14, 2026",
            "november the fourteenth, two thousand and twenty-six",
        ),
        ("Sept 2027", "september two thousand and twenty-seven"),
        ("1st", "first"),
        ("3rd", "third"),
        ("14th", "fourteenth"),
        ("22nd", "twenty-second"),
        ("90th", "ninetieth"),
    ]);
}

#[test]
fn times_are_hours_minutes_and_am_or_pm() {
    check(&[
        ("9:30am", "nine thirty ay em"),
        ("14:00", "two pee em"),
        ("9 am", "nine ay em"),
        ("5pm", "five pee em"),
        ("8:05 p.m.", "eight oh five pee em"),
        ("17:45", "five forty-five pee em"),
        ("9:30", "nine thirty"),
    ]);
}

#[test]
fn symbols_are_named() {
    check(&[
        ("50%", "fifty percent"),
        ("Tom & Jo", "tom and jo"),
        ("meet @ 7", "meet at seven"),
        ("and/or", "and or"),
        ("yes/no", "yes or no"),
        ("1/2", "one slash two"),
        ("#5", "number five"),
        ("2 + 2", "two plus two"),
        ("9-5", "nine to five"),
        ("5th-6th", "fifth to sixth"),
        ("8am-6pm", "eight ay em to six pee em"),
        ("Mon-Fri", "monday to friday"),
        ("Sat-Sun", "saturday to sunday"),
        ("Wed", "wednesday"),
        ("Sun shines", "sun shines"),
    ]);
}

#[test]
fn units_after_a_number_are_said_in_full() {
    check(&[
        ("38 kL", "thirty-eight kilolitres"),
        ("1 kL", "one kilolitre"),
        ("450kWh", "four hundred and fifty kilowatt hours"),
        ("12 km", "twelve kilometres"),
        ("2.5kg", "two point five kilograms"),
        ("250 mL", "two hundred and fifty millilitres"),
        ("2 L", "two litres"),
        ("60 km/h", "sixty kilometres per hour"),
    ]);
}

#[test]
fn common_abbreviations_are_said_in_full() {
    check(&[
        ("12 Smith St", "twelve smith street"),
        ("St Kilda", "saint kilda"),
        ("4 Hay Rd", "four hay road"),
        ("Ocean Ave", "ocean avenue"),
        ("Mr. Lee", "mister lee"),
        ("Mrs Lee", "missus lee"),
        ("Ms Lee", "miz lee"),
        ("Dr Lee", "doctor lee"),
        ("No. 5", "number five"),
        ("Ref 12", "reference twelve"),
        ("Acct 12", "account twelve"),
        ("incl GST", "including gee ess tee"),
        ("BPAY", "bee pay"),
    ]);
}

#[test]
fn web_and_email_addresses_are_read_out() {
    check(&[
        ("sunvalewater.example", "sunvale water dot example"),
        ("help@x.com", "help at x dot com"),
        (
            "https://www.x.com.au/pay",
            "double-you double-you double-you dot x dot com dot au slash pay",
        ),
        (
            "accounts.payable@acme.com.au",
            "accounts dot payable at acme dot com dot au",
        ),
    ]);
}

#[test]
fn codes_are_spelled() {
    check(&[
        ("ABC123", "ay bee see one two three"),
        ("NSW", "en ess double-you"),
        ("QLD 4000", "cue el dee four thousand"),
    ]);
}

#[test]
fn the_spike_sentences_are_plain_words_with_their_pauses() {
    let said = speakable("You owe $142.60. Please pay by 14 November 2026. Call 1300 555 019.");
    let pauses: Vec<u32> = said.iter().map(|c| c.pause_ms).collect();
    assert_eq!(
        spoken_line(&said),
        "you owe one hundred and forty-two dollars and sixty cents. \
         please pay by the fourteenth of november, two thousand and twenty-six. \
         call one three zero zero, five five five, zero one nine"
    );
    assert_eq!(pauses, [0, 250, 150, 250, 150, 150]);

    check(&[
        (
            "Pensioners may get a 50% concession: call 08 9555 0100.",
            "pensioners may get a fifty percent concession, \
             call zero eight, nine five five five, zero one zero zero",
        ),
        (
            "BPAY biller code 4455, reference 881204.",
            "bee pay biller code four thousand four hundred and fifty-five, \
             reference eight eight one two zero four",
        ),
    ]);
}

#[test]
fn sentences_end_at_stops_and_lines_and_clauses_at_commas_colons_and_semicolons() {
    check(&[
        ("Step 1. Turn the dial.", "step one. turn the dial"),
        ("Due now\nPay online", "due now. pay online"),
        ("Hi; yes: no, maybe!", "hi, yes, no, maybe"),
        ("Wait - then go", "wait, then go"),
        ("Mr. Smith called. He left.", "mister smith called. he left"),
        (
            "Open at 9 a.m. Monday to Friday.",
            "open at nine ay em. monday to friday",
        ),
        ("“Hello,” she said.", "hello, she said"),
        ("", ""),
        ("?!. …", ""),
    ]);
}

#[test]
fn the_output_only_ever_holds_letters_spaces_apostrophes_and_hyphens() {
    let tricky = [
        "You owe $142.60. Please pay by 14 November 2026. Call 1300 555 019.",
        "Pensioners may get a 50% concession: call 08 9555 0100.",
        "BPAY biller code 4455, reference 881204.",
        "7 8 9 77 88 99 789 9,999,999,999,999 0.0789",
        "€50 £20 ¥100 ©2026 ™ ® § ¶ † ‡ • ° ± × ÷ ≈ ≠ ≤ ≥ ∞",
        "Café naïve résumé – em—dash ... “quotes” ‘single’ (brackets) [x] {y} <z>",
        "😀 🎉 中文 日本語 العربية",
        "$ % & @ # + = / \\ | ~ ^ * _ ` < >",
        "a.b.c. U.S.A. e.g. i.e. etc. 5th-6th 10:99 25:00 99/99/9999 1/2/3/4",
        "$.50 $1.5 $1,23 1,2,3 --5 +-3 2026-27 1300-555 0x1F A1-B2",
        "mailto:help@x.com www. .com @@ a@b help@",
        "kL kWh 5 MJ 3 hrs 10 mins 50c 1 c",
        "it's rock-'n'-roll o'clock ' - '",
    ];
    for text in tricky {
        for clause in speakable(text) {
            assert!(!clause.text.is_empty(), "{text}");
            assert!(
                clause
                    .text
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || matches!(c, ' ' | '\'' | '-')),
                "{text} -> {}",
                clause.text
            );
            assert!(!clause.text.contains("  "), "{text} -> {}", clause.text);
        }
    }
}

#[test]
fn seven_eight_and_nine_are_said_everywhere() {
    check(&[
        ("7", "seven"),
        ("8", "eight"),
        ("9", "nine"),
        ("79", "seventy-nine"),
        ("87", "eighty-seven"),
        ("98", "ninety-eight"),
        (
            "789, 789",
            "seven hundred and eighty-nine, seven hundred and eighty-nine",
        ),
        (
            "07 8899 7788",
            "zero seven, eight eight nine nine, seven seven eight eight",
        ),
    ]);
}
