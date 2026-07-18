import { fstatSync } from "node:fs";

/**
 * Reads all data from stdin if the process is being piped into.
 * Used by `mcpx call` for: cat data.json | mcpx call my-server process_data
 *
 * Returns null when stdin is a TTY (interactive) or when it is an inherited
 * non-TTY fd with no pipe attached (e.g. `bun run`, CI scripts).
 */
export async function readStdin(): Promise<unknown | null> {
  if (process.stdin.isTTY) return null;

  // In non-TTY contexts (bun run, CI), stdin may be an inherited fd with
  // no actual pipe. fstatSync(0).isFIFO() detects a real pipe.
  try {
    const stat = fstatSync(0);
    if (!stat.isFIFO() && !stat.isFile()) return null;
  } catch {
    return null;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      "Piped stdin is not valid JSON. mcpx call expects a JSON object from stdin."
    );
  }
}
