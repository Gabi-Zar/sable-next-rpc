use std::time::Duration;

use web_time::Instant;

use crate::protocol::VectorDiff;

/// Emits at once when nothing went out within `interval`, otherwise holds the
/// diffs until it ends, so a burst crosses to the page as one event.
pub(crate) struct DiffBatch<T> {
    pending: Vec<VectorDiff<T>>,
    emitted_at: Option<Instant>,
    interval: Duration,
}

impl<T> DiffBatch<T> {
    pub(crate) const fn new(interval: Duration) -> Self {
        Self {
            pending: Vec::new(),
            emitted_at: None,
            interval,
        }
    }

    /// The diffs to emit now, if any; held ones are due after `wait`.
    pub(crate) fn push(
        &mut self,
        diffs: Vec<VectorDiff<T>>,
        now: Instant,
    ) -> Option<Vec<VectorDiff<T>>> {
        self.pending.extend(diffs);
        (self.wait(now)? == Duration::ZERO).then(|| self.take(now))
    }

    pub(crate) fn wait(&self, now: Instant) -> Option<Duration> {
        if self.pending.is_empty() {
            return None;
        }
        Some(self.emitted_at.map_or(Duration::ZERO, |at| {
            (at + self.interval).saturating_duration_since(now)
        }))
    }

    pub(crate) fn take(&mut self, now: Instant) -> Vec<VectorDiff<T>> {
        self.emitted_at = Some(now);
        std::mem::take(&mut self.pending)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INTERVAL: Duration = Duration::from_millis(100);

    fn set(value: u32) -> VectorDiff<u32> {
        VectorDiff::Set { index: 0, value }
    }

    #[test]
    fn emits_at_once_when_nothing_went_out_lately() {
        let mut batch = DiffBatch::new(INTERVAL);
        let now = Instant::now();

        assert_eq!(
            batch.push(vec![set(1)], now).map(|diffs| diffs.len()),
            Some(1)
        );
        assert_eq!(batch.wait(now), None);
    }

    #[test]
    fn holds_a_burst_until_the_interval_ends() {
        let mut batch = DiffBatch::new(INTERVAL);
        let start = Instant::now();
        assert!(batch.push(vec![set(1)], start).is_some());

        let later = start + Duration::from_millis(10);
        assert!(batch.push(vec![set(2)], later).is_none());
        assert!(batch.push(vec![set(3)], later).is_none());
        assert_eq!(batch.wait(later), Some(Duration::from_millis(90)));

        assert_eq!(batch.take(start + INTERVAL).len(), 2);
        assert_eq!(batch.wait(start + INTERVAL), None);
    }

    #[test]
    fn emits_at_once_again_after_a_quiet_interval() {
        let mut batch = DiffBatch::new(INTERVAL);
        let start = Instant::now();
        assert!(batch.push(vec![set(1)], start).is_some());

        assert!(batch.push(vec![set(2)], start + INTERVAL).is_some());
    }

    #[test]
    fn an_empty_push_emits_nothing() {
        let mut batch: DiffBatch<u32> = DiffBatch::new(INTERVAL);

        assert!(batch.push(Vec::new(), Instant::now()).is_none());
    }
}
