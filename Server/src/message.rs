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

#[derive(Deserialize, Serialize, Debug)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum UserMessage {
    #[serde(rename_all = "camelCase")]
    JoinRequest {
        lobby_name: Option<String>,
        offer: String,
    },
    JoinInvitation {
        answer: String,
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
    Error {
        message: UserMessageError,
    },
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum UserMessageError {
    LobbyNotFound,
    InvalidMessageType,
}

impl Into<UserMessage> for UserMessageError {
    fn into(self) -> UserMessage {
        UserMessage::Error { message: self }
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
