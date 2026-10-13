use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::Handler;
use crate::api::support::MAX_SEARCH_RESULTS;
use crate::protocol::{RpcError, SearchCoverageView, SearchFilter, SearchHitView, SearchMetricsView};
use crate::{Core, view};

const MAX_SEARCH_CONTEXT: usize = 3;

domain! {
    search_messages,
    search_coverage,
    search_metrics,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum SearchOrder {
    #[default]
    Rank,
    Recent,
    Oldest,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SearchMessagesParams {
    pub query: String,
    #[serde(default)]
    pub filter: SearchFilter,
    #[serde(default)]
    pub order: SearchOrder,
    pub limit: u32,
    pub offset: u32,
    #[serde(default)]
    pub context: u32,
    #[serde(default)]
    pub older: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SearchMessagesOk {
    pub hits: Vec<SearchHitView>,
    pub older: Option<String>,
}

impl Handler for SearchMessagesParams {
    type Ok = SearchMessagesOk;

    async fn run(self, core: &Arc<Core>) -> Result<SearchMessagesOk, RpcError> {
        let Self {
            query,
            filter,
            order,
            limit,
            offset,
            context,
            older,
        } = self;
        let filter = crate::search::IndexFilter::try_from(filter)?;
        let limit = (limit as usize).min(MAX_SEARCH_RESULTS);
        let context = (context as usize).min(MAX_SEARCH_CONTEXT);
        let (hits, older) = if let Some(cursor) = older {
            core.search_older(&query, &filter, order, limit, &cursor, context)
                .await
        } else {
            let hits = core
                .search_messages(&query, &filter, order, limit, offset as usize, context)
                .await;
            let older = if core.searches_locally(&query, &filter, order).await {
                core.older_start(&filter).await
            } else {
                None
            };
            (hits, older)
        };

        Ok(SearchMessagesOk {
            hits: hits.into_iter().map(view::search_hit_view).collect(),
            older,
        })
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SearchCoverageParams {}

impl Handler for SearchCoverageParams {
    type Ok = SearchCoverageView;

    async fn run(self, core: &Arc<Core>) -> Result<SearchCoverageView, RpcError> {
        Ok(core.search_coverage(&core.client().await?).await)
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SearchMetricsParams {}

impl Handler for SearchMetricsParams {
    type Ok = SearchMetricsView;

    async fn run(self, core: &Arc<Core>) -> Result<SearchMetricsView, RpcError> {
        Ok(core.search_metrics(&core.client().await?).await)
    }
}
