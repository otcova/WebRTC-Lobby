# WebRTC Lobby

Signalling server for WebRTC with a layer of abstraction.

One user is the host of the Lobby, and the others can join as clients.
The lobby can have a custom name and be private or public.
Therefore the clients can join by name, or choose a lobby from the public list.

## How it works

- **Server:**
To do the RTC Signaling we need a server. It will also
keeps track of the current lobbies.

- **Host:**
The user that creates the lobby. He will be able to
connect to every client.

- **Client:**
The user that joins a lobby. He will have an `RTCPeerConnection` with the host.


## Examples

- **Create a lobby**
```js
const options = {
    public: true,
    maxClients: Infinity,
};
const lobbyName = "Potatoes";
const lobby = createLobby(lobbyName, options);

if (lobby) {
    lobby.onClientConnect = client => {
        console.log("Connected", client.id);
        
        client.send("Hello");
        client.onReceive = message => console.log(message);
    }

    lobby.onClientDisconnect = client => {
        console.log("Disconnected", client.id);
    };
} else {
    console.log(lobbyName, "lobby already exists");
}
```

- **Join a lobby**
```js
const lobbyName = "Potatoes";
const lobby = await joinLobby(lobbyName);

if (lobby) {
    lobby.host.onReceive = message => lobby.host.send([message, ":0"]);
    lobby.onClose = () => console.log("Bye!");
} else {
    console.log("Can't join to", lobbyName, "lobby");
}
```
- **List Public lobbies**
```js
const lobbies = listPublicLobbies(20, { skipFullLobbies: true });
for (const lobby of lobbies) {
    console.log(lobby.name, `(${lobby.clientCount}/${lobby.maxClients}`);
}
```

## How it works internally

### Create a Lobby

The Host will connect to the server using a WebSocket. The connection will be used to
send a "create-lobby" request but will be maintained until the host closes the lobby.
It is necessary to maintain the connection to do the signalling.

```js
// Host -> Server
{
    type: "create-lobby",
    lobbyName: "Potatoes",
    public: false,
    maxClients: 20,
}
```

If the name "Potatoes" is available, the Server will respond with a success:

## Join a lobby

The process is an exchange of information between the Server,
the Host and the Client.
```js
// Client -> Server -> Host
{
    type: "join-request",
    lobbyName: "Potatoes",
    offer: RTCOffer,
}

// Host -> Server -> Client
{
    type: "join-details",
    answer: RTCAnswer,
}
```

## Lobby Client Count

The host will keep track of the clients with the RTCPeerConnection.
The server will need to receive a notification from the host to
update the clientCount.

```js
// Host -> Server
{
    type: "update-lobby-metadata",
    clientCount: 3,
}
```