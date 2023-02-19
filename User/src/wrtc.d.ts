//!file if target == NodeJs

declare module 'wrtc' {
	export = {
		RTCPeerConnection: globalThis.RTCPeerConnection
	}
}