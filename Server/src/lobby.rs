use crate::message::{LobbyDetails, UserMessage};
use futures_util::{stream::SplitSink, *};
use warp::ws::{Message, WebSocket};

pub type HostChannel = SplitSink<WebSocket, Message>;

pub struct Lobby {
    host_channel: HostChannel,
    details: LobbyDetails,
}

impl Lobby {
    pub async fn create(message: UserMessage, host_channel: HostChannel) -> Option<Lobby> {
        match message {
            UserMessage::CreateLobby {
                lobby_name,
                public_lobby,
                max_clients,
            } => {
                let mut lobby = Lobby {
                    host_channel,
                    details: LobbyDetails {
                        lobby_name: lobby_name.unwrap_or(":)".to_string()),
                        public_lobby,
                        max_clients,
                        client_count: 0,
                    },
                };

                lobby.send_details_to_host().await?;

                Some(lobby)
            }
            _ => None,
        }
    }

    pub fn handle_host_message(&mut self, message: UserMessage) -> Result<(), ()> {
        match message {
            UserMessage::LobbyDetails { details: _ } => Ok(()),
            _ => Err(()),
        }
    }

    /// Returns None if fail
    async fn send_details_to_host(&mut self) -> Option<()> {
        let message = UserMessage::LobbyDetails {
            details: self.details.clone(),
        };
        self.send_message_to_host(message).await
    }

    /// Returns None if fail
    async fn send_message_to_host(&mut self, message: UserMessage) -> Option<()> {
        let Ok(body) = serde_json::to_string(&message) else {
            println!("[SERVER-ERROR] Unable to stringify: {:?}", message);
            return None;
        };
        let response = Message::text(body);
        if self.host_channel.send(response).await.is_ok() {
            Some(())
        } else {
            None
        }
    }
}
