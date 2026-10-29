use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

mod actor;
mod commands;
mod error;
#[cfg(mobile)]
mod mobile;
mod models;

pub use error::{Error, Result};

use actor::NativeCallBridge;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the native call bridge APIs.
pub trait NativeCallExt<R: Runtime> {
    fn native_call_bridge(&self) -> &NativeCallBridge<R>;
}

impl<R: Runtime, T: Manager<R>> crate::NativeCallExt<R> for T {
    fn native_call_bridge(&self) -> &NativeCallBridge<R> {
        self.state::<NativeCallBridge<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("livekit-mobile")
        .invoke_handler(tauri::generate_handler![
            commands::get_native_call_capabilities,
            commands::connect_native_call,
            commands::disconnect_native_call,
            commands::set_native_call_microphone_enabled,
            commands::set_native_call_camera_enabled,
            commands::set_native_call_audio_processing,
            commands::set_native_call_participant_volume,
            commands::set_native_call_screen_share_enabled,
            commands::set_native_call_pip_enabled,
            commands::switch_native_call_camera,
            commands::set_native_call_remote_video_overlay,
            commands::clear_native_call_remote_video_overlay,
            commands::set_native_call_local_video_overlay,
            commands::clear_native_call_local_video_overlay,
            commands::start_system_call,
            commands::report_incoming_call,
            commands::end_system_call,
            commands::set_system_call_muted,
            commands::drain_pending_system_call_actions,
            commands::get_voip_token,
            commands::fulfill_answer_call,
            commands::fulfill_end_call,
            commands::report_system_call_connected,
            commands::set_native_call_encryption_key,
            commands::get_native_call_state,
            commands::get_audio_routes,
            commands::set_audio_route,
            commands::set_audio_input,
            commands::update_call_display,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let mobile_backend = mobile::init(app, api)?;
            #[cfg(not(mobile))]
            let _ = api;

            #[cfg(mobile)]
            let bridge = NativeCallBridge::new(app.clone(), mobile_backend);
            #[cfg(not(mobile))]
            let bridge = NativeCallBridge::new(app.clone());
            app.manage(bridge);
            Ok(())
        })
        .build()
}
