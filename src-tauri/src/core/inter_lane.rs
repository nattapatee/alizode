use super::lane_bus::HarnessLaneStatus;
use super::lane_inbox::LaneInbox;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvelopeKind {
    Peer,
    MentionRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterLaneEnvelope {
    pub id: String,
    pub from_lane_id: String,
    pub to_lane_id: String,
    pub message: String,
    pub done: bool,
    pub sent_at: i64,
    pub harness_id: Option<String>,
    pub kind: EnvelopeKind,
    pub mention_packet_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LaneSummary {
    pub lane_id: String,
    pub display_name: String,
    pub backend_id: String,
    pub status: HarnessLaneStatus,
    pub inbox_depth: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingPeerSummary {
    pub peer_lane_id: String,
    pub envelope_id: String,
    pub sent_at: i64,
}

#[derive(Debug)]
pub struct DrainAction {
    pub lane_id: String,
    pub prompt_text: String,
}

#[derive(Debug)]
pub struct DeliveryResult {
    pub delivered: bool,
    pub envelope_id: Option<String>,
    pub queued_depth: usize,
    pub drain: Option<DrainAction>,
    pub error: Option<String>,
}

#[derive(Debug)]
pub struct MentionFanOutResult {
    pub delivered: Vec<String>,
    pub failed: Vec<(String, String)>,
    pub drain_actions: Vec<DrainAction>,
}

#[derive(Debug, Clone)]
struct PendingSend {
    envelope_id: String,
    to_lane_id: String,
    sent_at: i64,
    mention_packet_id: Option<String>,
}

struct LaneState {
    display_name: String,
    backend_id: String,
    status: HarnessLaneStatus,
}

pub struct InterLaneCoordinator {
    lanes: HashMap<String, LaneState>,
    inboxes: HashMap<String, LaneInbox>,
    pending: HashMap<String, Vec<PendingSend>>,
    cancelled_pairs: HashSet<String>,
}

impl InterLaneCoordinator {
    pub fn new() -> Self {
        Self {
            lanes: HashMap::new(),
            inboxes: HashMap::new(),
            pending: HashMap::new(),
            cancelled_pairs: HashSet::new(),
        }
    }

    pub fn register_lane(&mut self, lane_id: &str, display_name: &str, backend_id: &str) {
        self.lanes.insert(
            lane_id.to_string(),
            LaneState {
                display_name: display_name.to_string(),
                backend_id: backend_id.to_string(),
                status: HarnessLaneStatus::Starting,
            },
        );
    }

    pub fn unregister_lane(&mut self, lane_id: &str) {
        self.lanes.remove(lane_id);
        self.inboxes.remove(lane_id);
        self.pending.remove(lane_id);
    }

    pub fn set_status(&mut self, lane_id: &str, status: HarnessLaneStatus) -> Option<DrainAction> {
        if let Some(lane) = self.lanes.get_mut(lane_id) {
            lane.status = status.clone();
        }
        if status == HarnessLaneStatus::Idle || status == HarnessLaneStatus::AwaitingPeer {
            return self.try_drain(lane_id);
        }
        None
    }

    pub fn list_lanes(&self) -> Vec<LaneSummary> {
        self.lanes
            .iter()
            .map(|(id, state)| LaneSummary {
                lane_id: id.clone(),
                display_name: state.display_name.clone(),
                backend_id: state.backend_id.clone(),
                status: state.status.clone(),
                inbox_depth: self
                    .inboxes
                    .get(id)
                    .map(|i| i.depth())
                    .unwrap_or(0),
            })
            .collect()
    }

    pub fn inbox_depth(&self, lane_id: &str) -> usize {
        self.inboxes.get(lane_id).map(|i| i.depth()).unwrap_or(0)
    }

    pub fn pending_peers_for(&self, lane_id: &str) -> Vec<PendingPeerSummary> {
        self.pending
            .get(lane_id)
            .map(|sends| {
                sends
                    .iter()
                    .map(|s| PendingPeerSummary {
                        peer_lane_id: s.to_lane_id.clone(),
                        envelope_id: s.envelope_id.clone(),
                        sent_at: s.sent_at,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn deliver(&mut self, env: InterLaneEnvelope) -> DeliveryResult {
        let from = &env.from_lane_id;
        let to = &env.to_lane_id;

        if from == to {
            return DeliveryResult {
                delivered: false,
                envelope_id: None,
                queued_depth: 0,
                drain: None,
                error: Some("cannot send to self".into()),
            };
        }

        let target = match self.lanes.get(to) {
            Some(t) => t,
            None => {
                return DeliveryResult {
                    delivered: false,
                    envelope_id: None,
                    queued_depth: 0,
                    drain: None,
                    error: Some(format!("lane not found: {to}")),
                }
            }
        };

        if target.status == HarnessLaneStatus::Stopped {
            return DeliveryResult {
                delivered: false,
                envelope_id: None,
                queued_depth: 0,
                drain: None,
                error: Some(format!("lane stopped: {to}")),
            };
        }

        let pair_key = format!("{from}::{to}");
        if self.cancelled_pairs.contains(&pair_key) {
            return DeliveryResult {
                delivered: false,
                envelope_id: None,
                queued_depth: 0,
                drain: None,
                error: Some("conversation cancelled".into()),
            };
        }

        if self.has_pending(from, to) {
            return DeliveryResult {
                delivered: false,
                envelope_id: None,
                queued_depth: self.inbox_depth(to),
                drain: None,
                error: Some("peer_in_flight: already waiting for reply".into()),
            };
        }

        let env_id = env.id.clone();
        let to_lane_id = env.to_lane_id.clone();
        let sent_at = env.sent_at;
        let mention_packet_id = env.mention_packet_id.clone();
        let is_done = env.done;
        let from_owned = from.to_string();

        let inbox = self
            .inboxes
            .entry(to_lane_id.clone())
            .or_insert_with(|| LaneInbox::new(to_lane_id.clone()));
        inbox.push(env);
        let queued_depth = inbox.depth();

        if !is_done {
            self.pending
                .entry(from_owned)
                .or_default()
                .push(PendingSend {
                    envelope_id: env_id.clone(),
                    to_lane_id: to_lane_id.clone(),
                    sent_at,
                    mention_packet_id,
                });
        }

        let drain = if let Some(target) = self.lanes.get(&to_lane_id) {
            if target.status == HarnessLaneStatus::Idle
                || target.status == HarnessLaneStatus::AwaitingPeer
            {
                self.try_drain(&to_lane_id)
            } else {
                None
            }
        } else {
            None
        };

        DeliveryResult {
            delivered: true,
            envelope_id: Some(env_id),
            queued_depth,
            drain,
            error: None,
        }
    }

    pub fn deliver_mention_fan_out(
        &mut self,
        requester_id: &str,
        requester_display_name: &str,
        targets: &[(String, String)],
        body: &str,
        harness_id: Option<&str>,
    ) -> MentionFanOutResult {
        let packet_id = crate::util::ids::new_id();
        let now = now_ms();
        let mut delivered = Vec::new();
        let mut failed = Vec::new();
        let mut drain_actions = Vec::new();

        for (target_id, _target_name) in targets {
            let env = InterLaneEnvelope {
                id: crate::util::ids::new_id(),
                from_lane_id: requester_id.to_string(),
                to_lane_id: target_id.clone(),
                message: format!(
                    "[mention from @{requester_display_name}]\n\n{body}"
                ),
                done: false,
                sent_at: now,
                harness_id: harness_id.map(|s| s.to_string()),
                kind: EnvelopeKind::MentionRequest,
                mention_packet_id: Some(packet_id.clone()),
            };
            let result = self.deliver(env);
            if result.delivered {
                delivered.push(target_id.clone());
                if let Some(drain) = result.drain {
                    drain_actions.push(drain);
                }
            } else {
                failed.push((
                    target_id.clone(),
                    result.error.unwrap_or_else(|| "unknown".into()),
                ));
            }
        }

        MentionFanOutResult {
            delivered,
            failed,
            drain_actions,
        }
    }

    pub fn on_lane_stop(&mut self, lane_id: &str) -> Option<HarnessLaneStatus> {
        let has_pending = self
            .pending
            .get(lane_id)
            .map(|v| !v.is_empty())
            .unwrap_or(false);

        if has_pending {
            if let Some(lane) = self.lanes.get_mut(lane_id) {
                lane.status = HarnessLaneStatus::AwaitingPeer;
            }
            Some(HarnessLaneStatus::AwaitingPeer)
        } else {
            if let Some(lane) = self.lanes.get_mut(lane_id) {
                lane.status = HarnessLaneStatus::Idle;
            }
            Some(HarnessLaneStatus::Idle)
        }
    }

    pub fn cancel_conversations_for(&mut self, lane_id: &str) {
        if let Some(sends) = self.pending.remove(lane_id) {
            for send in &sends {
                let pair = format!("{lane_id}::{}", send.to_lane_id);
                self.cancelled_pairs.insert(pair);
                let reverse = format!("{}::{lane_id}", send.to_lane_id);
                self.cancelled_pairs.insert(reverse);
            }
        }
        let peers_pending_to_me: Vec<String> = self
            .pending
            .iter()
            .filter(|(_, sends)| sends.iter().any(|s| s.to_lane_id == lane_id))
            .map(|(k, _)| k.clone())
            .collect();
        for peer in peers_pending_to_me {
            if let Some(sends) = self.pending.get_mut(&peer) {
                sends.retain(|s| s.to_lane_id != lane_id);
            }
        }
    }

    pub fn on_lane_closed(&mut self, lane_id: &str, _display_name: &str) {
        self.cancel_conversations_for(lane_id);
        self.unregister_lane(lane_id);
    }

    fn has_pending(&self, from: &str, to: &str) -> bool {
        self.pending
            .get(from)
            .map(|sends| sends.iter().any(|s| s.to_lane_id == to))
            .unwrap_or(false)
    }

    fn try_drain(&mut self, lane_id: &str) -> Option<DrainAction> {
        let inbox = self.inboxes.get_mut(lane_id)?;
        let envelopes = inbox.drain();
        if envelopes.is_empty() {
            return None;
        }

        for env in &envelopes {
            if env.done || env.kind == EnvelopeKind::MentionRequest {
                self.clear_pending_from_peer(&env.from_lane_id, lane_id);
            }
        }

        let prompt_text = compose_prompt(&envelopes, &self.lanes);

        Some(DrainAction {
            lane_id: lane_id.to_string(),
            prompt_text,
        })
    }

    fn clear_pending_from_peer(&mut self, requester_id: &str, replier_id: &str) {
        if let Some(sends) = self.pending.get_mut(requester_id) {
            sends.retain(|s| s.to_lane_id != replier_id);
            if sends.is_empty() {
                self.pending.remove(requester_id);
            }
        }
    }
}

impl Default for InterLaneCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

fn compose_prompt(envelopes: &[InterLaneEnvelope], lanes: &HashMap<String, LaneState>) -> String {
    let mut parts = Vec::new();

    for env in envelopes {
        let sender_name = lanes
            .get(&env.from_lane_id)
            .map(|l| l.display_name.as_str())
            .unwrap_or(&env.from_lane_id);

        if env.done {
            parts.push(format!(
                "[inter-lane] {sender_name} closed the conversation (done:true).\n\
                 Do NOT call peer_send again. End your turn."
            ));
        } else if env.kind == EnvelopeKind::MentionRequest {
            parts.push(format!(
                "[mention] From {sender_name}:\n\n{}\n\n\
                 Reply via peer_send({{ to_lane: \"{}\", message, done: true }}).",
                env.message, env.from_lane_id,
            ));
        } else {
            parts.push(format!(
                "[inter-lane] From {sender_name} (id: {}):\n\n{}\n\n\
                 [inter-lane] Reply by calling peer_send({{ to_lane: \"{}\", message, done }}).\n\
                 Set done:true if you have nothing substantive to add; the conversation ends silently.",
                env.id, env.message, env.from_lane_id,
            ));
        }
    }

    parts.join("\n\n---\n\n")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> InterLaneCoordinator {
        let mut coord = InterLaneCoordinator::new();
        coord.register_lane("a", "Lane A", "claude");
        coord.register_lane("b", "Lane B", "claude");
        coord.set_status("a", HarnessLaneStatus::Idle);
        coord.set_status("b", HarnessLaneStatus::Idle);
        coord
    }

    fn env(from: &str, to: &str) -> InterLaneEnvelope {
        InterLaneEnvelope {
            id: crate::util::ids::new_id(),
            from_lane_id: from.to_string(),
            to_lane_id: to.to_string(),
            message: "hello from peer".to_string(),
            done: false,
            sent_at: now_ms(),
            harness_id: None,
            kind: EnvelopeKind::Peer,
            mention_packet_id: None,
        }
    }

    #[test]
    fn deliver_to_idle_drains_immediately() {
        let mut coord = setup();
        let result = coord.deliver(env("a", "b"));
        assert!(result.delivered);
        assert!(result.drain.is_some());
        let drain = result.drain.unwrap();
        assert_eq!(drain.lane_id, "b");
        assert!(drain.prompt_text.contains("[inter-lane]"));
    }

    #[test]
    fn deliver_to_busy_queues() {
        let mut coord = setup();
        coord.set_status("b", HarnessLaneStatus::Busy);
        let result = coord.deliver(env("a", "b"));
        assert!(result.delivered);
        assert!(result.drain.is_none());
        assert_eq!(result.queued_depth, 1);
    }

    #[test]
    fn drain_on_idle_transition() {
        let mut coord = setup();
        coord.set_status("b", HarnessLaneStatus::Busy);
        coord.deliver(env("a", "b"));
        let drain = coord.set_status("b", HarnessLaneStatus::Idle);
        assert!(drain.is_some());
    }

    #[test]
    fn self_send_rejected() {
        let mut coord = setup();
        let result = coord.deliver(env("a", "a"));
        assert!(!result.delivered);
        assert!(result.error.unwrap().contains("self"));
    }

    #[test]
    fn stopped_lane_rejected() {
        let mut coord = setup();
        coord.set_status("b", HarnessLaneStatus::Stopped);
        let result = coord.deliver(env("a", "b"));
        assert!(!result.delivered);
        assert!(result.error.unwrap().contains("stopped"));
    }

    #[test]
    fn duplicate_pending_rejected() {
        let mut coord = setup();
        coord.set_status("b", HarnessLaneStatus::Busy);
        let r1 = coord.deliver(env("a", "b"));
        assert!(r1.delivered);
        let r2 = coord.deliver(env("a", "b"));
        assert!(!r2.delivered);
        assert!(r2.error.unwrap().contains("in_flight"));
    }

    #[test]
    fn on_lane_stop_sets_awaiting_peer() {
        let mut coord = setup();
        coord.set_status("b", HarnessLaneStatus::Busy);
        coord.deliver(env("a", "b"));
        let next = coord.on_lane_stop("a");
        assert_eq!(next, Some(HarnessLaneStatus::AwaitingPeer));
    }

    #[test]
    fn on_lane_stop_idle_when_no_pending() {
        let mut coord = setup();
        let next = coord.on_lane_stop("a");
        assert_eq!(next, Some(HarnessLaneStatus::Idle));
    }

    #[test]
    fn cancel_conversations_tombstones() {
        let mut coord = setup();
        coord.set_status("b", HarnessLaneStatus::Busy);
        coord.deliver(env("a", "b"));
        coord.cancel_conversations_for("a");
        let result = coord.deliver(env("a", "b"));
        assert!(!result.delivered);
        assert!(result.error.unwrap().contains("cancelled"));
    }

    #[test]
    fn on_lane_closed_cleans_up() {
        let mut coord = setup();
        coord.on_lane_closed("b", "Lane B");
        assert_eq!(coord.list_lanes().len(), 1);
        assert_eq!(coord.inbox_depth("b"), 0);
    }

    #[test]
    fn mention_fan_out_delivers_to_multiple() {
        let mut coord = setup();
        coord.register_lane("c", "Lane C", "codex");
        coord.set_status("c", HarnessLaneStatus::Idle);

        let result = coord.deliver_mention_fan_out(
            "a",
            "Lane A",
            &[
                ("b".into(), "Lane B".into()),
                ("c".into(), "Lane C".into()),
            ],
            "review this code please",
            None,
        );

        assert_eq!(result.delivered.len(), 2);
        assert!(result.failed.is_empty());
        assert_eq!(result.drain_actions.len(), 2);
    }
}
