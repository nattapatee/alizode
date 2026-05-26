use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Clone)]
pub struct MarkdownEntry {
    pub path: String,
    pub name: String,
    pub folder: String,
}

fn scan_dir(base: &Path, dir: &Path, entries: &mut Vec<MarkdownEntry>) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    let mut items: Vec<_> = read.filter_map(|e| e.ok()).collect();
    items.sort_by_key(|e| e.file_name());

    for entry in items {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            scan_dir(base, &path, entries);
        } else if path.extension().is_some_and(|e| e == "md" || e == "mdx") {
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            let folder = path
                .parent()
                .and_then(|p| p.strip_prefix(base).ok())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            entries.push(MarkdownEntry {
                path: rel,
                name,
                folder,
            });
        }
    }
}

#[tauri::command]
pub fn scan_markdown_files(root: String) -> Result<Vec<MarkdownEntry>, String> {
    let base = Path::new(&root);
    if !base.is_dir() {
        return Err(format!("Not a directory: {root}"));
    }
    let mut entries = Vec::new();
    scan_dir(base, base, &mut entries);
    Ok(entries)
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

#[derive(Serialize, Clone)]
pub struct DirEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", ".git", ".next", "dist", "build",
    "__pycache__", ".svn", ".hg", "vendor",
];

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    let read = std::fs::read_dir(dir).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let mut items: Vec<_> = read.filter_map(|e| e.ok()).collect();
    items.sort_by_key(|e| {
        let is_file = e.path().is_file();
        (is_file, e.file_name())
    });

    let entries: Vec<DirEntry> = items
        .into_iter()
        .filter_map(|entry| {
            let p = entry.path();
            let name = p.file_name()?.to_string_lossy().to_string();
            if name.starts_with('.') && p.is_dir() {
                return None;
            }
            if p.is_dir() && SKIP_DIRS.contains(&name.as_str()) {
                return None;
            }
            Some(DirEntry {
                path: p.to_string_lossy().to_string(),
                name,
                is_dir: p.is_dir(),
            })
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dirs for {path}: {e}"))?;
    }
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {path}: {e}"))
}
