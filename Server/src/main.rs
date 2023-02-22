#![feature(map_try_insert, type_alias_impl_trait)]

mod lobby;
mod message;

use futures_util::*;
use lobby::*;
use message::*;
use warp::ws::WebSocket;
use warp::Filter;

#[tokio::main]
async fn main() {
    let api_client = warp::path!("api" / "client")
        .and(warp::post())
        .and(warp::body::content_length_limit(1024 * 2))
        .and(warp::body::json())
        .then(|data: UserMessage| async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            warp::reply::json(&data)
        });

    let api_host = warp::path!("api" / "host")
        .and(warp::ws())
        .map(|ws: warp::ws::Ws| ws.on_upgrade(handle_host));

    let routes = api_client.or(api_host);

    warp::serve(routes).run(([127, 0, 0, 1], 3030)).await;
}

async fn handle_host(host: WebSocket) {
    let (sender, mut receiver) = host.split();

    let Some(create_message) = UserMessage::from(receiver.next().await) else {
        return;
    };

    let Some(mut lobby) = Lobby::create(create_message, sender).await else {
        return;
    };

    while let Some(message) = UserMessage::from(receiver.next().await) {
        if lobby.handle_host_message(message).is_err() {
            return;
        }
    }

    println!("Bye");
}
