
export interface TimeoutError {
    error: string;
    errorType: "timeout";
}

export interface InvalidData {
    error: string;
    errorType: "invalidData";
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

export interface LobbyNotFound {
    error: string;
    errorType: "lobbyNotFound";
}

export interface LobbyAlreadyExists {
    error: string;
    errorType: "lobbyAlreadyExists";
}

export function displayAny(data: any): string {
    const strData = String(data);
    if (strData.length < 32) return strData;
    return `[type: ${typeof data}]`;
}

export interface TimeoutHandle<T> {
    resolve(data: T | Promise<T | TimeoutError>): void;
    result: Promise<T | TimeoutError>;
    onTimeout?: () => void;
}

export function createTimeout<T>(milliseconds: number, errorMessage: string): TimeoutHandle<T> {
    let resolve!: (data: T | TimeoutError | Promise<T | TimeoutError>) => void;
    let result = new Promise<T | TimeoutError>(r => resolve = r);

    let timeout: TimeoutHandle<T> = { resolve, result };

    let timeoutId = setTimeout(() => {
        let error: TimeoutError = {
            error: `${errorMessage} (time given: ${milliseconds}ms)`,
            errorType: "timeout",
        };
        resolve(error);

        timeout.onTimeout?.();
    }, milliseconds);
    result.then(() => clearTimeout(timeoutId));

    return timeout;
}

export type InternalError = TimeoutError | InvalidData | ConnectionError | SerializeError | DeserializeError | ConnectionError;

