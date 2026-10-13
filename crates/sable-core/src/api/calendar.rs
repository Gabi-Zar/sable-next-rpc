use std::sync::Arc;

use matrix_sdk::ruma::{OwnedEventId, OwnedRoomId};
use serde::Deserialize;

use super::Handler;
use crate::Core;
use crate::calendar::CalendarAnswer;
use crate::protocol::{CalendarView, CommandErr, RsvpStatusView};

domain! {
    calendar_entries => CalendarEntriesParams,
    save_calendar_event => SaveCalendarEventParams,
    answer_calendar_event => AnswerCalendarEventParams,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct CalendarEntriesParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
}

impl Handler for CalendarEntriesParams {
    type Ok = CalendarView;

    async fn run(self, core: &Arc<Core>) -> Result<CalendarView, CommandErr> {
        core.calendar_entries(&self.room_id).await
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct SaveCalendarEventParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = specta_typescript::Unknown))]
    pub event: serde_json::Value,
    #[cfg_attr(feature = "typegen", specta(type = Option<String>))]
    pub replaces: Option<OwnedEventId>,
}

impl Handler for SaveCalendarEventParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        core.save_calendar_event(&self.room_id, self.event, self.replaces)
            .await
    }
}

/// `recurrence_id` picks one occurrence of a repeating event.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "typegen", derive(specta::Type))]
pub struct AnswerCalendarEventParams {
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub room_id: OwnedRoomId,
    #[cfg_attr(feature = "typegen", specta(type = String))]
    pub calendar_event_id: OwnedEventId,
    pub uid: String,
    pub recurrence_id: Option<String>,
    pub status: RsvpStatusView,
}

impl Handler for AnswerCalendarEventParams {
    type Ok = ();

    async fn run(self, core: &Arc<Core>) -> Result<(), CommandErr> {
        let answer = CalendarAnswer {
            calendar_event_id: self.calendar_event_id,
            uid: self.uid,
            recurrence_id: self.recurrence_id,
            status: self.status,
        };
        core.answer_calendar_event(&self.room_id, &answer).await
    }
}
