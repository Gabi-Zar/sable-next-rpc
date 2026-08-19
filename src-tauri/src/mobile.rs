// The webview paints under transparent system bars, so only icon contrast is ours to set;
// `Window.setStatusBarColor` is a no-op from API 35.
// Tauri does not populate ndk-context, so MainActivity hands us the JavaVM on create.

use std::sync::OnceLock;

use jni::objects::{JObject, JValue};
use jni::{jni_sig, jni_str, EnvUnowned, JavaVM};

static JAVA_VM: OnceLock<JavaVM> = OnceLock::new();

#[no_mangle]
pub extern "system" fn Java_moe_sable_next_MainActivity_nativeInitSystemBars(
    mut env: EnvUnowned,
    _this: JObject,
) {
    let _ = env.with_env(|env| {
        let vm = env.get_java_vm()?;
        let _ = JAVA_VM.set(vm);
        Ok::<_, jni::errors::Error>(())
    });
}

/// `light` asks for the icon treatment a light background needs: dark icons.
#[tauri::command]
pub fn set_system_bars_light(light: bool) -> Result<(), String> {
    let vm = JAVA_VM.get().ok_or("java vm not initialized")?;
    vm.attach_current_thread(|env| {
        let result = env.call_static_method(
            jni_str!("moe/sable/next/MainActivity"),
            jni_str!("setSystemBarsLightNative"),
            jni_sig!("(Z)V"),
            &[JValue::Bool(u8::from(light))],
        );
        if result.is_err() {
            let _ = env.exception_clear();
        }
        result.map(|_| ())
    })
    .map_err(|error| error.to_string())
}
