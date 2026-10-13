use std::sync::Arc;
use std::sync::atomic::Ordering;

use matrix_sdk::ruma::{OwnedDeviceId, OwnedRoomId, OwnedUserId};
use serde::{Deserialize, Serialize};

use super::Handler;
use crate::protocol::{
    CommandErr, DeviceView, EncryptionStatusView, IdentityResetStep, KeyBackupDownloadView,
    KeyBackupStatusView, SignOutSafetyView, UserSecurityView,
};
use crate::verification::{self, VERIFICATION_METHODS, encryption_status, sign_out_safety};
use crate::{Core, ResultExt};

domain! {
    encryption_status => EncryptionStatusParams,
    key_backup_status => KeyBackupStatusParams,
    download_key_backup => DownloadKeyBackupParams,
    sign_out_safety => SignOutSafetyParams,
    devices => DevicesParams,
    user_security => UserSecurityParams,
    recover_identity => RecoverIdentityParams,
    enable_recovery => EnableRecoveryParams,
    reset_recovery_key => ResetRecoveryKeyParams,
    reset_identity => ResetIdentityParams,
    continue_identity_reset => ContinueIdentityResetParams,
    cancel_identity_reset => CancelIdentityResetParams,
    export_room_keys => ExportRoomKeysParams,
    import_room_keys => ImportRoomKeysParams,
    delete_device => DeleteDeviceParams,
    rename_device => RenameDeviceParams,
    discard_room_key => DiscardRoomKeyParams,
    request_verification => RequestVerificationParams,
    withdraw_verification => WithdrawVerificationParams,
    set_device_blocked => SetDeviceBlockedParams,
    accept_verification => AcceptVerificationParams,
    scan_verification_qr => ScanVerificationQrParams,
    start_sas_verification => StartSasVerificationParams,
    confirm_verification => ConfirmVerificationParams,
    cancel_verification => CancelVerificationParams,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct EncryptionStatusParams {}

impl Handler for EncryptionStatusParams {
    type Ok = EncryptionStatusView;

    async fn run(self, core: &Arc<Core>) -> Result<EncryptionStatusView, CommandErr> {
        Ok(encryption_status(&core.client().await?).await)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct KeyBackupStatusParams {}

impl Handler for KeyBackupStatusParams {
    type Ok = KeyBackupStatusView;

    async fn run(self, core: &Arc<Core>) -> Result<KeyBackupStatusView, CommandErr> {
        core.key_backup_status().await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DownloadKeyBackupParams {
    pub request_id: String,
}

impl Handler for DownloadKeyBackupParams {
    type Ok = KeyBackupDownloadView;

    async fn run(self, core: &Arc<Core>) -> Result<KeyBackupDownloadView, CommandErr> {
        core.download_key_backup(self.request_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SignOutSafetyParams {}

impl Handler for SignOutSafetyParams {
    type Ok = SignOutSafetyView;

    async fn run(self, core: &Arc<Core>) -> Result<SignOutSafetyView, CommandErr> {
        Ok(sign_out_safety(&core.client().await?).await)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DevicesParams {}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DevicesOk {
    pub devices: Vec<DeviceView>,
    pub account_management: bool,
    /// Signed in with OAuth, which is what linking a device by QR code needs.
    pub oauth: bool,
}

impl Handler for DevicesParams {
    type Ok = DevicesOk;

    async fn run(self, core: &Arc<Core>) -> Result<DevicesOk, CommandErr> {
        let client = core.client().await?;
        let oauth = client.oauth().full_session().is_some();
        let account_management = oauth
            && client
                .oauth()
                .server_metadata()
                .await
                .ok()
                .and_then(|metadata| metadata.account_management_uri)
                .is_some();

        Ok(DevicesOk {
            devices: verification::own_devices(&client).await,
            account_management,
            oauth,
        })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct UserSecurityParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
}

impl Handler for UserSecurityParams {
    type Ok = UserSecurityView;

    async fn run(self, core: &Arc<Core>) -> Result<UserSecurityView, CommandErr> {
        verification::user_security(core, &self.user_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RecoverIdentityParams {
    pub recovery_key: String,
}

impl Handler for RecoverIdentityParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let client = core.client().await?;
        client
            .encryption()
            .recovery()
            .recover(&self.recovery_key)
            .await
            .map_err(|error| core.recovery_error(error))?;
        core.adopt_account_data_key(&client, &self.recovery_key)
            .await;
        Ok(())
    }
}

/// First-time cross-signing and key backup. Without it a lone session can
/// never verify a second. The returned key is unrecoverable, so a UI must
/// make the user store it.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct EnableRecoveryParams {
    /// A passphrase to unlock the key with. The key is returned either way.
    pub passphrase: Option<String>,
}

impl Handler for EnableRecoveryParams {
    /// Unrecoverable once discarded.
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        let client = core.client().await?;
        let recovery = client.encryption().recovery();
        let enable = recovery.enable();

        let recovery_key = match &self.passphrase {
            Some(passphrase) => enable.with_passphrase(passphrase).await,
            None => enable.await,
        }
        .or_failed(core, "enable_recovery")?;
        core.adopt_account_data_key(&client, &recovery_key).await;
        Ok(recovery_key)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ResetRecoveryKeyParams {
    pub passphrase: Option<String>,
}

impl Handler for ResetRecoveryKeyParams {
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        let client = core.client().await?;
        let recovery = client.encryption().recovery();
        let reset = recovery.reset_key();

        let recovery_key = match &self.passphrase {
            Some(passphrase) => reset.with_passphrase(passphrase).await,
            None => reset.await,
        }
        .or_failed(core, "reset_recovery_key")?;
        core.adopt_account_data_key(&client, &recovery_key).await;
        Ok(recovery_key)
    }
}

/// Destructive from the first call: the key backup and secret storage are
/// gone before the server is asked for authentication.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ResetIdentityParams {}

impl Handler for ResetIdentityParams {
    type Ok = IdentityResetStep;

    async fn run(self, core: &Arc<Core>) -> Result<IdentityResetStep, CommandErr> {
        core.reset_identity().await
    }
}

/// OAuth polls for the approval for up to two minutes.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ContinueIdentityResetParams {
    pub password: Option<String>,
}

impl Handler for ContinueIdentityResetParams {
    /// The new recovery key.
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        core.continue_identity_reset(self.password).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CancelIdentityResetParams {}

impl Handler for CancelIdentityResetParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.cancel_identity_reset().await;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ExportRoomKeysParams {
    pub passphrase: String,
}

impl Handler for ExportRoomKeysParams {
    /// The passphrase-encrypted export file.
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        core.export_room_keys(&self.passphrase).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ImportRoomKeysParams {
    pub export: String,
    pub passphrase: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ImportRoomKeysOk {
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Number))]
    pub imported: u64,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Number))]
    pub total: u64,
}

impl Handler for ImportRoomKeysParams {
    type Ok = ImportRoomKeysOk;

    async fn run(self, core: &Arc<Core>) -> Result<ImportRoomKeysOk, CommandErr> {
        core.import_room_keys(&self.export, &self.passphrase).await
    }
}

/// Call without a password first: the server states its terms in an
/// `interactive_auth_required` error, and only then is there a prompt.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DeleteDeviceParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub device_id: OwnedDeviceId,
    pub password: Option<String>,
}

impl Handler for DeleteDeviceParams {
    /// Under OAuth, the account page that deletes the device.
    type Ok = Option<String>;

    async fn run(self, core: &Arc<Core>) -> Result<Option<String>, CommandErr> {
        core.delete_device(self.device_id, self.password).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RenameDeviceParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub device_id: OwnedDeviceId,
    pub display_name: String,
}

impl Handler for RenameDeviceParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let client = core.client().await?;
        let generation = core.session_generation.load(Ordering::SeqCst);
        client
            .rename_device(&self.device_id, &self.display_name)
            .await
            .or_failed(core, "rename_device")?;
        core.emit_devices(generation, &client).await;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct DiscardRoomKeyParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for DiscardRoomKeyParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.room(&self.room_id)
            .await?
            .discard_room_key()
            .await
            .or_failed(core, "discard_room_key")?;
        Ok(())
    }
}

/// Our own user id self-verifies another session. Progress arrives as
/// `CoreEvent::Verification`.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct RequestVerificationParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    #[serde(default)]
    #[cfg_attr(feature = "typegen", specta(type = Option<String>))]
    pub device_id: Option<OwnedDeviceId>,
}

impl Handler for RequestVerificationParams {
    /// The flow id, carried by every later call and event for this
    /// verification.
    type Ok = String;

    async fn run(self, core: &Arc<Core>) -> Result<String, CommandErr> {
        let encryption = core.client().await?.encryption();
        let request = match self.device_id {
            Some(device_id) => encryption
                .get_device(&self.user_id, &device_id)
                .await
                .or_failed(core, "request_verification_device")?
                .ok_or(CommandErr::Unavailable)?
                .request_verification_with_methods(VERIFICATION_METHODS.to_vec())
                .await
                .or_failed(core, "request_verification")?,
            None => encryption
                .get_user_identity(&self.user_id)
                .await
                .or_failed(core, "request_verification_identity")?
                .ok_or(CommandErr::Unavailable)?
                .request_verification_with_methods(VERIFICATION_METHODS.to_vec())
                .await
                .or_failed(core, "request_verification")?,
        };

        if request.is_cancelled() {
            return Err(core.failed(
                "request_verification",
                "cancelled on creation by another ongoing request",
            ));
        }

        let flow_id = request.flow_id().to_owned();
        core.watch_verification(request);
        Ok(flow_id)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct WithdrawVerificationParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
}

impl Handler for WithdrawVerificationParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.client()
            .await?
            .encryption()
            .get_user_identity(&self.user_id)
            .await
            .or_failed(core, "withdraw_verification_identity")?
            .ok_or(CommandErr::Unavailable)?
            .withdraw_verification()
            .await
            .or_failed(core, "withdraw_verification")?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SetDeviceBlockedParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub device_id: OwnedDeviceId,
    pub blocked: bool,
}

impl Handler for SetDeviceBlockedParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        verification::set_device_blocked(core, &self.user_id, &self.device_id, self.blocked).await
    }
}

/// Also transitions into SAS, so the emoji need no further round trip.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AcceptVerificationParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    pub flow_id: String,
}

impl Handler for AcceptVerificationParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.verification_request(&self.user_id, &self.flow_id)
            .await?
            .accept_with_methods(VERIFICATION_METHODS.to_vec())
            .await
            .or_failed(core, "accept_verification")?;
        Ok(())
    }
}

