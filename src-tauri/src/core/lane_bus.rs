use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessLaneStatus {
    Starting,
    Idle,
    Busy,
    NeedsPermission,
    AwaitingPeer,
    Error,
    Stopped,
}

impl HarnessLaneStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Idle => "idle",
            Self::Busy => "busy",
            Self::NeedsPermission => "needs_permission",
            Self::AwaitingPeer => "awaiting_peer",
            Self::Error => "error",
            Self::Stopped => "stopped",
        }
    }
}

#[derive(Debug, Clone)]
pub enum LaneBusEvent {
    Status {
        lane_id: String,
        prev: HarnessLaneStatus,
        next: HarnessLaneStatus,
        at: i64,
    },
    Spawned {
        lane_id: String,
    },
    Closed {
        lane_id: String,
        display_name: String,
    },
}

type Handler = Arc<dyn Fn(&LaneBusEvent) + Send + Sync>;

pub struct LaneBus {
    handlers: Mutex<Vec<Handler>>,
}

impl LaneBus {
    pub fn new() -> Self {
        Self {
            handlers: Mutex::new(Vec::new()),
        }
    }

    pub fn subscribe<F>(&self, handler: F) -> usize
    where
        F: Fn(&LaneBusEvent) + Send + Sync + 'static,
    {
        let mut handlers = self.handlers.lock().unwrap();
        let id = handlers.len();
        handlers.push(Arc::new(handler));
        id
    }

    pub fn emit(&self, event: &LaneBusEvent) {
        let handlers = self.handlers.lock().unwrap().clone();
        for handler in &handlers {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                handler(event);
            }));
        }
    }
}

impl Default for LaneBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn subscribe_and_emit() {
        let bus = LaneBus::new();
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        bus.subscribe(move |_| {
            c.fetch_add(1, Ordering::Relaxed);
        });
        bus.emit(&LaneBusEvent::Spawned {
            lane_id: "test".into(),
        });
        assert_eq!(count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn bad_subscriber_does_not_break_bus() {
        let bus = LaneBus::new();
        let reached = Arc::new(AtomicUsize::new(0));
        bus.subscribe(|_| panic!("bad subscriber"));
        let r = reached.clone();
        bus.subscribe(move |_| {
            r.fetch_add(1, Ordering::Relaxed);
        });
        bus.emit(&LaneBusEvent::Spawned {
            lane_id: "test".into(),
        });
        assert_eq!(reached.load(Ordering::Relaxed), 1);
    }
}
