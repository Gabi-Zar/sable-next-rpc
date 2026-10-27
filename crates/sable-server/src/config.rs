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
    #[serde(default = "default_username")]
    pub username: String,
    pub password_hash: String,
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
        let url = Url::parse(&config.public_url)
            .map_err(|_| "SABLE_SERVER_PUBLIC_URL must be a valid URL")?;
        if !matches!(url.scheme(), "http" | "https") || url.host().is_none() || url.path() != "/" {
            return Err("SABLE_SERVER_PUBLIC_URL must be an http(s) origin".into());
        }
        config.public_url = url.origin().ascii_serialization();
        Ok(config)
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

fn default_username() -> String {
    "sable".to_owned()
}

const fn default_client_ip_source() -> ClientIpSource {
    ClientIpSource::ConnectInfo
}

fn default_frontend_dir() -> PathBuf {
    PathBuf::from("dist")
}
