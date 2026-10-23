#![expect(
    clippy::missing_errors_doc,
    reason = "Node exports return the native capture error"
)]

use napi::{
    Status,
    bindgen_prelude::Buffer,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;

type Frames = ThreadsafeFunction<Buffer, (), Buffer, Status, false, true, 8>;

#[napi]
pub fn audiofox_apps(root_pid: u32) -> napi::Result<Vec<String>> {
    sable_loopback::audiofox::list_apps(root_pid).map_err(napi::Error::from_reason)
}

#[napi]
pub fn start_audiofox(include: Vec<String>, root_pid: u32, frames: Frames) -> napi::Result<()> {
    sable_loopback::audiofox::start(
        include,
        root_pid,
        Box::new(move |chunk| {
            matches!(
                frames.call(
                    Buffer::from(chunk.to_vec()),
                    ThreadsafeFunctionCallMode::NonBlocking
                ),
                Status::Ok | Status::QueueFull
            )
        }),
    )
    .map_err(napi::Error::from_reason)
}

#[napi]
pub fn stop_audiofox() {
    sable_loopback::audiofox::stop();
}
