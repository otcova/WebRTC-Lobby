import { createLobby, LobbyCreationOptions, LobbyDetails } from "./index.js";
import { InternalError, createTimeout, DeserializeError, displayAny, ConnectionError, SerializeError, TimeoutError, LobbyNotFound } from "./error.js";
import { RTCAnswer, RTCOffer } from "./rtc-link.js";
import { DeserializeResult, parse, stringify } from "./serializer.js";

//! if target == NodeJs
import WebSocket from "ws";

export type MsgSchema =
    {
        type: "create-lobby",
        lobbyName?: string;
        publicLobby: boolean;
        maxClients?: number;
    } |
    {
        type: "join-request",
        lobbyName?: string,
        offer: RTCOffer,
        id?: number,
    } |
    {
        type: "join-invitation",
        answer: RTCAnswer,
        id?: number,
    } |
    {
        type: "lobby-details",
        details: LobbyDetails,
    } |
    {
        type: "error",
        errorType: "lobbyNotFound" | "lobbyAlreadyExists" | "invalidMessage",
    };


interface ServerChannel {
    send(message: MsgSchema): SerializeError | undefined;
    close(): void;
    set onReceive(callback: ((message: DeserializeResult<MsgSchema>) => void));
    set onClose(callback: () => void);
}

function createWebSocket(url: string | URL, timeoutMs: number) {
    const timeout = createTimeout<ServerChannel | ConnectionError>(timeoutMs, "Coudn't connect with the server");

    const ws = new WebSocket(url);

    ws.onerror = (e) => timeout.resolve({
        //! if target == NodeJs
        error: e.message,
        //! if target == Browser
        // error: `Could not connect to '${url}'`,
        errorType: "connection",
    });

    const server: ServerChannel = {
        close: () => ws.close(),
        send(message) {
            const data = stringify(message);
            if (typeof data != "string") return data;
            ws.send(data);
        },
        set onClose(callback: () => void) {
            ws.onclose = callback;
        },
        set onReceive(callback: (message: DeserializeResult<MsgSchema>) => void) {
            ws.onmessage = async ({ data }) => {
                if (typeof data == "string") {
                    const message = parse<MsgSchema>(data);
                    if ("error" in message) message.error = "The server response can't be deserialized";
                    callback(message);
                } else {
                    console.error(`received unexpected message type from lobby server (${typeof data})`);
                }
            }
        },
    };

    ws.onopen = () => timeout.resolve(server);

    return timeout.result;
}

export interface UpdateLobbyDetails {
    lobbyName?: string,
    publicLobby?: boolean;
    maxClients?: number;
    clientCount?: number;
};

interface ServerHost {
    lobbyDetails: LobbyDetails;
    createRTCAnswer?: (offer: RTCOffer) => Promise<RTCAnswer | InternalError>,
    /** If the timeout expires the update could happend later anyway */
    updateLobbyDetails(
        details: UpdateLobbyDetails, timeoutMs: number
    ): Promise<LobbyDetails | TimeoutError>;
    close(): void;
    onClose?: () => void;
}

