import { createLobby, joinLobby, listPublicLobbies } from "rtc-lobby-node";
import { assert, runTests, shouldResolve, startTest } from "./error-utils.js";

const serverUrl = "127.0.0.1:3030";

startTest(async () => {
    let lobby = await joinLobby(serverUrl);
    const msg = "Client can't join if there aren't lobbies";

    if (lobby.errorType == "lobbyNotFound") assert(lobby.errorType == "lobbyNotFound", msg);
    else if ("error" in lobby) assert(lobby, msg);
    else {
        error(msg);
        lobby.close();
    }
});

startTest(async () => {
    let lobby = await createLobby(serverUrl + "/invalidUrl");
    assert(lobby.errorType == "connection", "Connection error if the url is invalid");
});

await runTests();

startTest(async () => {
    let lobby = await joinLobby(serverUrl);
    assert(lobby.errorType == "lobbyNotFound", "Join any lobby when there are none");
});

startTest(async () => {
    let lobbies = await listPublicLobbies(serverUrl);
    assert(lobbies.length == 0, "List lobbies when there are none");
});

await runTests();

startTest(async () => {
    const lobbies = await Promise.all([
        createLobby(serverUrl, { publicLobby: true, maxClients: 1 }),
        createLobby(serverUrl, { publicLobby: true, maxClients: 1 }),
        createLobby(serverUrl, { publicLobby: true, maxClients: 2 }),
        createLobby(serverUrl, { publicLobby: true, maxClients: 2 }),
        createLobby(serverUrl, { publicLobby: true, maxClients: 2 }),
        createLobby(serverUrl, { publicLobby: true, maxClients: 3 }),
        createLobby(serverUrl, { publicLobby: true, maxClients: 4 }),
    ]);

    const maximumLobbies = 3;
    const minimumCapacity = 2;
    let listed_lobbies = await listPublicLobbies(serverUrl, {
        maximumLobbies,
        minimumCapacity,
    });

    for (const lobby of lobbies) lobby.close();

    if ("error" in listed_lobbies) return assert(listed_lobbies, "Listed lobbies");
    if (listed_lobbies.length != maximumLobbies) return error("List lobbies");
    for (const lobby of listed_lobbies) {
        if (lobby.maxClients < minimumCapacity) return error("List lobbies");
    }

});

await runTests();

startTest(async () => {
    let lobby = await createLobby(serverUrl);
    if (!assert(lobby, "Create lobby with random name")) return;

    const onClose = new Promise(resolve => lobby.onClose = resolve);
    lobby.close();
    shouldResolve(onClose, "Host connection closed");
});

startTest(async () => {
    let lobby = await createLobby(serverUrl, { lobbyName: "Potatoes" });
    if (!assert(lobby, "Create lobby")) return;
    lobby.close();
});

startTest(async () => {
    let lobby = await joinLobby(serverUrl, "there's-no-lobby-with-this-name");
    assert(lobby.errorType == "lobbyNotFound",
        "Client can't join to a lobby that does not exist"
    );
    if (!("error" in lobby)) lobby.disconnect();
});


startTest(async () => {
    let lobby = await createLobby(serverUrl, { lobbyName: "123 Abracadabra :O" });
    shouldResolve(new Promise(resolve => {

        lobby.onClientConnect = client => {
            client.onDisconnect = resolve;
        };

    }), "Detect a client disconnect");

    const client = await joinLobby(serverUrl, lobby.lobbyName);
    lobby.close();

    if (assert(client, "Connect a client to a lobby by name")) {
        client.disconnect();
    }
});

startTest(async () => {
    let lobby = await createLobby(serverUrl, { lobbyName: "321 Pomelo :O" });
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
        joinLobby(serverUrl, lobby.lobbyName),
        joinLobby(serverUrl, lobby.lobbyName),
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
    startTest(async () => {
        const lobbyName = i % 2 == 0 ? "traffic" + i : undefined;
        let lobby = await createLobby(serverUrl, { lobbyName });
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
                joinLobby(serverUrl, lobby.lobbyName).then(clientLobby => {
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
}

await runTests();

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
