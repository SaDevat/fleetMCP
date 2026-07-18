function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function schemaType(schema: Record<string, unknown>): string {
  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    const first = enumValues[0];
    if (typeof first === "string") return `"${first}"`;
    if (typeof first === "number" || typeof first === "boolean") return String(first);
    return "enum";
  }

  const directType = schema["type"];
  if (typeof directType === "string") return directType;

  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf) && oneOf.length > 0) {
    const labels = oneOf
      .map((entry) => (isRecord(entry) ? schemaType(entry) : "unknown"))
      .slice(0, 3);
    return labels.join(" | ");
  }

  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const labels = anyOf
      .map((entry) => (isRecord(entry) ? schemaType(entry) : "unknown"))
      .slice(0, 3);
    return labels.join(" | ");
  }

  return "unknown";
}

export function summarizeSchema(inputSchema: unknown): string {
  if (!isRecord(inputSchema)) return "()";
  const properties = inputSchema["properties"];
  if (!isRecord(properties)) return "()";

  const requiredSet = new Set(asStringArray(inputSchema["required"]));
  const keys = Object.keys(properties);
  if (keys.length === 0) return "()";

  const sorted = keys.sort((a, b) => {
    const aReq = requiredSet.has(a);
    const bReq = requiredSet.has(b);
    if (aReq && !bReq) return -1;
    if (!aReq && bReq) return 1;
    return a.localeCompare(b);
  });

  const parts = sorted.map((key) => {
    const propSchema = properties[key];
    const label = isRecord(propSchema) ? schemaType(propSchema) : "unknown";
    const item = `${key}: ${label}`;
    return requiredSet.has(key) ? item : `[${item}]`;
  });

  return `(${parts.join(", ")})`;
}

function exampleValue(schema: unknown): string {
  if (!isRecord(schema)) return "value";

  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    const first = enumValues[0];
    if (typeof first === "string") return first;
    if (typeof first === "number" || typeof first === "boolean") return String(first);
  }

  const t = schema["type"];
  if (t === "boolean") return "true";
  if (t === "number" || t === "integer") return "42";
  if (t === "array") return "[]";
  if (t === "object") return "{}";
  if (t === "string") return "example";

  return "value";
}

export function buildUsageExample(
  target: string,
  toolName: string,
  inputSchema: unknown,
): string {
  if (!isRecord(inputSchema)) return `mcpx call ${target} ${toolName}`;

  const properties = inputSchema["properties"];
  const required = asStringArray(inputSchema["required"]);
  if (!isRecord(properties) || required.length === 0) {
    return `mcpx call ${target} ${toolName}`;
  }

  const args = required.map((key) => `${key}=${exampleValue(properties[key])}`);
  return `mcpx call ${target} ${toolName} ${args.join(" ")}`;
}
