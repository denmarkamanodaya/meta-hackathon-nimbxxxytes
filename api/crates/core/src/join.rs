//! Runs two futures at once on the current task, so a use case can overlap a slow model call with
//! local work without a runtime dependency in the core.

use std::future::{Future, poll_fn};
use std::pin::pin;
use std::task::Poll;

/// Drives `a` and `b` together and returns both outputs. `a` is polled first on every wake, so
/// when both are ready at once `a`'s side effects happen first.
pub async fn join<A: Future, B: Future>(a: A, b: B) -> (A::Output, B::Output) {
    let mut a = pin!(a);
    let mut b = pin!(b);
    let mut out_a = None;
    let mut out_b = None;
    poll_fn(move |cx| {
        if out_a.is_none()
            && let Poll::Ready(v) = a.as_mut().poll(cx)
        {
            out_a = Some(v);
        }
        if out_b.is_none()
            && let Poll::Ready(v) = b.as_mut().poll(cx)
        {
            out_b = Some(v);
        }
        match (out_a.take(), out_b.take()) {
            (Some(x), Some(y)) => Poll::Ready((x, y)),
            (x, y) => {
                out_a = x;
                out_b = y;
                Poll::Pending
            }
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::future::poll_fn;
    use std::task::{Context, Poll, Waker};

    use super::*;

    /// A future that is pending `n` times before it answers, noting each poll in `log`.
    fn pending_for<'a>(
        n: u32,
        name: &'a str,
        log: &'a RefCell<Vec<&'a str>>,
    ) -> impl Future<Output = &'a str> {
        let mut left = n;
        poll_fn(move |cx| {
            log.borrow_mut().push(name);
            if left == 0 {
                Poll::Ready(name)
            } else {
                left -= 1;
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        })
    }

    fn block_on<F: Future>(f: F) -> F::Output {
        let mut f = pin!(f);
        let mut cx = Context::from_waker(Waker::noop());
        loop {
            if let Poll::Ready(v) = f.as_mut().poll(&mut cx) {
                return v;
            }
        }
    }

    #[test]
    fn both_sides_make_progress_and_a_finished_side_is_never_polled_again() {
        let log = RefCell::new(Vec::new());

        let out = block_on(join(pending_for(0, "a", &log), pending_for(2, "b", &log)));

        assert_eq!(out, ("a", "b"));
        assert_eq!(*log.borrow(), ["a", "b", "b", "b"]);
    }

    #[test]
    fn a_slow_first_side_does_not_hold_back_the_second() {
        let log = RefCell::new(Vec::new());

        let out = block_on(join(pending_for(2, "a", &log), pending_for(0, "b", &log)));

        assert_eq!(out, ("a", "b"));
        assert_eq!(*log.borrow(), ["a", "b", "a", "a"]);
    }
}
