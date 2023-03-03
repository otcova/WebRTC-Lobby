
const style = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
};

export function assert(shoudBeTrue, message) {
    if (!shoudBeTrue || (typeof shoudBeTrue == "object" && "error" in shoudBeTrue)) {
        error(message, shoudBeTrue);
        return false;
    } else {
        success(message);
        return true;
    }
}

export async function shouldResolve(promise, message) {
    let timeoutId = setTimeout(() => {
        timeoutId = null;
        error(message, "timeout exceeded")
    }, 3000);
    await promise;
    if (timeoutId !== null) {
        clearTimeout(timeoutId);
        success(message);
    }
}

export function success(message) {
    console.log(style.green + "[SUCCESS] " + style.reset, message);
}

export function error(message, errorDetails) {
    console.error(style.red + "[ERROR] " + style.reset, message);
    if (errorDetails) console.error(errorDetails, "\n");
    process.exitCode = 1;
}
