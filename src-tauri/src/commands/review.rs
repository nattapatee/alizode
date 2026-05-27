use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::process::Command;

const TOTAL_PATCH_CAP: usize = 40_960;
const PER_FILE_HUNK_CAP: usize = 8_192;
const UNTRACKED_HEAD_LINES: usize = 40;
const UNTRACKED_HEAD_BYTES: usize = 4_096;

fn safe_truncate(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn hash_fingerprint(input: &str) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn empty_git_state(cwd: &str) -> Value {
    json!({
        "hasGitRepo": false,
        "repoRoot": cwd,
        "hasStagedChanges": false,
        "hasUnstagedChanges": false,
        "partialStagingDetected": false,
        "worktreeFingerprint": "",
        "diffstat": [],
        "patchHunks": [],
        "untrackedExcerpts": [],
    })
}

fn collect_git_state(cwd: &str) -> Value {
    if cwd.is_empty() {
        return empty_git_state(cwd);
    }
    let cwd_path = Path::new(cwd);

    let run = |args: &[&str]| -> Option<String> {
        let out = Command::new("git")
            .args(args)
            .current_dir(cwd_path)
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        String::from_utf8(out.stdout).ok()
    };

    let repo_root = match run(&["rev-parse", "--show-toplevel"]) {
        Some(s) => s.trim().to_string(),
        None => return empty_git_state(cwd),
    };

    let porcelain = run(&["status", "--porcelain=v1"]).unwrap_or_default();
    let head_sha = run(&["rev-parse", "HEAD"]).unwrap_or_default();
    let staged_raw = run(&["--no-pager", "diff", "--no-ext-diff", "--cached", "--name-only"])
        .unwrap_or_default();
    let unstaged_raw =
        run(&["--no-pager", "diff", "--no-ext-diff", "--name-only"]).unwrap_or_default();
    let numstat_raw =
        run(&["--no-pager", "diff", "--no-ext-diff", "HEAD", "--numstat"]).unwrap_or_default();

    let staged_set: HashSet<String> = staged_raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let unstaged_set: HashSet<String> = unstaged_raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let partial_staging = staged_set.intersection(&unstaged_set).next().is_some();

    let mut tracked_paths: Vec<(String, char)> = Vec::new();
    let mut untracked_paths: Vec<String> = Vec::new();
    for line in porcelain.lines() {
        if line.len() < 3 {
            continue;
        }
        let xy = &line[..2];
        let raw_path = line[3..].trim().to_string();
        let path = if let Some(idx) = raw_path.find(" -> ") {
            raw_path[idx + 4..].to_string()
        } else {
            raw_path
        };
        if xy == "??" {
            untracked_paths.push(path);
        } else {
            let status = match xy.trim() {
                "M" | "MM" | "AM" | "RM" => 'M',
                "A" => 'A',
                "D" => 'D',
                "R" | "RD" => 'R',
                _ => 'M',
            };
            tracked_paths.push((path, status));
        }
    }

    let mut numstat: HashMap<String, (u64, u64)> = HashMap::new();
    for line in numstat_raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let added = parts[0].parse::<u64>().unwrap_or(0);
        let removed = parts[1].parse::<u64>().unwrap_or(0);
        numstat.insert(parts[2].to_string(), (added, removed));
    }

    let mut diffstat: Vec<Value> = Vec::new();
    for (path, status) in &tracked_paths {
        let (added, removed) = numstat.get(path).cloned().unwrap_or((0, 0));
        diffstat.push(json!({
            "path": path,
            "status": status.to_string(),
            "added": added,
            "removed": removed,
        }));
    }
    for path in &untracked_paths {
        diffstat.push(json!({
            "path": path,
            "status": "?",
            "added": 0,
            "removed": 0,
        }));
    }

    let mut total_size: usize = 0;
    let mut hunks: Vec<Value> = Vec::new();
    let mut tracked_sorted = tracked_paths.clone();
    tracked_sorted.sort_by(|a, b| {
        let (aa, ar) = numstat.get(&a.0).cloned().unwrap_or((0, 0));
        let (ba, br) = numstat.get(&b.0).cloned().unwrap_or((0, 0));
        (ba + br).cmp(&(aa + ar))
    });
    for (path, status) in &tracked_sorted {
        if total_size >= TOTAL_PATCH_CAP {
            hunks.push(json!({
                "path": path,
                "status": status.to_string(),
                "hunk": "",
                "truncated": true,
            }));
            continue;
        }
        let raw = run(&[
            "--no-pager",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "HEAD",
            "--",
            path,
        ])
        .unwrap_or_default();
        let (body, truncated) = if raw.len() > PER_FILE_HUNK_CAP {
            (safe_truncate(&raw, PER_FILE_HUNK_CAP).to_string(), true)
        } else {
            (raw, false)
        };
        total_size = total_size.saturating_add(body.len());
        hunks.push(json!({
            "path": path,
            "status": status.to_string(),
            "hunk": body,
            "truncated": truncated,
        }));
    }

    let mut untracked_excerpts: Vec<Value> = Vec::new();
    for path in &untracked_paths {
        if total_size >= TOTAL_PATCH_CAP {
            break;
        }
        let full = Path::new(&repo_root).join(path);
        let head = match std::fs::read(&full) {
            Ok(bytes) => {
                if bytes.iter().take(2048).any(|b| *b == 0) {
                    "<binary>".to_string()
                } else {
                    let slice = if bytes.len() > UNTRACKED_HEAD_BYTES {
                        &bytes[..UNTRACKED_HEAD_BYTES]
                    } else {
                        &bytes[..]
                    };
                    let text = String::from_utf8_lossy(slice);
                    text.lines()
                        .take(UNTRACKED_HEAD_LINES)
                        .collect::<Vec<_>>()
                        .join("\n")
                }
            }
            Err(_) => "<unreadable>".to_string(),
        };
        total_size = total_size.saturating_add(head.len());
        untracked_excerpts.push(json!({ "path": path, "head": head }));
    }

    let fingerprint_input = {
        let mut paths_meta: Vec<String> = Vec::new();
        for (path, _) in &tracked_paths {
            let full = Path::new(&repo_root).join(path);
            let meta = std::fs::metadata(&full).ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let mtime = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_millis() as u64)
                })
                .unwrap_or(0);
            paths_meta.push(format!("{}|{}|{}", path, size, mtime));
        }
        for path in &untracked_paths {
            let full = Path::new(&repo_root).join(path);
            let meta = std::fs::metadata(&full).ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let mtime = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_millis() as u64)
                })
                .unwrap_or(0);
            paths_meta.push(format!("{}|{}|{}", path, size, mtime));
        }
        paths_meta.sort();
        format!(
            "{}\n{}\n{}",
            head_sha.trim(),
            porcelain.trim(),
            paths_meta.join("\n")
        )
    };
    let fingerprint = hash_fingerprint(&fingerprint_input);

    json!({
        "hasGitRepo": true,
        "repoRoot": repo_root,
        "hasStagedChanges": !staged_set.is_empty(),
        "hasUnstagedChanges": !unstaged_set.is_empty(),
        "partialStagingDetected": partial_staging,
        "worktreeFingerprint": fingerprint,
        "diffstat": diffstat,
        "patchHunks": hunks,
        "untrackedExcerpts": untracked_excerpts,
    })
}

#[tauri::command]
pub async fn collect_review_git_state(cwd: String) -> Result<Value, String> {
    Ok(collect_git_state(&cwd))
}
