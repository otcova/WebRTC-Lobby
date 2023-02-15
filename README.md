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
The user that joins to a lobby. He will have a single
rtc connection to the host.

---

## Examples

- **Create a lobby**
```js
const options = {
	public: true,
	maxClients: Infinity,
};
const lobby = createLobby("Potatoes");

if (lobby) {
	lobby.onClientConnect = client => {
		console.log("Connected", client.id);
		
		client.channel.send("Hello");
		client.channel.onmessage = ({data}) => console.log(">", data);
	}

	lobby.onClientDisconnect = client => {
		console.log("Disconnected", client.id);
	};
}
else {
	console.log("Potates lobby already exists");
}
```

- **Join a lobby**
```js
const lobbyName = "Potatoes";
const lobby = await joinLobby(lobbyName);

if (lobby) {
	lobby.hostChannel.onmessage = ({data}) => {
		console.log(">", data);
		lobby.hostChannel.send(":0");
	};
	lobby.hostChannel.onclose = () => console.log("The host has disconected");
}
else {
	console.log("Can't join to", lobbyName, "lobby");
}
```
- **List Public lobbies**
```js
const lobbies = listPublicLobbies(20, { skipFullLobbies: true });
for (const lobby of lobbies) {
	console.log(lobby.name, `(${lobby.clientsCount}/${lobby.maxClients}`);
}
```

---

## How it works internally

### Create a Lobby

The Host will send the following request to the server:
```ts
{
	type: "create-lobby",
	lobby: {
		name: "Potatoes",
		public: false,
		maxClients: 20,
	},
	// To reduce delay a small amount of rtc offers are
	// created before the clients request an invitation.
	// If the server doesn't have invitation when the client requested,
	// it will need to request more to the Host.
	invitaionts: [{ id, RTCOffer }, { id, RTCOffer }],
}
```

If the name "Potatoes" is available, the Server will respond with a success:

## Join a lobby

The process is an exchange of information between the Server,
the Host and the Client.
```js
// Client -> Server
{
	type: "request-invitation",
	lobbyName: "Potatoes",
}

// The server might not have enought offers if
// multiple clients connect at the same time.
if (lobbies.get("Potatoes").invitations.length == 0) {
	// Server -> Host
	{
		type: "request-invitation",
		lobbyName: "Potatoes",
	}
	// Host -> Server
	{
		reply: "request-invitation",
		lobbyName: "Potatoes",
		invitations: { id, RTCOffer },
	}
}

// Server -> Client
{
	reply: "request-invitation",
	lobbyName: "Potatoes",
	invitation: { id, RTCOffer },
}

// Server -> Host
{
	type: "used-invitation",
	lobbyName: "Potatoes",
	invitationId: id,
}

// Host -> Server
{
	reply: "used-invitation",
	lobbyName: "Potatoes",
	// if max clients hasn't been reached,
	// it will send another invitation.
	invitaion?: { id, RTCOffer },
}

// Client -> Server
{
	type: "accept-invitation",
	lobbyName: "Potatoes",
	answer: { invitationId, RTCAnswer },
}

// Server -> Host
{
	type: "client-connection",
	lobbyName: "Potatoes",
	answer: { invitationId, RTCAnswer },
}

// Host -> Server
{
	reply: "client-connection",
	lobbyName: "Potatoes",
}
```