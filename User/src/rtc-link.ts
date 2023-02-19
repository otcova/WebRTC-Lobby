import { InvalidData, SerializeError, TimeoutError, createTimeout } from "./error.js";
import { serialize, deserialize, SerializeOptions } from "./serializer.js";
//! if target == NodeJs
import { TextEncoder } from "util";

/*

Example of the api:

const timeoutMs = 1000;

const linkRequest = await createLinkRequest();
if ("error" in linkRequest) throw new Error("Unable to create rtc-link request because: " + linkRequest.error);

const linkResponse = await createLinkResponse(linkRequest.offer, timeoutMs);
if ("error" in linkResponse) throw new Error("Unable to create rtc-link response because: " + linkResponse.error);

const linkA = await linkRequest.createLink(linkResponse.answer, timeoutMs);
const linkB = await linkResponse.linkPromise;

if ("error" in linkA) throw new Error("Unable to create rtc-link because: " + linkA.error);
if ("error" in linkB) throw new Error("Unable to create rtc-link because: " + linkB.error);

linkA.onMessage = message => linkA.send(message);
linkB.onMessage = message => console.log(message);
linkB.send(":)");

*/

export type RTCOffer = Uint8Array;
export type RTCAnswer = Uint8Array;

export interface RTCLink {
	connection: RTCPeerConnection,
	channel: RTCDataChannel,
	send(message: any): Promise<SerializeError | undefined>;
	onMessage?: (message: any) => void;
	onClose?: () => void;
}

export interface RTCLinkRequest {
	createLink: (offer: RTCAnswer, timeoutMs: number) => Promise<RTCLink | TimeoutError | InvalidData>,
	offer: RTCOffer,
}

export interface RTCLinkResponse {
	linkPromise: Promise<RTCLink | TimeoutError>,
	answer: RTCAnswer,
}

interface RTCLinkDescription {
	description: RTCSessionDescriptionInit,
	candidate: RTCIceCandidateInit,
}




const utf8Encoder = new TextEncoder();

// Used as a `deflate dictionary` to improve compresion ratio
const offerSample = utf8Encoder.encode('{"description":{"type":"offer","sdp":"v=0\\r\\no=- 165238137562437251 2 IN IP4 127.0.0.1\\r\\ns=-\\r\\nt=0 0\\r\\na=group:BUNDLE 0\\r\\na=extmap-allow-mixed\\r\\na=msid-semantic: WMS\\r\\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\\r\\nc=IN IP4 0.0.0.0\\r\\na=ice-ufrag:IlWn\\r\\na=ice-pwd:mO8yZnEpFKzz58pOoLcjWQBn\\r\\na=ice-options:trickle\\r\\na=fingerprint:sha-256 D2:5E:B3:71:E4:7F:F2:92:A9:51:03:8D:C8:A2:B9:57:0C:6F:24:7D:32:4F:9D:B4:F2:20:14:81:9B:D2:C1:AA\\r\\na=setup:actpass\\r\\na=mid:0\\r\\na=sctp-port:5000\\r\\na=max-message-size:262144\\r\\n"},"candidate":{"candidate":"candidate:2954522821 1 udp 2113937151 f2e9162a-145b-493a-bb88-0795950fe914.local 64528 typ host generation 0 ufrag IlWn network-cost 999","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":"IlWn"}}');
const answerSample = utf8Encoder.encode('{"description":{"type":"answer","sdp":"v=0\\r\\no=- 6441857709426132615 2 IN IP4 127.0.0.1\\r\\ns=-\\r\\nt=0 0\\r\\na=group:BUNDLE 0\\r\\na=extmap-allow-mixed\\r\\na=msid-semantic: WMS\\r\\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\\r\\nc=IN IP4 0.0.0.0\\r\\na=ice-ufrag:sT5k\\r\\na=ice-pwd:PCHo/yGmN/pvYWRz7n2RU4CX\\r\\na=ice-options:trickle\\r\\na=fingerprint:sha-256 79:78:8D:6E:AF:27:82:28:BC:D8:AF:19:35:74:E6:D6:6B:33:B4:3A:65:1B:40:40:41:DE:A5:81:41:C8:64:A4\\r\\na=setup:active\\r\\na=mid:0\\r\\na=sctp-port:5000\\r\\na=max-message-size:262144\\r\\n"},"candidate":{"candidate":"candidate:1170801133 1 udp 2113937151 8d05092d-f32f-4f70-9e60-64bdf433111a.local 65389 typ host generation 0 ufrag sT5k network-cost 999","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":"sT5k"}}}');

