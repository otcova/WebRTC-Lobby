use serde::{Deserialize, Serialize};
use warp::ws::Message;

#[derive(Deserialize, Serialize, Debug, Clone)]
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
    JoinLobby {
        lobby_name: String,
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