/// The bytes read from the other device's code, base64 encoded.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ScanVerificationQrParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    pub flow_id: String,
    pub data: String,
}

impl Handler for ScanVerificationQrParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.scan_verification_qr(self.user_id, self.flow_id, &self.data)
            .await
    }
}

/// Leaves the codes for emoji.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct StartSasVerificationParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    pub flow_id: String,
}

impl Handler for StartSasVerificationParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.verification_request(&self.user_id, &self.flow_id)
            .await?
            .start_sas()
            .await
            .or_failed(core, "start_sas_verification")?
            .ok_or(CommandErr::Unavailable)?;
        Ok(())
    }
}

/// The emoji matched, or the other device showed that it scanned our code.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct ConfirmVerificationParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    pub flow_id: String,
}

impl Handler for ConfirmVerificationParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        match core.sas(&self.user_id, &self.flow_id).await {
            Ok(sas) => sas.confirm().await,
            Err(_) => core.qr(&self.user_id, &self.flow_id).await?.confirm().await,
        }
        .or_failed(core, "confirm_verification")?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CancelVerificationParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub user_id: OwnedUserId,
    pub flow_id: String,
    /// The emoji differed. An attack signal the other side must be told
    /// about. A plain cancel is not.
    pub mismatch: bool,
}

impl Handler for CancelVerificationParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let (user_id, flow_id) = (&self.user_id, &self.flow_id);
        // No SAS to report a mismatch on before the emoji show.
        match core.sas(user_id, flow_id).await {
            Ok(sas) if self.mismatch => sas
                .mismatch()
                .await
                .or_failed(core, "cancel_verification_mismatch")?,
            Ok(sas) => sas
                .cancel()
                .await
                .or_failed(core, "cancel_verification_sas")?,
            Err(_) if let Ok(qr) = core.qr(user_id, flow_id).await => {
                qr.cancel()
                    .await
                    .or_failed(core, "cancel_verification_qr")?;
            }
            Err(_) => core
                .verification_request(user_id, flow_id)
                .await?
                .cancel()
                .await
                .or_failed(core, "cancel_verification")?,
        }
        Ok(())
    }
}
