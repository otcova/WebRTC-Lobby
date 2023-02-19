//!file if target == Browser

import pako from "pako";

export function deflateRaw(data: string, opts?: pako.InflateFunctionOptions) {
	try {
		return pako.deflateRaw(data, opts);
	}
	catch (error) {
		return null;
	}
}

export function inflateRaw(data: Uint8Array | ArrayBuffer, opts?: pako.InflateFunctionOptions) {
	try {
		return { data: pako.inflateRaw(data, { ...opts, to: "string" }) };
	}
	catch (error) {
		return null;
	}
}

