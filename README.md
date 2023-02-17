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
const lobbyName = "Potatoes";
const loobyOptions = {
    lobbyName,
    publicLobby: true,
    maxClients: Infinity,
};
const lobby = createLobby("<server-url>", loobyOptions);
if ("error" in lobby) throw Error(`Can't create ${lobbyName} lobby because: ${lobby.error}`);

lobby.onClientConnect = client => {
    console.log(`Client ${client.id} Connected`);
    
    client.send("Hello");
    client.onReceive = message => console.log(message);
}

lobby.onClientDisconnect = client => {
    console.log(`Client ${client.id} Disconnected`);
};
```

- **Join a lobby**
```js
const lobbyName = "Potatoes";
const lobby = await joinLobby(lobbyName);
if ("error" in lobby) throw Error(`Can't join to ${lobbyName} lobby because: ${lobby.error}`);

lobby.onReceive = message => lobby.send({ received: message });
lobby.onClose = () => console.log("Bye!");
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
    publicLobby: false,
    maxClients: 20,
}
```

If the lobby can be created, the Server will respond with the lobby details.

```js
// Host -> Server
{
    type: "lobby-details",
    details: {
        lobbyName: "Potatoes",
        publicLobby: false,
        maxClients: 20,
        clientCount: 0,
    }
}
```

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
    type: "join-invitation",
    answer: RTCAnswer,
}
```

After this exchange of information the host will be abole to create an
RTCPeerConnection with the client. Then the host will send to the server
a `lobby-details` message to update the clientCount.


## Update Lobby Details

The host may want to change some lobby details. To maintain the server in sync
a message will be send. To know if the changes were successful the server will
send back the package.

Example of a success:
```js
// Host -> Server
{
    type: "lobby-details",
    details: {
        lobbyName: "Potatoes",
        publicLobby: false,
        maxClients: 4,
        clientCount: 3,
    }
}

// Server -> Host
{
    type: "lobby-details",
    details: {
        lobbyName: "Potatoes",
        publicLobby: false,
        maxClients: 4,
        clientCount: 3,
    }
}
```

Example of a fail when renameing a lobby:
```js
// Host -> Server
{
    type: "lobby-details",
    details: {
        lobbyName: "Chips",
        publicLobby: false,
        maxClients: 20,
        clientCount: 3,
    }
}

// Server -> Host
{
    type: "lobby-details",
    details: {
        lobbyName: "Potatoes",
        publicLobby: false,
        maxClients: 20,
        clientCount: 3,
    }
}
```