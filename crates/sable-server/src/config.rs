use std::path::PathBuf;

use axum_client_ip::ClientIpSource;

use figment::{
    Figment,
    providers::{Env, Format, Toml},
};
use serde::Deserialize;
use url::Url;

const DEFAULT_CONFIG_PATH: &str = "sable-server.toml";
const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:18008";

#[derive(Clone, Debug, Deserialize)]
pub struct Config {
    #[serde(default = "default_listen_addr")]
    pub listen_addr: String,
    #[serde(default = "default_public_url")]
    pub public_url: String,
    #[serde(default = "default_client_ip_source")]
    pub client_ip_source: ClientIpSource,
    #[serde(default = "default_data_dir")]
    pub data_dir: PathBuf,
    #[serde(default = "default_max_active_users")]
    pub max_active_users: usize,
    #[serde(default)]
    pub allowed_private_cidrs: Vec<String>,
    #[serde(default = "default_username")]
    pub username: String,
    #[serde(default)]
    pub password_hash: Option<String>,
    #[serde(default)]
    pub oidc_issuer: Option<String>,
    #[serde(default)]
    pub oidc_client_id: Option<String>,
    #[serde(default)]
    pub oidc_client_secret: Option<String>,
    #[serde(default)]
    pub oidc_auto_provision: bool,
    #[serde(default = "default_frontend_dir")]
    pub frontend_dir: PathBuf,
}

impl Config {
    #[expect(
        clippy::missing_errors_doc,
        reason = "the server crate keeps configuration errors local"
    )]
    pub fn load(path: Option<PathBuf>) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let path = path.unwrap_or_else(|| PathBuf::from(DEFAULT_CONFIG_PATH));
        let mut config: Self = Figment::from(Toml::file(path))
            .merge(Env::prefixed("SABLE_SERVER_"))
            .extract()?;
        if config.public_url == default_public_url() && config.listen_addr != DEFAULT_LISTEN_ADDR {
            config.public_url = format!("http://{}", config.listen_addr);
        }
        config.public_url = validate_public_url(&config.public_url)?;
        Ok(config)
    }
}

fn validate_public_url(
    public_url: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let url = Url::parse(public_url).map_err(|_| "SABLE_SERVER_PUBLIC_URL must be a valid URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() || url.path() != "/" {
        return Err("SABLE_SERVER_PUBLIC_URL must be an http(s) origin".into());
    }
    if url.scheme() == "http" && !is_loopback_url(&url) {
        return Err(
            "SABLE_SERVER_PUBLIC_URL must use HTTPS unless it is a loopback address".into(),
        );
    }
    Ok(url.origin().ascii_serialization())
}

pub(crate) fn is_loopback_url(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

fn default_listen_addr() -> String {
    DEFAULT_LISTEN_ADDR.to_owned()
}

fn default_public_url() -> String {
    format!("http://{DEFAULT_LISTEN_ADDR}")
}

fn default_data_dir() -> PathBuf {
    PathBuf::from("sable-server-data")
}

const fn default_max_active_users() -> usize {
    128
}

fn default_username() -> String {
    "sable".to_owned()
}

const fn default_client_ip_source() -> ClientIpSource {
    ClientIpSource::ConnectInfo
}

fn default_frontend_dir() -> PathBuf {
    PathBuf::from("dist")
}

#[cfg(test)]
mod tests {
    use super::validate_public_url;

    #[test]
    fn rejects_non_loopback_http_public_urls() {
        let error = validate_public_url("http://192.0.2.1:18008").unwrap_err();
        assert_eq!(
            error.to_string(),
            "SABLE_SERVER_PUBLIC_URL must use HTTPS unless it is a loopback address"
        );
    }

    #[test]
    fn accepts_loopback_http_public_urls() {
        for url in [
            "http://localhost:18008",
            "http://127.0.0.2:18008",
            "http://[::1]:18008",
        ] {
            assert!(validate_public_url(url).is_ok(), "{url}");
        }
    }
}
