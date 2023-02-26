#![feature(map_try_insert, trait_alias, async_closure)]

mod error;
mod log;
mod message;
mod server;

use futures_util::*;
use lazy_static::lazy_static;
use message::*;
use server::*;
use warp::ws::WebSocket;
use warp::{reject, reply, Filter};

lazy_static! {
    static ref SERVER: Server = Server::default();
}

#[tokio::main]
async fn main() {
    let api_client = warp::path!("api" / "client")
        .and(warp::post())
        .and(warp::body::content_length_limit(1024 * 2))
        .and(warp::body::json())
        .and_then(|message: UserMessage| handle_client(&SERVER, message));

    let api_host = warp::path!("api" / "host")
        .and(warp::ws())
        .map(|ws: warp::ws::Ws| ws.on_upgrade(async move |host| handle_host(&SERVER, host).await));

    let routes = api_client.or(api_host);

    warp::serve(routes).run(([127, 0, 0, 1], 3030)).await;
}

async fn handle_host(server: &Server, host: WebSocket) {
    log::user_action!("Host connected");

    let (sender, mut receiver) = host.split();

    let Some(create_message) = UserMessage::from(receiver.next().await) else {
        log::user_error!("Host should have sended a create-lobby message");
        return;
    };

    let Ok(mut lobby_name) = server.create_lobby_from_message(create_message, sender).await else {
        log::user_error!("Host could not the create lobby");
        return;
    };

    while let Some(message) = UserMessage::from(receiver.next().await) {
        log::user_action!("Received message from host of '{lobby_name}'");
        match server.handle_host_message(&lobby_name, message).await {
            Ok(name) => lobby_name = name,
            Err(()) => break,
        }
    }

    server.close_lobby(&lobby_name).await;
}

async fn handle_client(
    server: &Server,
    message: UserMessage,
) -> Result<reply::Json, reject::Rejection> {
    log::user_action!("Client connected");

    let response = server.handle_user_message(message).await;
    Ok(reply::json(&response))
}

