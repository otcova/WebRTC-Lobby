use serde::{Deserialize, Serialize};
use warp::ws::Message;

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LobbyDetails {
    pub lobby_name: String,
    pub public_lobby: bool,
    pub max_clients: u16,
    pub client_count: u16,
}

impl LobbyDetails {
    pub fn capacity(&self) -> u16 {
        self.max_clients.saturating_sub(self.client_count)
    }
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum UserMessage {
    #[serde(rename_all = "camelCase")]
    JoinRequest {
        lobby_name: Option<String>,
        offer: String,
        id: Option<u32>,
    },
    JoinInvitation {
        answer: String,
        id: Option<u32>,
    },
    LobbyDetails {
        details: LobbyDetails,
    },
    #[serde(rename_all = "camelCase")]
    CreateLobby {
        lobby_name: Option<String>,
        public_lobby: bool,
        max_clients: u16,
    },
    #[serde(rename_all = "camelCase")]
    LobbiesListRequest {
        maximum_lobbies: usize,
        minimum_capacity: u16,
    },
    LobbiesList {
        lobbies: Vec<LobbyDetails>,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        error_type: UserMessageError,
    },
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum UserMessageError {
    LobbyNotFound,
    LobbyAlreadyExists,
    InvalidMessage,
}

impl Into<UserMessage> for UserMessageError {
    fn into(self) -> UserMessage {
        UserMessage::Error { error_type: self }
    }
}

impl Into<Message> for UserMessageError {
    fn into(self) -> Message {
        let msg: UserMessage = self.into();
        let txt = serde_json::to_string(&msg).unwrap_or_else(|_| {
            r#"{"type":"error","message":"Could not serialize the error"}"#.to_string()
        });
        Message::text(txt)
    }
}

impl Into<Message> for &UserMessage {
    fn into(self) -> Message {
        let txt = serde_json::to_string(self).unwrap_or_else(|_| {
            r#"{"type":"error","message":"Could not serialize the message"}"#.to_string()
        });
        Message::text(txt)
    }
}

type WsMessage = Option<Result<Message, warp::Error>>;
impl UserMessage {
    pub fn from(message: WsMessage) -> Option<Self> {
        let Some(Ok(message)) = message else {
            return None;
        };

        let Ok(message) = message.to_str() else {
            return None;
        };

        let Ok(message)  = serde_json::from_str::<UserMessage>(message) else {
            return None;
        };

        Some(message)
    }
}
