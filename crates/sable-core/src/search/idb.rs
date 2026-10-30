use std::cell::RefCell;
use std::collections::HashMap;

use futures_util::future::{AbortHandle, Abortable};
use matrix_indexed_db_futures::database::Database;
use matrix_indexed_db_futures::prelude::*;
use matrix_indexed_db_futures::transaction::TransactionMode;
use matrix_indexed_db_futures::typed_array::{TypedArray, TypedArraySlice};

use crate::store::StoreError;

const DATABASE_SUFFIX: &str = "::sable-search";
const DATABASE_VERSION: u32 = 1;
const STORE: &str = "values";

struct Connection {
    database: Database,
    on_version_change: AbortHandle,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.on_version_change.abort();
        self.database.clone().close();
    }
}

struct Slot {
    connection: Connection,
    closed: bool,
}

pub(super) enum Attached {
    Open(Database),
    Closed,
    Detached,
}

thread_local! {
    static CONNECTIONS: RefCell<HashMap<String, Slot>> = RefCell::new(HashMap::new());
}

fn identity(client: &matrix_sdk::Client) -> Option<String> {
    Some(format!("{}|{}", client.user_id()?, client.device_id()?))
}

fn failure(error: impl std::fmt::Display) -> StoreError {
    StoreError::Message(error.to_string())
}

pub(super) fn attached(client: &matrix_sdk::Client) -> Attached {
    let Some(identity) = identity(client) else {
        return Attached::Detached;
    };
    CONNECTIONS.with_borrow(|connections| match connections.get(&identity) {
        Some(slot) if slot.closed => Attached::Closed,
        Some(slot) => Attached::Open(slot.connection.database.clone()),
        None => Attached::Detached,
    })
}

pub(super) async fn attach(client: &matrix_sdk::Client, store_id: &str) -> Result<(), StoreError> {
    let identity = identity(client).ok_or(StoreError::Invalid("the client has no session"))?;
    CONNECTIONS.with_borrow_mut(|connections| connections.remove(&identity));
    let database = open(&format!("{store_id}{DATABASE_SUFFIX}")).await?;
    let mut changes = database.version_changes().map_err(failure)?;
    let (on_version_change, registration) = AbortHandle::new_pair();
    CONNECTIONS.with_borrow_mut(|connections| {
        connections.insert(
            identity.clone(),
            Slot {
                connection: Connection {
                    database,
                    on_version_change,
                },
                closed: false,
            },
        )
    });
    wasm_bindgen_futures::spawn_local(async move {
        let _ = Abortable::new(
            async move {
                let _ = changes.recv().await;
                CONNECTIONS.with_borrow_mut(|connections| {
                    if let Some(slot) = connections.get_mut(&identity) {
                        slot.connection.database.clone().close();
                        slot.closed = true;
                    }
                });
            },
            registration,
        )
        .await;
    });
    Ok(())
}

pub(super) async fn open(name: &str) -> Result<Database, StoreError> {
    Database::open(name)
        .with_version(DATABASE_VERSION)
        .with_on_upgrade_needed(|_, transaction| {
            let database = transaction.db();
            if !database.object_store_names().any(|name| name == STORE) {
                database.create_object_store(STORE).build()?;
            }
            Ok(())
        })
        .await
        .map_err(failure)
}

pub(super) async fn get(database: &Database, key: &str) -> Result<Option<Vec<u8>>, StoreError> {
    let transaction = database.transaction(STORE).build().map_err(failure)?;
    let store = transaction.object_store(STORE).map_err(failure)?;
    let request = store
        .get::<TypedArray<u8>, _, _>(key)
        .primitive()
        .map_err(failure)?;
    transaction.commit().await.map_err(failure)?;
    request
        .await
        .map(|bytes| bytes.map(Into::into))
        .map_err(failure)
}

pub(super) async fn put(database: &Database, key: &str, bytes: &[u8]) -> Result<(), StoreError> {
    let transaction = database
        .transaction(STORE)
        .with_mode(TransactionMode::Readwrite)
        .build()
        .map_err(failure)?;
    let store = transaction.object_store(STORE).map_err(failure)?;
    let request = store
        .put(TypedArraySlice::new(bytes))
        .with_key(key)
        .without_key_type()
        .primitive()
        .map_err(failure)?;
    transaction.commit().await.map_err(failure)?;
    request.await.map_err(failure)
}

pub(super) async fn delete(database: &Database, key: &str) -> Result<(), StoreError> {
    let transaction = database
        .transaction(STORE)
        .with_mode(TransactionMode::Readwrite)
        .build()
        .map_err(failure)?;
    let store = transaction.object_store(STORE).map_err(failure)?;
    let request = store.delete(key).primitive().map_err(failure)?;
    transaction.commit().await.map_err(failure)?;
    request.await.map_err(failure)
}
