import { EventEmitter } from "node:events";

/**
 * Emits one "entry" per logged tool call. `logEntry()` publishes; Traffic's SSE
 * route subscribes.
 *
 * The default listener cap is 10, which a handful of open browser tabs would
 * trip -- each connected tab holds one listener for the life of its stream.
 * Raised deliberately; the SSE route must still remove its listener on
 * disconnect, or a long-lived proxy accumulates them.
 */
export const logBus = new EventEmitter();
logBus.setMaxListeners(64);
