/*! if target == NodeJs
import wrtc from "wrtc"; 
globalThis.RTCPeerConnection =  wrtc.RTCPeerConnection;
*/

import { InternalError, LobbyNotFound } from "./error.js";
import { createLinkResponse, createLinkRequest, RTCOffer, RTCLink } from "./rtc-link.js";
import { connectClient, createServerHostConnection } from "./signaling.js";


export type ClientId = number;

export interface ClientConnection extends RTCLink {
    readonly id: ClientId;
}

export interface LobbyDetails {
    lobbyName: string;
    publicLobby: boolean;
    maxClients: number;
    clientCount: number;
}

export interface LobbyCreationOptions {
    lobbyName?: string;
    publicLobby?: boolean;
    maxClients?: number;
}

export interface LobbyHost extends Readonly<LobbyDetails> {
    onClientConnect?: (client: ClientConnection) => void;

    /** 
     * If lobby closes, no more clients will be able to join.
     * However, the current rtc-links with the clients will remain.
     * 
     * It could happend if the signaling server closes.
    */
    onClose?: () => void;

    // It will close the connection with the signaling server
    // The client links will remain active
    close(): void;
}

export async function createLobby(
    serverURL: string,
    lobbyDetails: LobbyCreationOptions = {},
    timeoutMs: number = 5000,
): Promise<LobbyHost | InternalError> {
    let lastClientId: ClientId = 0;
    const createClientId = (): ClientId => lastClientId++;

    const server = await createServerHostConnection(serverURL, lobbyDetails, timeoutMs);
    if ("error" in server) return server;

    const lobby: LobbyHost = {
        ...server.lobbyDetails,
        close: () => server.close(),
    };

    const createClient = (link: RTCLink) => {
        Object.defineProperty(link, "id", { value: createClientId() });
        const client = link as ClientConnection;
        if (lobby.onClientConnect) lobby.onClientConnect(client);
        else client.disconnect();
    };

    server.createRTCAnswer = async (offer: RTCOffer) => {
        const linkResponse = await createLinkResponse(offer, 5000);
        if ("error" in linkResponse) return linkResponse;
        linkResponse.linkPromise.then(link => {
            if (!("error" in link)) createClient(link);
        });
        return linkResponse.answer;
    };

    server.onClose = () => {
        lobby.onClose?.();
    };

    return lobby;
}

export interface LobbyClient extends RTCLink { }

/** If lobbyName is undefined, the server will choose a random public lobby */
export async function joinLobby(
    serverURL: string,
    lobbyName?: string,
    timeoutMs: number = 5000,
): Promise<LobbyClient | InternalError | LobbyNotFound> {
    const linkRequest = await createLinkRequest();
    if ("error" in linkRequest) return linkRequest;

    const answer = await connectClient(serverURL, linkRequest.offer, timeoutMs, lobbyName);
    if (typeof answer != "string") {
        linkRequest.close();
        return answer;
    }

    const link = await linkRequest.createLink(answer, timeoutMs);
    if ("error" in link) return link;

    return link;
}

