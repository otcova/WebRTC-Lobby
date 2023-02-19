/*! if target == NodeJs
import wrtc from "wrtc"; 
globalThis.RTCPeerConnection =  wrtc.RTCPeerConnection;
*/

import { AnyError, FetchError, InvalidData, TimeoutError } from "./error.js";
import { createLinkResponse, createLinkRequest, RTCOffer, RTCLink } from "./rtc-link.js";
import { connectClient, createServerHostConnection } from "./signaling.js";

export type ClientId = number;

export interface ClientConnection extends RTCLink {
	readonly id: ClientId;
}

export interface LobbyDetails {
	lobbyName: string,
	publicLobby: boolean;
	maxClients: number;
	clientCount: number;
}

export interface LobbyCreationOptions {
	lobbyName?: string,
	publicLobby: boolean;
	maxClients?: number;
}

export interface LobbyHost extends Readonly<LobbyDetails> {
	onClientConnect?: (client: ClientConnection) => void;
	onClientDisconnect?: (client: ClientConnection) => void;
	getClient(id: ClientId): ClientConnection | undefined;
	
	/** 
	 * If lobby closes, no more clients will be able to join.
	 * However, the current rtc-links with the clients will remain.
	 * 
	 * It could happend if the signaling server closes.
	*/
	onClose?: () => void;
}

const defauleLobbyOptions: LobbyCreationOptions = { publicLobby: true };

export async function createLobby(
	serverURL: string,
	lobbyDetails = defauleLobbyOptions,
	timeoutMs: number = 5000,
): Promise<LobbyHost | AnyError> {
	const clients = new Map<ClientId, ClientConnection>();
	let lastClientId: ClientId = 0;
	const createClientId = (): ClientId => lastClientId++;

	const server = await createServerHostConnection(serverURL, lobbyDetails, timeoutMs);
	if ("error" in server) return server;

	const lobby: LobbyHost = {
		...server.lobbyDetails,
		getClient: (id: ClientId) => clients.get(id),
	};

	const createClient = (link: RTCLink) => {
		const clientId = createClientId();
		Object.defineProperty(link, "id", clientId);
		const client = link as ClientConnection;
		
		clients.set(clientId, client);
		lobby.onClientConnect?.(client);
		
		link.channel.onclose = () => {
			lobby.onClientDisconnect?.(client);
			clients.delete(clientId);
		};
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

/** If lobbyName is undefined, the server will choose a ranom public lobby */
export async function joinLobby(
	serverURL: string,
	lobbyName?: string,
	timeoutMs: number = 5000,
): Promise<LobbyClient | AnyError> {
	const startMs = performance.now();
		
	const linkRequest = await createLinkRequest();
	if ("error" in linkRequest) return linkRequest;

	const serverTimoutMs = timeoutMs + startMs - performance.now();
	const answer = await connectClient(serverURL, linkRequest.offer, lobbyName, serverTimoutMs);
	if ("error" in answer) return answer;

	const linkTimoutMs = timeoutMs + startMs - performance.now();
	const link = await linkRequest.createLink(answer, linkTimoutMs);
	if ("error" in link) return link;

	return link;
}