export async function createServerHostConnection(
    serverURL: string,
    lobbyOpts: LobbyCreationOptions,
    timeoutMs: number,
): Promise<ServerHost | InternalError> {
    const channel = await createWebSocket(serverURL, timeoutMs);
    if ("error" in channel) return channel;

    let createLobbyMsg: MsgSchema = {
        type: "create-lobby",
        maxClients: 500,
        publicLobby: true,
        ...lobbyOpts,
    };

    // Prevent some js user to pass a non string lobby name
    if (createLobbyMsg.lobbyName) {
        createLobbyMsg.lobbyName = String(createLobbyMsg.lobbyName);
    }

    const serializeError = channel.send(createLobbyMsg);
    if (serializeError) {
        channel.close();
        return {
            error: `lobby creation options are invalid ${displayAny(lobbyOpts)}`,
            errorType: "invalidData",
        };
    }

    const timeoutHandle = createTimeout<{ details: LobbyDetails } | DeserializeError>(
        timeoutMs, "The server has not answered the 'create-lobby' request"
    );

    channel.onReceive = async message => {
        if ("error" in message) timeoutHandle.resolve(message);
        else if (message.data.type == "lobby-details") {
            timeoutHandle.resolve({ details: message.data.details });
        }
    };

    const lobby = await timeoutHandle.result;
    if ("error" in lobby) {
        channel.close();
        return lobby;
    }

    let onLobbyDetails: ((details: LobbyDetails) => void)[] = [];

    const server: ServerHost = {
        lobbyDetails: {
            get lobbyName() { return lobby.details.lobbyName; },
            get publicLobby() { return lobby.details.publicLobby; },
            get maxClients() { return lobby.details.maxClients; },
            get clientCount() { return lobby.details.clientCount; },
        },
        updateLobbyDetails: (details: UpdateLobbyDetails, timeoutMs: number) => {
            channel.send({
                type: "lobby-details",
                details: {
                    ...lobby.details,
                    ...details,
                }
            });
            const timeoutHandle = createTimeout<LobbyDetails>(timeoutMs, "The server has not answered");
            onLobbyDetails.push(timeoutHandle.resolve);
            return timeoutHandle.result;
        },
        close: () => channel.close(),
    };

    channel.onReceive = async received => {
        // Ignore invalid messages
        if ("error" in received) return;

        const message = received.data;
        if (message.type == "join-request") {
            if (server.createRTCAnswer) {
                const answer = await server.createRTCAnswer(message.offer);
                if (typeof answer == "string") {
                    channel.send({ type: "join-invitation", answer, id: message.id });
                }
            }
        } else if (message.type == "lobby-details") {
            lobby.details = message.details;
            for (const callback of onLobbyDetails) {
                callback(server.lobbyDetails);
            }
            onLobbyDetails = [];
        }
    };

    channel.onClose = () => {
        server.onClose?.();
    };

    return server;
}

export async function connectClient(
    serverURL: string,
    offer: RTCOffer,
    timeoutMs: number,
    lobbyName?: string,
): Promise<RTCAnswer | InternalError | LobbyNotFound> {

    const joinRequest = stringify<MsgSchema>({
        type: "join-request",
        lobbyName,
        offer,
    });

    if (typeof joinRequest != "string") return joinRequest;

    const server = createTimeout<Response | ConnectionError>(
        timeoutMs, `The server '${serverURL}' has not responded`
    );

    try {
        const controller = new AbortController();
        server.result.then(error => {
            if ("error" in error && error.errorType == "timeout") controller.abort()
        });

        server.resolve(await fetch(serverURL, {
            method: "POST",
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: joinRequest,
            signal: controller.signal,
        }));
    } catch (error) {
        server.resolve({
            error: String(error),
            errorType: "connection",
        });
    }

    const response = await server.result;
    if ("error" in response) return response;

    let text_response: string;
    try { text_response = await response.text() }
    catch (e) {
        return {
            error: "The server returned an invalid data type",
            errorType: "invalidData",
        }
    }

    const message = parse<MsgSchema>(text_response)
    if ("error" in message) return {
        error: `The server returned data that can't be deserialized (data: '${text_response}')`,
        errorType: "deserialize",
    }

    if (message.data.type == "join-invitation") return message.data.answer;
    if (message.data.type == "error" && message.data.errorType == "lobbyNotFound") {
        let error: string;
        if (!lobbyName) error = `There is no lobby with name '${lobbyName}'`;
        else error = "There wasn't any public lobby to join";
        return { error, errorType: "lobbyNotFound" };
    }

    return {
        error: `The server returned unexpected data (Data received: ${JSON.stringify(message.data)})`,
        errorType: "invalidData",
    }
}