const zlibOfferOptions: SerializeOptions = { zlib: { level: 1, dictionary: offerSample } };
const zlibAnswerOptions: SerializeOptions = { zlib: { level: 1, dictionary: answerSample } };


export async function createLinkRequest(): Promise<RTCLinkRequest | SerializeError> {
	const connection = new RTCPeerConnection();
	const channel = connection.createDataChannel('sendDataChannel');

	const description = await connection.createOffer();
	connection.setLocalDescription(description);

	const offer = await serialize<RTCLinkDescription>({
		description,
		candidate: await new Promise(resolve => {
			connection.onicecandidate = e => resolve(e.candidate as RTCIceCandidate);
		})
	}, zlibOfferOptions);

	if ("error" in offer) {
		offer.error = "Can't serialize the rtc offer"
		return offer;
	}

	return {
		offer,
		async createLink(answer: RTCAnswer, timeoutMs: number) {
			const linkDescription = await deserialize<RTCLinkDescription>(answer, zlibAnswerOptions);
			if ("error" in linkDescription) return {
				error: "Invalid RTCAnswer",
				errorType: "invalid-data",
			};

			try {
				connection.setRemoteDescription(linkDescription.data.description);
				connection.addIceCandidate(linkDescription.data.candidate);
			} catch (error) {
				return {
					error: `Invalid RTCAnswer (${error})`,
					errorType: "invalid-data",
				};
			}

			const timeout = createTimeout<RTCLink>(timeoutMs, "The peer has not connected");
			channel.onopen = () => timeout.resolve(createRTCLink(connection, channel));

			const link = await timeout.result;
			if ("error" in link) channel.close();
			return link;
		},
	}
}

export async function createLinkResponse(offer: RTCOffer, timeoutMs: number)
	: Promise<RTCLinkResponse | InvalidData | SerializeError> {

	const linkDescription = await deserialize<RTCLinkDescription>(offer, zlibOfferOptions);
	if ("error" in linkDescription) return {
		error: "Invalid RTCOffer",
		errorType: "invalid-data",
	};


	const connection = new RTCPeerConnection();
	let description;
	
	try {
		connection.setRemoteDescription(linkDescription.data.description);
		description = await connection.createAnswer();
		connection.setLocalDescription(description);
		connection.addIceCandidate(linkDescription.data.candidate);
	} catch (error) {
		return {
			error: `Invalid RTCOffer (${error})`,
			errorType: "invalid-data",
		};
	}

	const linkPromise = new Promise<RTCLink | TimeoutError>(resolve => {
		connection.ondatachannel = ({ channel }) => resolve(createRTCLink(connection, channel));
		setTimeout(() => {
			resolve({
				errorType: "timeout",
				error: `The peer has not connected within ${timeoutMs}ms`,
			});
			connection.close();
		}, timeoutMs);
	});

	const answer = await serialize<RTCLinkDescription>({
		description,
		candidate: await new Promise(resolve => {
			connection.onicecandidate = e => resolve(e.candidate as RTCIceCandidate);
		})
	}, zlibAnswerOptions);
	
	if ("error" in answer) return answer;

	return { linkPromise, answer };
}

function createRTCLink(connection: RTCPeerConnection, channel: RTCDataChannel): RTCLink {
	const link: RTCLink = {
		connection,
		channel,
		send: async message => {
			const data = await serialize(message);
			if ("error" in data) return data;
			channel.send(data);
		},
	};

	channel.onmessage = async ({ data }) => {
		const message = await deserialize(data);
		// Ignore invalid messages
		if ("error" in message) return;
		
		link.onMessage?.(message.data);
	}

	channel.onclose = () => link.onClose?.();

	return link;
}