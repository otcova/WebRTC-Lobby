import { createLobby, joinLobby } from "rtc-lobby-node";
import { assert, shouldResolve } from "./error-utils.js";

const clientUrl = "http://127.0.0.1:3030/api/client";
const hostUrl = "ws://127.0.0.1:3030/api/host";

// This is to prevent a bug on RTCPeerConnection of the package wrtc
// When we call `.close()` it overwites the exit code to 3221226505.
process.on("exit", () => process.exit());

{
    let lobby = await joinLobby(clientUrl);
    const msg = "Client can't join if there aren't lobbies";

    if (lobby.errorType == "lobbyNotFound")
        assert(lobby.errorType == "lobbyNotFound", msg);
    else if ("error" in lobby) assert(lobby, msg);
    else {
        error(msg);
        lobby.close();
    }
}

createLobby(hostUrl + "invalidUrl").then(lobby => {
    assert(lobby.errorType == "connection", "Connection error if the url is invalid");
});

createLobby(hostUrl).then(lobby => {
    if (!assert(lobby, "Create lobby with random name")) return;
    const onClose = new Promise(resolve => lobby.onClose = resolve);
    lobby.close();
    shouldResolve(onClose, "Host connection closed");
});

createLobby(hostUrl, { lobbyName: "Potatoes" }).then(lobby => {
    if (!assert(lobby, "Create lobby")) return;
    lobby.close();
});

joinLobby(clientUrl, "there's-no-lobby-with-this-name").then(lobby => {
    assert(lobby.errorType == "lobbyNotFound",
        "Client can't join to a lobby that does not exist"
    );
    if (!("error" in lobby)) lobby.disconnect();
});


createLobby(hostUrl, { lobbyName: "123 Abracadabra :O" }).then(async lobby => {
    shouldResolve(new Promise(resolve => {

        lobby.onClientConnect = client => {
            client.onDisconnect = resolve;
        };

    }), "Detect a client disconnect");

    const client = await joinLobby(clientUrl, lobby.lobbyName);
    lobby.close();

    if (assert(client, "Connect a client to a lobby by name")) {
        client.disconnect();
    }
});

createLobby(hostUrl, { lobbyName: "321 Pomelo :O" }).then(async lobby => {
    const numOfClients = 2;

    shouldResolve(new Promise(resolve => {
        let clientsToDisconnect = numOfClients;

        lobby.onClientConnect = client => {
            client.onDisconnect = () => {
                if (--clientsToDisconnect == 0) resolve();
            }
        };

    }), "Detect " + numOfClients + " disconnections");

    const clients = await Promise.all([
        joinLobby(clientUrl, lobby.lobbyName),
        joinLobby(clientUrl, lobby.lobbyName),
    ]);

    lobby.close();
    for (const client of clients) {
        if (assert(client, "Connect " + numOfClients + " clients to a lobby by name")) {
            client.disconnect();
        }
    }
});

const traffic = {
    hosts: 4,
    clientsPerHost: 4,
    createdLobbies: 0,
    createdClients: 0,
    receivedMessages: 0,
    promises: [],
};

for (let i = 0; i < traffic.hosts; ++i) {
    const lobbyName = i % 2 == 0 ? "traffic" + i : undefined;
    let promise = createLobby(hostUrl, { lobbyName }).then(async lobby => {
        if ("error" in lobby) return;
        return new Promise(resolve => {
            ++traffic.createdLobbies;

            let disconectedClients = 0;

            lobby.onClientConnect = client => {
                client.onMessage = message => client.send(message);
                client.onClose

                client.onDisconnect = () => {
                    ++disconectedClients;
                    if (disconectedClients == traffic.clientsPerHost) {
                        lobby.close();
                        resolve();
                    }
                };
            }

            for (let j = 0; j < traffic.clientsPerHost; ++j) {
                let msgToSend = { n: j };
                joinLobby(clientUrl, lobby.lobbyName).then(clientLobby => {
                    if ("error" in clientLobby) {
                        lobby.close();
                        console.log(clientLobby);
                        resolve();
                        return;
                    }
                    ++traffic.createdClients;
                    clientLobby.onMessage = msg => {
                        if (JSON.stringify(msg) == JSON.stringify(msgToSend)) {
                            ++traffic.receivedMessages;
                        }
                        clientLobby.disconnect();
                    };
                    clientLobby.send(msgToSend);
                });
            }
        });
    });

    traffic.promises.push(promise);
}

shouldResolve(Promise.all(traffic.promises),
    "Many simultaneous requests resolved quickly"
);

Promise.all(traffic.promises).then(() => {
    assert(traffic.createdLobbies == traffic.hosts,
        "Many simultaneous create-lobby requests"
    );

    assert(traffic.createdClients == traffic.hosts * traffic.clientsPerHost,
        "Many simultaneous join-lobby requests"
    );

    assert(traffic.receivedMessages == traffic.hosts * traffic.clientsPerHost,
        "Many simultaneous [Client -> Host -> Client] messages"
    );
});
