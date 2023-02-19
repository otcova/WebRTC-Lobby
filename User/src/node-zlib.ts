//!file if target == NodeJs

import * as zlib from "zlib";

export function deflateRaw(text: string, options?: zlib.ZlibOptions) {
	return new Promise<Uint8Array | null>(resolve => {

		zlib.deflateRaw(text, options ?? {}, (error, buffer) => {
			if (error) resolve(null);
			else resolve(buffer);
		});

	});
}

export function inflateRaw(data: Uint8Array | ArrayBuffer, options?: zlib.ZlibOptions) {
	return new Promise<{ data: string } | null>(resolve => {

		zlib.inflateRaw(data, options ?? {}, (error, buffer) => {
			if (error) resolve(null);
			else resolve({ data: buffer.toString() });
		});

	});
}