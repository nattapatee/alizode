use super::inter_lane::InterLaneEnvelope;

pub struct LaneInbox {
    pub lane_id: String,
    queue: Vec<InterLaneEnvelope>,
}

impl LaneInbox {
    pub fn new(lane_id: String) -> Self {
        Self {
            lane_id,
            queue: Vec::new(),
        }
    }

    pub fn push(&mut self, env: InterLaneEnvelope) {
        self.queue.push(env);
    }

    pub fn drain(&mut self) -> Vec<InterLaneEnvelope> {
        std::mem::take(&mut self.queue)
    }

    pub fn depth(&self) -> usize {
        self.queue.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_env(id: &str, from: &str, to: &str) -> InterLaneEnvelope {
        InterLaneEnvelope {
            id: id.to_string(),
            from_lane_id: from.to_string(),
            to_lane_id: to.to_string(),
            message: "hello".to_string(),
            done: false,
            sent_at: 1000,
            harness_id: None,
            kind: super::super::inter_lane::EnvelopeKind::Peer,
            mention_packet_id: None,
        }
    }

    #[test]
    fn push_drain_depth() {
        let mut inbox = LaneInbox::new("lane-1".into());
        assert_eq!(inbox.depth(), 0);
        inbox.push(make_env("e1", "a", "lane-1"));
        inbox.push(make_env("e2", "b", "lane-1"));
        assert_eq!(inbox.depth(), 2);
        let drained = inbox.drain();
        assert_eq!(drained.len(), 2);
        assert_eq!(inbox.depth(), 0);
    }
}
