use super::HostChannel;
use crate::error::Result;
use crate::log;
use crate::message::{LobbyDetails, UserMessage};
use futures_util::*;
use tokio::sync::oneshot;
use warp::ws::Message;

pub struct Lobby {
    host_channel: HostChannel,
    details: LobbyDetails,
    join_requests: Vec<oneshot::Sender<UserMessage>>,
}

impl Lobby {
    pub fn create(host_channel: HostChannel, details: LobbyDetails) -> Lobby {
        Lobby {
            host_channel,
            details,
            join_requests: vec![],
        }
    }

    async fn send_message_to_host(&mut self, message: &UserMessage) -> Result<()> {
        let Ok(body) = serde_json::to_string(message) else {
            println!("[SERVER-ERROR] Unable to stringify: {:?}", message);
            return Err(());
        };
        let response = Message::text(body);
        if self.host_channel.send(response).await.is_ok() {
            Ok(())
        } else {
            Err(())
        }
    }

    pub async fn update_details(&mut self, details: LobbyDetails) -> Result<()> {
        if self.details != details {
            self.details = details;
            let update_message = &UserMessage::LobbyDetails {
                details: self.details.clone(),
            };
            self.send_message_to_host(update_message).await
        } else {
            Ok(())
        }
    }

    pub async fn request_invitation(
        &mut self,
        message: &UserMessage,
    ) -> Result<oneshot::Receiver<UserMessage>> {
        log::user_action!("Requesting invitation to host");
        self.send_message_to_host(message).await?;

        let (send_invitation, receive_invitation) = oneshot::channel();
        self.join_requests.push(send_invitation);
        Ok(receive_invitation)
    }

    pub fn send_invitation(&mut self, message: UserMessage) -> Result<()> {
        if let Some(invitation_receiver) = self.join_requests.pop() {
            invitation_receiver.send(message).map_err(|_| ())
        } else {
            Err(())
        }
    }

    pub fn is_public(&self) -> bool {
        self.details.public_lobby
    }
}
