use super::{blocking_read, filter_from_params, FilterParams};
use crate::state::AppState;
use tauri::State;
use tetra_registry::{Facets, Suggestion};

/// The count the whole filter matches, plus how many each map, version,
/// country and mod would give, and how many are on `my_version`.
#[tauri::command]
pub async fn get_filter_facets(
    state: State<'_, AppState>,
    filter_params: FilterParams,
    my_version: Option<String>,
) -> Result<Facets, String> {
    blocking_read(&state, move |reader| {
        let filter = filter_from_params(filter_params);
        reader
            .facets(&filter, my_version.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
}

/// Maps, mods and versions that complete `text`, in that order.
#[tauri::command]
pub async fn get_search_suggestions(
    state: State<'_, AppState>,
    filter_params: FilterParams,
    text: String,
) -> Result<Vec<Suggestion>, String> {
    blocking_read(&state, move |reader| {
        let filter = filter_from_params(filter_params);
        reader
            .suggestions(&filter, &text)
            .map_err(|e| e.to_string())
    })
    .await
}
