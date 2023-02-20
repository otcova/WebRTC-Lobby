
export interface TimeoutError {
	error: string;
	errorType: "timeout";
}

export interface InvalidData {
	error: string;
	errorType: "invalid-data";
}

export interface FetchError {
	error: string;
	errorType: "fetch";
}

export interface SerializeError {
	error: string;
	errorType: "serialize";
}

export interface DeserializeError {
	error: string;
	errorType: "deserialize";
}

export interface ConnectionError {
	error: string;
	errorType: "connection";
}

export function displayAny(data: any): string {
	const strData = String(data);
	if (strData.length < 32) return strData;
	return `[type: ${typeof data}]`;
}

export interface TimeoutHandle<T> {
	resolve(data: T | Promise<T | TimeoutError>): void;
	result: Promise<T | TimeoutError>;
}

export function createTimeout<T>(milliseconds: number, errorMessage: string): TimeoutHandle<T> {
	let resolve!: (data: T | TimeoutError | Promise<T | TimeoutError>) => void;
	let result = new Promise<T | TimeoutError>(r => resolve = r);
	setTimeout(() => resolve({
		error: `${errorMessage} (time given: ${milliseconds}ms)`,
		errorType: "timeout",
	}), milliseconds);
	return { resolve, result };
}

export type AnyError = TimeoutError | InvalidData | FetchError | SerializeError | DeserializeError | ConnectionError;