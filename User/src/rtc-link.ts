import { InvalidData, SerializeError, TimeoutError, createTimeout } from "./error.js";
import { serialize, deserialize, stringify, parse } from "./serializer.js";

/*

// Example of the api:

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

export type RTCOffer = string;
export type RTCAnswer = string;

export interface RTCLink {
    connection: RTCPeerConnection,
    channel: RTCDataChannel,
    send(message: any): Promise<SerializeError | undefined>;
    onMessage?: (message: any) => void;
    onDisconnect?: () => void;
    disconnect(): void;
}

export interface RTCLinkRequest {
    createLink(offer: RTCAnswer, timeoutMs: number): Promise<RTCLink | TimeoutError | InvalidData>,
    offer: RTCOffer,
    close(): void;
}

export interface RTCLinkResponse {
    linkPromise: Promise<RTCLink | TimeoutError>,
    answer: RTCAnswer,
    close(): void;
}

interface RTCLinkDescription {
    description: RTCSessionDescriptionInit,
    candidate: RTCIceCandidateInit,
    // A random string to check if the answer is from the correct offer.
    id: string,
}

export async function createLinkRequest(): Promise<RTCLinkRequest | SerializeError> {
    const connection = new RTCPeerConnection();
    const channel = connection.createDataChannel('sendDataChannel');

    const description = await connection.createOffer();
    connection.setLocalDescription(description);

    const offerId = Math.trunc(Math.random() * 36 ** 8).toString(36);
    const offer = stringify<RTCLinkDescription>({
        description,
        candidate: await new Promise(resolve => {
            connection.onicecandidate = e => resolve(e.candidate as RTCIceCandidate);
        }),
        id: offerId,
    });

    if (typeof offer != "string") {
        offer.error = "Can't serialize the rtc offer";
        return offer;
    }

    return {
        offer,
        close: () => {
            connection.close();
        },
        async createLink(answer: RTCAnswer, timeoutMs: number) {
            const linkDescription = parse<RTCLinkDescription>(answer);
            if ("error" in linkDescription || typeof linkDescription.data.id != "string") {
                return {
                    error: "Invalid RTCAnswer",
                    errorType: "invalidData",
                };
            }
            if (offerId != linkDescription.data.id) return {
                error: "The RTCAnswer is from another offer " +
                    `(expected id: "${offerId}" received id: "${linkDescription.data.id}`,
                errorType: "invalidData",
            };

            try {
                connection.setRemoteDescription(linkDescription.data.description);
                connection.addIceCandidate(linkDescription.data.candidate);
            } catch (error) {
                return {
                    error: `Invalid RTCAnswer (${error})`,
                    errorType: "invalidData",
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

    const linkDescription = parse<RTCLinkDescription>(offer);
    if ("error" in linkDescription) return {
        error: "Invalid RTCOffer",
        errorType: "invalidData",
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
            errorType: "invalidData",
        };
    }

    const linkPromise = createTimeout<RTCLink>(
        timeoutMs, `The peer has not connected within ${timeoutMs}ms`
    );
    linkPromise.onTimeout = () => connection.close();

    connection.ondatachannel = ({ channel }) => linkPromise.resolve(createRTCLink(connection, channel));

    const answer = stringify<RTCLinkDescription>({
        description,
        candidate: await new Promise(resolve => {
            connection.onicecandidate = e => resolve(e.candidate as RTCIceCandidate);
        }),
        id: linkDescription.data.id,
    });

    if (typeof answer != "string") return answer;

    return { linkPromise: linkPromise.result, answer, close: () => connection.close() };
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
        disconnect: () => connection.close(),
    };

    channel.onmessage = async ({ data }) => {
        const message = await deserialize(data);
        // Ignore invalid messages
        if ("error" in message) return;

        link.onMessage?.(message.data);
    }

    let closed = false;

    channel.onclose = () => {
        if (!closed) link.onDisconnect?.();
        closed = true;
        connection.close();
    }

    connection.oniceconnectionstatechange = () => {
        if (connection.iceConnectionState == "disconnected") {
            if (!closed) link.onDisconnect?.();
            closed = true;
            connection.close();
        }
    };

    return link;
}
