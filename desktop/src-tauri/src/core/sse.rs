//! Incremental `text/event-stream` parser: feed raw chunks, get whole events back. Keep-alive
//! comments (`:` lines) and `id` / `retry` fields are dropped; the web layer needs only the event
//! name and its data.

use serde::Serialize;

/// One dispatched event, as the `api_stream` channel sends it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SseEvent {
    /// `event:` field; `None` for unnamed events.
    pub event: Option<String>,
    /// `data:` lines joined with `\n`.
    pub data: String,
}

/// Name of the last event every stream sends, after the server closes it.
pub const END_EVENT: &str = "__end";

/// Parser state between chunks.
#[derive(Debug, Default)]
pub struct SseParser {
    buffer: String,
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    /// Adds a chunk and returns every event it completed, in order.
    pub fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buffer.push_str(chunk);
        let mut out = Vec::new();
        while let Some(end) = self.buffer.find('\n') {
            let line: String = self.buffer.drain(..=end).collect();
            let line = line.trim_end_matches(['\n', '\r']);
            if let Some(event) = self.line(line) {
                out.push(event);
            }
        }
        out
    }

    fn line(&mut self, line: &str) -> Option<SseEvent> {
        if line.is_empty() {
            if self.data.is_empty() && self.event.is_none() {
                return None;
            }
            return Some(SseEvent {
                event: self.event.take(),
                data: std::mem::take(&mut self.data).join("\n"),
            });
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => self.event = Some(value.to_owned()),
            "data" => self.data.push(value.to_owned()),
            _ => {}
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_split_across_chunks_come_out_whole() {
        let mut parser = SseParser::default();
        assert!(parser.push("data: {\"st").is_empty());
        let events =
            parser.push("ep\":1}\n\n: keep-alive\n\nevent: done\ndata: a\ndata: b\r\n\r\n");
        assert_eq!(
            events,
            vec![
                SseEvent {
                    event: None,
                    data: "{\"step\":1}".into()
                },
                SseEvent {
                    event: Some("done".into()),
                    data: "a\nb".into()
                },
            ]
        );
    }
}
