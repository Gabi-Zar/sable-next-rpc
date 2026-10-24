use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use jieba_rs::Jieba;
use sha2::{Digest, Sha256};

use crate::store::StoreError;

// Keep this dictionary in sync with the pinned jieba-rs version.
const URL: &str = "https://raw.githubusercontent.com/messense/jieba-rs/9faccca490d8e797a14d6daffed2a96de9629df7/jieba/src/data/dict.txt";
const SHA256: &str = "139519822fe8ab9e10d9d07e68ea0451045380aedaf54ecc51e2a28c6b42a13f";
const BYTES: usize = 5_071_843;
const FILE: &str = "jieba-0.10.4.dict.zlib";

#[cfg(any(target_os = "android", target_os = "ios"))]
static RETRY: tokio::sync::Mutex<Option<web_time::Instant>> = tokio::sync::Mutex::const_new(None);

#[cfg(any(target_os = "android", target_os = "ios"))]
pub(super) async fn ensure(store_id: &str) -> Result<(), StoreError> {
    if super::tokenize::chinese_ready() {
        return Ok(());
    }
    let mut retry = RETRY.lock().await;
    if super::tokenize::chinese_ready() {
        return Ok(());
    }
    if retry.is_some_and(|at| at.elapsed() < Duration::from_secs(60)) {
        return Err(StoreError::Invalid(
            "Chinese search dictionary download is pending",
        ));
    }

    let result = async {
        let http = crate::tls::apply(reqwest::Client::builder())
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(StoreError::backend)?;
        load(
            &Path::new(store_id).join("search-dictionaries").join(FILE),
            &http,
            URL,
            SHA256,
            BYTES,
        )
        .await
    }
    .await;

    match result {
        Ok(dictionary) => {
            let _ = super::tokenize::CHINESE.set(dictionary);
            *retry = None;
            Ok(())
        }
        Err(error) => {
            *retry = Some(web_time::Instant::now());
            tracing::warn!(%error, "Chinese search dictionary is unavailable; indexing will retry");
            Err(error)
        }
    }
}

fn parse(bytes: &[u8], expected: &str, length: usize) -> Result<Jieba, StoreError> {
    if bytes.len() != length || checksum(bytes) != expected {
        return Err(StoreError::Invalid(
            "Chinese search dictionary checksum mismatch",
        ));
    }
    Jieba::with_dict(&mut std::io::Cursor::new(bytes)).map_err(StoreError::backend)
}

fn checksum(bytes: &[u8]) -> String {
    use std::fmt::Write;
    Sha256::digest(bytes)
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

async fn load(
    path: &Path,
    http: &reqwest::Client,
    url: &str,
    expected: &str,
    length: usize,
) -> Result<Jieba, StoreError> {
    let cached = {
        let path = path.to_owned();
        let expected = expected.to_owned();
        tokio::task::spawn_blocking(move || {
            let compressed = std::fs::read(path).ok()?;
            let bytes =
                miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(&compressed, length)
                    .ok()?;
            parse(&bytes, &expected, length).ok()
        })
        .await
        .map_err(StoreError::backend)?
    };
    if let Some(dictionary) = cached {
        return Ok(dictionary);
    }

    let mut response = http
        .get(url)
        .send()
        .await
        .map_err(StoreError::backend)?
        .error_for_status()
        .map_err(StoreError::backend)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(StoreError::backend)? {
        if bytes.len().saturating_add(chunk.len()) > length {
            return Err(StoreError::Invalid(
                "Chinese search dictionary exceeds expected size",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let path = path.to_owned();
    let expected = expected.to_owned();
    tokio::task::spawn_blocking(move || save(path, &bytes, &expected, length))
        .await
        .map_err(StoreError::backend)?
}

fn save(path: PathBuf, bytes: &[u8], expected: &str, length: usize) -> Result<Jieba, StoreError> {
    let dictionary = parse(bytes, expected, length)?;
    let directory = path
        .parent()
        .ok_or(StoreError::Invalid("dictionary path has no parent"))?;
    std::fs::create_dir_all(directory)?;
    let mut file = tempfile::NamedTempFile::new_in(directory)?;
    file.write_all(&miniz_oxide::deflate::compress_to_vec_zlib(bytes, 6))?;
    file.as_file().sync_all()?;
    file.persist(path)
        .map_err(|error| StoreError::Io(error.error))?;
    Ok(dictionary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    const DICTIONARY: &[u8] = "中文 100 n\n搜索 100 v\n".as_bytes();

    fn checksum() -> String {
        super::checksum(DICTIONARY)
    }

    #[tokio::test]
    async fn cached_dictionary_works_offline() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/dictionary"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(DICTIONARY))
            .expect(1)
            .mount(&server)
            .await;
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join(FILE);
        let http = reqwest::Client::new();
        let url = format!("{}/dictionary", server.uri());
        let first = load(&file, &http, &url, &checksum(), DICTIONARY.len())
            .await
            .unwrap();
        assert!(first.has_word("搜索"));
        let cached = load(
            &file,
            &http,
            "http://127.0.0.1:1/offline",
            &checksum(),
            DICTIONARY.len(),
        )
        .await
        .unwrap();
        assert!(cached.has_word("搜索"));
    }

    #[tokio::test]
    async fn corrupt_dictionary_is_replaced() {
        let server = MockServer::start().await;
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join(FILE);
        std::fs::write(&file, b"broken cache").unwrap();
        let http = reqwest::Client::new();
        let url = format!("{}/dictionary", server.uri());
        Mock::given(method("GET"))
            .and(path("/dictionary"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(DICTIONARY))
            .mount(&server)
            .await;
        assert!(
            load(&file, &http, &url, &checksum(), DICTIONARY.len())
                .await
                .unwrap()
                .has_word("中文")
        );
        server.reset().await;
        let saved = std::fs::read(&file).unwrap();
        Mock::given(method("GET"))
            .and(path("/dictionary"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![b'x'; DICTIONARY.len()]))
            .mount(&server)
            .await;
        load(&file, &http, &url, &"0".repeat(64), DICTIONARY.len())
            .await
            .unwrap_err();
        assert_eq!(std::fs::read(&file).unwrap(), saved);
    }

    #[tokio::test]
    async fn failed_download_can_be_retried() {
        let server = MockServer::start().await;
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join(FILE);
        let http = reqwest::Client::new();
        let url = format!("{}/dictionary", server.uri());
        Mock::given(method("GET"))
            .and(path("/dictionary"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        load(&file, &http, &url, &checksum(), DICTIONARY.len())
            .await
            .unwrap_err();
        assert!(!file.exists());
        server.reset().await;
        Mock::given(method("GET"))
            .and(path("/dictionary"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(DICTIONARY))
            .mount(&server)
            .await;
        assert!(
            load(&file, &http, &url, &checksum(), DICTIONARY.len())
                .await
                .unwrap()
                .has_word("搜索")
        );
    }

    #[tokio::test]
    #[ignore = "downloads the pinned upstream dictionary"]
    async fn pinned_upstream_dictionary_loads() {
        let directory = tempfile::tempdir().unwrap();
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap();
        let dictionary = load(&directory.path().join(FILE), &http, URL, SHA256, BYTES)
            .await
            .unwrap();
        assert!(dictionary.has_word("搜索"));
        assert!(dictionary.has_word("加密"));
    }
}
