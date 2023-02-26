use std::collections::HashMap;

use crate::error::Result;
use crate::lobbies::lobby::Lobby;
use crate::lobbies::LobbyDatabase;

#[derive(Default)]
pub struct RamDatabase {
}

impl LobbyDatabase for RamDatabase {
    fn add_lobby(&mut self, lobby: Lobby) -> Result<()> {
        match self.map.try_insert(lobby.details.lobby_name, lobby) {
            Ok(_) => Ok(()),
            Err(_) => Err(()),
        }
    }
}
