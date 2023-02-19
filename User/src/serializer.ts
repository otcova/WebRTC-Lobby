import { DeserializeError, displayAny, SerializeError } from "./error.js";

//! if target == Browser
// import { inflateRaw, deflateRaw } from "./browser-zlib.js";

//! if target == NodeJs
import { inflateRaw, deflateRaw } from "./node-zlib.js";

export interface SerializeOptions {
	zlib?: {
		level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
		windowBits?: number;
		chunkSize?: number;
		dictionary?: ArrayBuffer | Uint8Array;
	},
}

export interface DeserializeOptions {
	zlib?: {
		windowBits?: number;
		chunkSize?: number;
		dictionary?: ArrayBuffer | Uint8Array;
	},
}

export async function serialize<T>(
	data: T,
	options?: SerializeOptions,
): Promise<Uint8Array | SerializeError> {
	if (data === undefined) return new Uint8Array(0);
	const compressed = await deflateRaw(JSON.stringify(data), options?.zlib);
	if (compressed) return compressed;
	return {
		error: `Could not serialize data ${displayAny(data)}`,
		errorType: "serialize",
	};
}

export type DeserializeResult<T> = { data: T } | DeserializeError;

export async function deserialize<T>(
	data: Uint8Array | ArrayBuffer,
	options?: DeserializeOptions
): Promise<DeserializeResult<T>> {
	if (data.byteLength == 0) return { data: undefined as T };

	const jsonData = await inflateRaw(data, options?.zlib);
	if (jsonData) return { data: JSON.parse(jsonData.data) };
	return {
		error: `Could not deserialize data '${displayAny(data)}'`,
		errorType: "deserialize",
	};
}
