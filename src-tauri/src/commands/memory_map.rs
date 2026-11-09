use tetra_launch::memory_map::MemoryMapStatus;

/// The current `vm.max_map_count` limit when it is below what DayZ needs, or
/// `None` when it is fine or unreadable. Linux only; `None` elsewhere.
#[tauri::command]
pub fn get_memory_map_status() -> Option<MemoryMapStatus> {
    tetra_launch::memory_map::current_status()
}
