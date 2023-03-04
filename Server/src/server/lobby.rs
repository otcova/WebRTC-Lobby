use super::HostChannel;
use crate::log;
use crate::message::*;
use futures_util::*;
use std::collections::HashMap;
use tokio::sync::oneshot;

pub struct Lobby {
    host_channel: HostChannel,
    details: LobbyDetails,
    join_requests: HashMap<u32, oneshot::Sender<UserMessage>>,
    past_join_request_id: u32,
}

impl Lobby {
    pub fn create(host_channel: HostChannel, details: LobbyDetails) -> Lobby {
        Lobby {
            host_channel,
            details,
            join_requests: HashMap::new(),
            past_join_request_id: 0,
        }
    }

    pub fn details(&self) -> &LobbyDetails {
        &self.details
    }

    async fn send_message_to_host(&mut self, message: &UserMessage) -> Result<(), ()> {
        if self.host_channel.send(message.into()).await.is_ok() {
            Ok(())
        } else {
            Err(())
        }
    }

    pub async fn send_error_to_host(&mut self, error: UserMessageError) {
        let _ = self.host_channel.send(error.into()).await;
    }

    pub async fn update_details(&mut self, details: LobbyDetails) -> Result<(), ()> {
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
        offer: String,
    ) -> Result<oneshot::Receiver<UserMessage>, ()> {
        log::user_action!("Requesting invitation to host");

        self.past_join_request_id += 1;
        self.send_message_to_host(&UserMessage::JoinRequest {
            lobby_name: Some(self.details.lobby_name.clone()),
            offer,
            id: Some(self.past_join_request_id),
        })
        .await?;

        let (send_invitation, receive_invitation) = oneshot::channel();
        self.join_requests
            .insert(self.past_join_request_id, send_invitation);
        Ok(receive_invitation)
    }

    pub fn send_invitation(&mut self, answer: String, id: u32) -> Result<(), ()> {
        if let Some(invitation_receiver) = self.join_requests.remove(&id) {
            invitation_receiver
                .send(UserMessage::JoinInvitation {
                    answer,
                    id: Some(id),
                })
                .map_err(|_| ())
        } else {
            Err(())
        }
    }

    pub fn is_public(&self) -> bool {
        self.details.public_lobby
    }
}
