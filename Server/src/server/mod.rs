mod lobby;
mod random_words;

use self::random_words::random_word;
use crate::error::Result;
use crate::log;
use crate::message::*;
use futures_util::stream::SplitSink;
use lobby::*;
use std::collections::{HashMap, HashSet};
use tokio::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};
use warp::ws::{Message, WebSocket};

pub type HostChannel = SplitSink<WebSocket, Message>;

pub type LoobiesMap = HashMap<String, Mutex<Lobby>>;

#[derive(Default)]
pub struct Server {
    lobbies_map: RwLock<LoobiesMap>,
    public_lobbies: RwLock<HashSet<String>>,
}

impl Server {
    fn create_lobby<'a>(
        lobbies_map: &mut RwLockWriteGuard<'a, LoobiesMap>,
        host_channel: HostChannel,
        lobby_name: String,
    ) -> Result<String> {
        let lobby = Lobby::create(
            host_channel,
            LobbyDetails {
                lobby_name: lobby_name.clone(),
                public_lobby: false,
                max_clients: 0,
                client_count: 0,
            },
        );

        match lobbies_map.try_insert(lobby_name.clone(), Mutex::new(lobby)) {
            Ok(_) => Ok(lobby_name),
            Err(_) => {
                log::user_action!("Can not create lobby because name already exists");
                Err(())
            }
        }
    }

    fn new_random_lobby_name<'a>(
        lobbies_map: &mut RwLockWriteGuard<'a, LoobiesMap>,
    ) -> Result<String> {
        let mut lobby_name = random_word().to_string();

        for _ in 0..32 {
            if !lobbies_map.contains_key(&lobby_name) {
                return Ok(lobby_name);
            }

            lobby_name += " ";
            lobby_name += random_word();
        }

        log::error!("Could not generate a new lobby name");
        Err(())
    }

    async fn create_default_lobby<'a>(
        &self,
        host_channel: HostChannel,
        lobby_name: Option<String>,
    ) -> Result<String> {
        let mut lobbies_map = self.lobbies_map.write().await;
        let lobby_name = match lobby_name {
            Some(lobby_name) => lobby_name,
            None => Self::new_random_lobby_name(&mut lobbies_map)?,
        };
        Self::create_lobby(&mut lobbies_map, host_channel, lobby_name)
    }

    async fn get_lobby<'a>(
        lobbies_map: &'a RwLockReadGuard<'a, LoobiesMap>,
        lobby_name: &String,
    ) -> Result<MutexGuard<'a, Lobby>> {
        let Some(lobby) = lobbies_map.get(lobby_name) else {
            log::error!("The lobby of a host is not registered");
            return Err(());
        };

        Ok(lobby.lock().await)
    }

    pub async fn create_lobby_from_message(
        &self,
        message: UserMessage,
        host_channel: HostChannel,
    ) -> Result<String> {
        match message {
            UserMessage::CreateLobby {
                lobby_name,
                public_lobby,
                max_clients,
            } => {
                log::user_action!("Received create-lobby message");
                let lobby_name = self.create_default_lobby(host_channel, lobby_name).await?;

                self.update_lobby(
                    &lobby_name,
                    LobbyDetails {
                        lobby_name: lobby_name.clone(),
                        public_lobby,
                        max_clients,
                        client_count: 0,
                    },
                )
                .await
            }
            _ => Err(()),
        }
    }

    pub async fn close_lobby(&self, lobby_name: &String) {
        log::user_action!("Closeing lobby '{lobby_name}'");
        // Delete from lobbies map
        let lobby = {
            let mut lobbies_map = self.lobbies_map.write().await;
            let Some(lobby) = lobbies_map.remove(lobby_name) else {
                return;
            };
            lobby
        };

        // Delete from public lobbies list
        let lobby = lobby.lock().await;

        if lobby.is_public() {
            let mut public_lobbies = self.public_lobbies.write().await;
            public_lobbies.remove(lobby_name);
        }
    }

    // Returns the new lobby name
    async fn update_lobby(
        &self,
        lobby_name: &String,
        mut new_details: LobbyDetails,
    ) -> Result<String> {
        log::user_action!("Updateing lobby '{lobby_name}'");

        // Try Rename Lobby
        let lobby_name = match lobby_name == &new_details.lobby_name {
            true => lobby_name.clone(),
            false => {
                let mut lobbies_map = self.lobbies_map.write().await;

                if lobbies_map.contains_key(&new_details.lobby_name) {
                    // Ignore lobby rename
                    new_details.lobby_name = lobby_name.clone();
                    lobby_name.clone()
                } else {
                    // Rename lobby
                    let Some(lobby) = lobbies_map.remove(lobby_name) else {
                        log::error!("The lobby of a host is not registered");
                        return Err(());
                    };

                    lobbies_map.insert(new_details.lobby_name.clone(), lobby);
                    new_details.lobby_name.clone()
                }
            }
        };

        let lobbies_map = self.lobbies_map.read().await;
        let mut lobby = Self::get_lobby(&lobbies_map, &lobby_name).await?;

        // Update public lobbies list
        if lobby.is_public() != new_details.public_lobby {
            let mut public_lobbies = self.public_lobbies.write().await;
            if new_details.public_lobby {
                public_lobbies.insert(lobby_name.clone());
            } else {
                public_lobbies.remove(&lobby_name);
            }
        }

        lobby.update_details(new_details).await?;
        Ok(lobby_name)
    }

    // Return the lobby name (a message could have change it)
    pub async fn handle_host_message(
        &self,
        lobby_name: &String,
        message: UserMessage,
    ) -> Result<String> {
        match message {
            UserMessage::LobbyDetails { details } => self.update_lobby(lobby_name, details).await,
            UserMessage::JoinInvitation { answer } => {
                let lobbies_map = self.lobbies_map.read().await;
                let mut lobby = Self::get_lobby(&lobbies_map, lobby_name).await?;

                lobby.send_invitation(UserMessage::JoinInvitation { answer })?;
                Ok(lobby_name.clone())
            }
            _ => Err(()),
        }
    }

    pub async fn handle_user_message(&self, message: UserMessage) -> UserMessage {
        match &message {
            UserMessage::JoinRequest {
                lobby_name,
                offer: _,
            } => {
                log::user_action!("Received join-request");

                let join_invitation = {
                    let lobby_name = if let Some(lobby_name) = lobby_name {
                        lobby_name.clone()
                    } else {
                        // Pick any lobby from the public list
                        let public_lobbies = self.public_lobbies.read().await;
                        match public_lobbies.iter().next() {
                            Some(lobby_name) => lobby_name.clone(),
                            None => return UserMessageError::LobbyNotFound.into(),
                        }
                    };
                    log::user_action!("Joining to lobby '{lobby_name}'");

                    let lobbies_map = self.lobbies_map.read().await;
                    let Ok(mut lobby) = Self::get_lobby(&lobbies_map, &lobby_name).await else {
                        return UserMessageError::LobbyNotFound.into();
                    };

                    lobby.request_invitation(&message).await
                };

                let Ok(join_invitation) = join_invitation else {
                    return UserMessageError::LobbyNotFound.into();
                };

                if let Ok(join_invitation) = join_invitation.await {
                    join_invitation
                } else {
                    UserMessageError::LobbyNotFound.into()
                }
            }
            _ => UserMessageError::InvalidMessageType.into(),
        }
    }
}
