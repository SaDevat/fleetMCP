import chalk from "chalk";

/**
 * Pretty-prints a JSON value with syntax highlighting via chalk.
 * Used by `inspect` (tool schemas) and `call` (tool results).
 */
export function prettyJson(value: unknown): string {
  const raw = JSON.stringify(value, null, 2);
  return raw.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return chalk.cyan(match); // key
        return chalk.green(match); // string value
      }
      if (/true|false/.test(match)) return chalk.yellow(match);
      if (/null/.test(match)) return chalk.dim(match);
      return chalk.magenta(match); // number
    }
  );
}
