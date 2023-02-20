import { LobbyCreationOptions, LobbyDetails } from "./index.js";
import { AnyError, createTimeout, DeserializeError, displayAny, FetchError, InvalidData, SerializeError, TimeoutError } from "./error.js";
import { RTCAnswer, RTCOffer } from "./rtc-link.js";
import { deserialize, DeserializeResult, parse, serialize, stringify } from "./serializer.js";

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
	} |
	{
		type: "join-invitation",
		answer: RTCAnswer,
	} |
	{
		type: "lobby-details",
		details: LobbyDetails,
	};


interface ServerChannel {
	send(message: MsgSchema): Promise<SerializeError | undefined>;
	close(): void;
	set onReceive(callback: ((message: DeserializeResult<MsgSchema>) => void));
	set onClose(callback: () => void);
}

function createWebSocket(url: string | URL, timeoutMs: number): Promise<ServerChannel | AnyError> {
	const ws = new WebSocket(url);

	const server: ServerChannel = {
		close: () => ws.close(),
		async send(message) {
			const data = await serialize(message);
			if ("error" in data) return data;
			ws.send(data);
		},
		set onClose(callback: () => void) {
			ws.onclose = callback;
		},
		set onReceive(callback: (message: DeserializeResult<MsgSchema>) => void) {
			ws.onmessage = async ({ data }) => {
				if (data instanceof Uint8Array) {
					const message = await deserialize<MsgSchema>(data);
					if ("error" in message) message.error = "The server response can't be deserialized";
					callback(message);
				}
			}
		},
	};

	return new Promise(resolve => {
		ws.onopen = () => resolve(server);

		setTimeout(() => {
			resolve({
				error: `Coudn't connect with the server with ${timeoutMs}ms`,
				errorType: "timeout",
			});
			ws.close();
		}, timeoutMs);
	});
}

export interface UpdateLobbyDetails {
	lobbyName?: string,
	publicLobby?: boolean;
	maxClients?: number;
	clientCount?: number;
};

interface ServerHost {
	lobbyDetails: LobbyDetails;
	createRTCAnswer?: (offer: RTCOffer) => Promise<RTCAnswer | AnyError>,
	/** If the timeout expires the update could happend later anyway */
	updateLobbyDetails(details: UpdateLobbyDetails, timeoutMs: number): Promise<LobbyDetails | TimeoutError>;
	close(): void;
	onClose?: () => void;
}

export async function createServerHostConnection(
	serverURL: string,
	lobbyOpts: LobbyCreationOptions,
	timeoutMs: number,
): Promise<ServerHost | AnyError> {
	const channel = await createWebSocket(serverURL, timeoutMs);
	if ("error" in channel) return channel;

	if (!lobbyOpts.maxClients || lobbyOpts.maxClients > 500) lobbyOpts.maxClients = 500;

	const serializeError = await channel.send({
		type: "create-lobby",
		...lobbyOpts,
	});
	if (serializeError) return {
		error: `lobby creation option are invalid ${displayAny(lobbyOpts)}`,
		errorType: "invalid-data",
	};

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
	if ("error" in lobby) return lobby;

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
				if (typeof answer == "string") channel.send({ type: "join-invitation", answer });
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
	lobbyName?: string,
	timeoutMs?: number,
): Promise<RTCAnswer | AnyError> {

	const joinRequest = stringify<MsgSchema>({
		type: "join-request",
		lobbyName,
		offer,
	});

	if (typeof joinRequest != "string") return joinRequest;

	const response = await new Promise<Response | TimeoutError | FetchError>(async resolve => {
		setTimeout(() => resolve({
			error: `The server '${serverURL}' has not responded within ${timeoutMs}ms`,
			errorType: "timeout",
		}), timeoutMs);

		try {
			resolve(await fetch(serverURL, {
				method: "GET",
				body: joinRequest,
			}));
		} catch (error) {
			resolve({
				error: String(error),
				errorType: "fetch",
			});
		}
	});
	if ("error" in response) return response;


	const message = parse<MsgSchema>(await response.text())
	if ("error" in message) return {
		error: "The server returned data that can't be deserialized (The data was not serialized correctly or has been corrupted)",
		errorType: "deserialize",
	}

	if (message.data.type == "join-invitation") return message.data.answer;

	return {
		error: `The server returned unexpected data (Data received: ${JSON.stringify(message.data)})`,
		errorType: "invalid-data",
	}
}