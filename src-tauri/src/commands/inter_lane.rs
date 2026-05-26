use crate::core::inter_lane::{EnvelopeKind, InterLaneEnvelope};
use crate::core::lane_bus::HarnessLaneStatus;
use crate::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct DrainActionResult {
    pub lane_id: String,
    pub prompt_text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeliverResult {
    pub delivered: bool,
    pub envelope_id: Option<String>,
    pub queued_depth: usize,
    pub drain: Option<DrainActionResult>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MentionFanOutResultDto {
    pub delivered: Vec<String>,
    pub failed: Vec<(String, String)>,
    pub drain_actions: Vec<DrainActionResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LaneSummaryDto {
    pub lane_id: String,
    pub display_name: String,
    pub backend_id: String,
    pub status: String,
    pub inbox_depth: usize,
}

#[tauri::command]
pub fn inter_lane_register(
    state: State<'_, AppState>,
    lane_id: String,
    display_name: String,
    backend_id: String,
) {
    let mut coord = state.coordinator.lock().unwrap();
    coord.register_lane(&lane_id, &display_name, &backend_id);
}

#[tauri::command]
pub fn inter_lane_unregister(
    state: State<'_, AppState>,
    lane_id: String,
    display_name: String,
) {
    let mut coord = state.coordinator.lock().unwrap();
    coord.on_lane_closed(&lane_id, &display_name);
}

#[tauri::command]
pub fn inter_lane_set_status(
    state: State<'_, AppState>,
    lane_id: String,
    status: String,
) -> Option<DrainActionResult> {
    let parsed = match status.as_str() {
        "starting" => HarnessLaneStatus::Starting,
        "idle" => HarnessLaneStatus::Idle,
        "busy" => HarnessLaneStatus::Busy,
        "needs_permission" => HarnessLaneStatus::NeedsPermission,
        "awaiting_peer" => HarnessLaneStatus::AwaitingPeer,
        "error" => HarnessLaneStatus::Error,
        "stopped" => HarnessLaneStatus::Stopped,
        _ => return None,
    };
    let mut coord = state.coordinator.lock().unwrap();
    coord.set_status(&lane_id, parsed).map(|d| DrainActionResult {
        lane_id: d.lane_id,
        prompt_text: d.prompt_text,
    })
}

#[tauri::command]
pub fn inter_lane_on_stop(
    state: State<'_, AppState>,
    lane_id: String,
) -> Option<String> {
    let mut coord = state.coordinator.lock().unwrap();
    coord.on_lane_stop(&lane_id).map(|s| s.as_str().to_string())
}

#[tauri::command]
pub fn inter_lane_deliver(
    state: State<'_, AppState>,
    from_lane_id: String,
    to_lane_id: String,
    message: String,
    done: bool,
) -> DeliverResult {
    let env = InterLaneEnvelope {
        id: crate::util::ids::new_id(),
        from_lane_id,
        to_lane_id,
        message,
        done,
        sent_at: now_ms(),
        harness_id: None,
        kind: EnvelopeKind::Peer,
        mention_packet_id: None,
    };
    let mut coord = state.coordinator.lock().unwrap();
    let r = coord.deliver(env);
    DeliverResult {
        delivered: r.delivered,
        envelope_id: r.envelope_id,
        queued_depth: r.queued_depth,
        drain: r.drain.map(|d| DrainActionResult {
            lane_id: d.lane_id,
            prompt_text: d.prompt_text,
        }),
        error: r.error,
    }
}

#[tauri::command]
pub fn inter_lane_mention_fan_out(
    state: State<'_, AppState>,
    from_lane_id: String,
    from_display_name: String,
    targets: Vec<(String, String)>,
    body: String,
) -> MentionFanOutResultDto {
    let mut coord = state.coordinator.lock().unwrap();
    let r = coord.deliver_mention_fan_out(
        &from_lane_id,
        &from_display_name,
        &targets,
        &body,
        None,
    );
    MentionFanOutResultDto {
        delivered: r.delivered,
        failed: r.failed,
        drain_actions: r.drain_actions
            .into_iter()
            .map(|d| DrainActionResult {
                lane_id: d.lane_id,
                prompt_text: d.prompt_text,
            })
            .collect(),
    }
}

#[tauri::command]
pub fn inter_lane_list(
    state: State<'_, AppState>,
) -> Vec<LaneSummaryDto> {
    let coord = state.coordinator.lock().unwrap();
    coord
        .list_lanes()
        .into_iter()
        .map(|s| LaneSummaryDto {
            lane_id: s.lane_id,
            display_name: s.display_name,
            backend_id: s.backend_id,
            status: s.status.as_str().to_string(),
            inbox_depth: s.inbox_depth,
        })
        .collect()
}

#[tauri::command]
pub fn inter_lane_cancel(
    state: State<'_, AppState>,
    lane_id: String,
) {
    let mut coord = state.coordinator.lock().unwrap();
    coord.cancel_conversations_for(&lane_id);
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
