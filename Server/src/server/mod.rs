mod lobby;
mod random_words;

use self::random_words::random_word;
use crate::log;
use crate::message::*;
use futures_util::stream::SplitSink;
use futures_util::*;
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
    async fn create_lobby<'a>(
        lobbies_map: &mut RwLockWriteGuard<'a, LoobiesMap>,
        host_channel: HostChannel,
        lobby_name: String,
    ) -> Result<String, ()> {
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
            Err(error) => {
                log::user_action!("Can not create lobby because name already exists");
                let mut lobby = error.value.lock().await;
                lobby
                    .send_error_to_host(UserMessageError::LobbyAlreadyExists)
                    .await;
                Err(())
            }
        }
    }

    fn new_random_lobby_name<'a>(lobbies_map: &mut RwLockWriteGuard<'a, LoobiesMap>) -> String {
        let mut lobby_name = random_word().to_string();

        loop {
            if !lobbies_map.contains_key(&lobby_name) {
                return lobby_name;
            }

            lobby_name += " ";
            lobby_name += random_word();
        }
    }

    async fn create_default_lobby<'a>(
        &self,
        host_channel: HostChannel,
        lobby_name: Option<String>,
    ) -> Result<String, ()> {
        let mut lobbies_map = self.lobbies_map.write().await;
        let lobby_name = match lobby_name {
            Some(lobby_name) => lobby_name,
            None => Self::new_random_lobby_name(&mut lobbies_map),
        };
        Self::create_lobby(&mut lobbies_map, host_channel, lobby_name).await
    }

    async fn get_lobby<'a>(
        lobbies_map: &'a RwLockReadGuard<'a, LoobiesMap>,
        lobby_name: &String,
    ) -> Result<MutexGuard<'a, Lobby>, ()> {
        let Some(lobby) = lobbies_map.get(lobby_name) else {
            return Err(());
        };

        Ok(lobby.lock().await)
    }

    pub async fn create_lobby_from_message(
        &self,
        message: UserMessage,
        mut host_channel: HostChannel,
    ) -> Result<String, ()> {
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
            _ => {
                let error_msg = UserMessageError::InvalidMessage.into();
                let _ = host_channel.send(error_msg).await;
                Err(())
            }
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
    ) -> Result<String, ()> {
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
        let Ok(mut lobby) = Self::get_lobby(&lobbies_map, &lobby_name).await else {
            log::error!("The lobby of a host is not registered");
            return Err(());
        };

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
    ) -> Result<String, ()> {
        match message {
            UserMessage::LobbyDetails { details } => self.update_lobby(lobby_name, details).await,
            UserMessage::JoinInvitation { answer, id } => {
                let lobbies_map = self.lobbies_map.read().await;
                let Ok(mut lobby) = Self::get_lobby(&lobbies_map, lobby_name).await else {
                    log::error!("The lobby of a host is not registered");
                    return Err(());
                };

                let Some(id) = id else {
                    log::user_error!("The join invitation should have an id");
                    lobby.send_error_to_host(UserMessageError::InvalidMessage).await;
                    return Err(());
                };

                lobby.send_invitation(answer, id)?;
                Ok(lobby_name.clone())
            }
            _ => Err(()),
        }
    }

    pub async fn handle_user_message(&self, message: UserMessage) -> UserMessage {
        match message {
            UserMessage::JoinRequest {
                lobby_name,
                offer,
                id: _,
            } => {
                log::user_action!("Received join-request");

                let join_invitation = {
                    let lobby_name = if let Some(lobby_name) = lobby_name {
                        lobby_name
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

                    lobby.request_invitation(offer).await
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
            UserMessage::LobbiesListRequest {
                maximum_lobbies,
                minimum_capacity,
            } => {
                log::user_action!("Received lobbies-list-request");

                let lobbies_map = self.lobbies_map.read().await;
                let public_lobbies = self.public_lobbies.read().await;

                let mut lobbies = vec![];

                for lobby_name in public_lobbies.iter() {
                    let Some(lobby) = lobbies_map.get(lobby_name) else {
                        continue;
                    };

                    let lobby = lobby.lock().await;
                    let details = lobby.details();

                    if details.capacity() < minimum_capacity {
                        continue;
                    }

                    lobbies.push(details.clone());
                    if lobbies.len() >= maximum_lobbies {
                        break;
                    }
                }

                UserMessage::LobbiesList { lobbies }
            }
            _ => UserMessageError::InvalidMessage.into(),
        }
    }
}
