use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use argon2::{Argon2, PasswordHash, PasswordVerifier};
use axum_extra::headers::authorization::{Authorization, Basic};
use tower_sessions::Session;

const SESSION_CREATED_AT: &str = "created_at";
const SESSION_LIFETIME: Duration = Duration::from_hours(168);

#[derive(Clone)]
pub struct Auth {
    username: Arc<str>,
    password_hash: Arc<str>,
}

impl Auth {
    pub fn new(
        username: impl Into<Arc<str>>,
        password_hash: impl Into<Arc<str>>,
    ) -> Result<Self, argon2::password_hash::Error> {
        let password_hash = password_hash.into();
        PasswordHash::new(&password_hash)?;
        Ok(Self {
            username: username.into(),
            password_hash,
        })
    }

    pub async fn authenticate(&self, session: &Session) -> bool {
        let Some(created_at) = session.get::<u64>(SESSION_CREATED_AT).await.ok().flatten() else {
            return false;
        };
        let expired = current_time().saturating_sub(created_at) >= SESSION_LIFETIME.as_secs();
        if expired {
            let _ = session.flush().await;
        }
        !expired
    }

    pub async fn check_basic(&self, credentials: Option<&Authorization<Basic>>) -> bool {
        let Some(credentials) = credentials else {
            return false;
        };
        let username_ok = credentials.username() == self.username.as_ref();
        let password = credentials.password().to_owned();
        let password_hash = self.password_hash.clone();
        let password_ok = tokio::task::spawn_blocking(move || {
            PasswordHash::new(&password_hash).is_ok_and(|hash| {
                Argon2::default()
                    .verify_password(password.as_bytes(), &hash)
                    .is_ok()
            })
        })
        .await
        .unwrap_or(false);
        username_ok && password_ok
    }

    pub async fn login(&self, session: &Session) -> Result<(), tower_sessions::session::Error> {
        session.cycle_id().await?;
        session.insert(SESSION_CREATED_AT, current_time()).await
    }
}

pub async fn logout(session: &Session) -> Result<(), tower_sessions::session::Error> {
    session.flush().await
}

fn current_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}
