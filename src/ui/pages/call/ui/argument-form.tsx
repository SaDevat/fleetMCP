import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/ui/components/ui/form.tsx";
import { Input } from "@/ui/components/ui/input.tsx";
import { Checkbox } from "@/ui/components/ui/checkbox.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/components/ui/select.tsx";
import { Button } from "@/ui/components/ui/button.tsx";
import { useCallToolMutation, type CallToolEntry, type CallToolResponse } from "../api.ts";

// ---------------------------------------------------------------------------
// Schema -> form
//
// ESCALATION (see issue #29): only the flat cases below get a real input.
// Anything with nested objects, oneOf/anyOf/allOf, $ref, or a recursive shape
// falls back to a raw-JSON textarea for that one field (or for the whole
// argument list, if the top-level schema itself isn't a flat {properties}
// object). ponytail: no nested field generation, no $ref resolution -- a
// narrow, correct solution over a broad, half-right one. Escalate if a real
// tool needs more.
// ---------------------------------------------------------------------------

type FieldKind = "string" | "number" | "boolean" | "enum" | "json";

interface FieldSpec {
  key: string;
  required: boolean;
  kind: FieldKind;
  enumValues: unknown[] | undefined;
  description: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isComplexSchema(schema: Record<string, unknown>): boolean {
  return "$ref" in schema || "oneOf" in schema || "anyOf" in schema || "allOf" in schema;
}

function fieldKindOf(propSchema: unknown): { kind: FieldKind; enumValues?: unknown[] } {
  if (!isRecord(propSchema) || isComplexSchema(propSchema)) return { kind: "json" };
  const enumValues = propSchema["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) return { kind: "enum", enumValues };
  const t = propSchema["type"];
  if (t === "integer" || t === "number") return { kind: "number" };
  if (t === "boolean") return { kind: "boolean" };
  if (t === "string") return { kind: "string" };
  // array/object/missing-type/union-type -- ceiling, see module comment.
  return { kind: "json" };
}

/** `wholeRaw: true` means the top-level schema itself isn't a flat object we
 * can walk -- the whole argument list becomes one raw-JSON textarea. */
function buildFieldSpecs(inputSchema: unknown): { fields: FieldSpec[]; wholeRaw: boolean } {
  if (!isRecord(inputSchema) || isComplexSchema(inputSchema)) return { fields: [], wholeRaw: true };

  const properties = inputSchema["properties"];
  if (!isRecord(properties)) return { fields: [], wholeRaw: false };

  const required = new Set(Array.isArray(inputSchema["required"]) ? (inputSchema["required"] as unknown[]) : []);

  const fields = Object.keys(properties).map((key): FieldSpec => {
    const propSchema = properties[key];
    const { kind, enumValues } = fieldKindOf(propSchema);
    return {
      key,
      required: required.has(key),
      kind,
      enumValues,
      description: isRecord(propSchema) && typeof propSchema["description"] === "string" ? propSchema["description"] : undefined,
    };
  });

  return { fields, wholeRaw: false };
}

const RAW_KEY = "__raw__";

function defaultValuesFor(fields: FieldSpec[], wholeRaw: boolean): Record<string, unknown> {
  if (wholeRaw) return { [RAW_KEY]: "{}" };
  const values: Record<string, unknown> = {};
  for (const f of fields) values[f.key] = f.kind === "boolean" ? false : "";
  return values;
}

function requiredFilled(fields: FieldSpec[], wholeRaw: boolean, values: Record<string, unknown>): boolean {
  if (wholeRaw) return String(values[RAW_KEY] ?? "").trim() !== "";
  return fields.filter((f) => f.required).every((f) => f.kind === "boolean" || String(values[f.key] ?? "").trim() !== "");
}

type BuildResult = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

/** Builds the real call arguments from form values, enforcing types. Used at
 * submit time -- previewArgsLine() below is a looser, display-only version. */
function buildArguments(fields: FieldSpec[], wholeRaw: boolean, values: Record<string, unknown>): BuildResult {
  if (wholeRaw) {
    const raw = String(values[RAW_KEY] ?? "").trim();
    try {
      const parsed: unknown = raw === "" ? {} : JSON.parse(raw);
      return isRecord(parsed) ? { ok: true, args: parsed } : { ok: false, error: "arguments must be a JSON object" };
    } catch {
      return { ok: false, error: "arguments must be valid JSON" };
    }
  }

  const args: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.key];

    if (f.kind === "boolean") {
      args[f.key] = Boolean(raw);
      continue;
    }

    const s = String(raw ?? "").trim();
    if (s === "") {
      if (f.required) return { ok: false, error: `"${f.key}" is required` };
      continue;
    }

    if (f.kind === "number") {
      const n = Number(s);
      if (!Number.isFinite(n)) return { ok: false, error: `"${f.key}" must be a number` };
      args[f.key] = n;
    } else if (f.kind === "json") {
      try {
        args[f.key] = JSON.parse(s);
      } catch {
        return { ok: false, error: `"${f.key}" must be valid JSON` };
      }
    } else {
      args[f.key] = s;
    }
  }
  return { ok: true, args };
}

/** Display-only: renders whatever is currently typed as `key=value`, without
 * enforcing correctness -- buildArguments() is the source of truth at submit. */
function previewArgsLine(fields: FieldSpec[], wholeRaw: boolean, values: Record<string, unknown>): string {
  if (wholeRaw) {
    const raw = String(values[RAW_KEY] ?? "").trim();
    return raw === "" || raw === "{}" ? "" : `'${raw}'`;
  }
  const parts: string[] = [];
  for (const f of fields) {
    if (f.kind === "boolean") {
      parts.push(`${f.key}=${values[f.key] ? "true" : "false"}`);
      continue;
    }
    const s = String(values[f.key] ?? "").trim();
    if (s !== "") parts.push(`${f.key}=${s}`);
  }
  return parts.join(" ");
}

function estimateTokens(payload: unknown): number {
  return Math.ceil(JSON.stringify(payload).length / 4);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard permission denied or unavailable -- the text is still
    // visible on the page, so there's nothing more useful to do here.
  }
}

// ---------------------------------------------------------------------------
// Result rendering
//
// Mirrors cli/call.ts's renderContent() branching (text/image/audio/resource/
// resource_link/structuredContent/legacy toolResult), reimplemented as React
// rather than imported: cli/call.ts pulls in core/client.ts's stdio
// transport, which requires Node's child_process via cross-spawn -- `bun
// build --target=browser src/cli/call.ts` fails outright on that import, so
// it cannot be reused from a UI bundle. See report for the verbatim error.
// ---------------------------------------------------------------------------

function ContentItem({ item }: { item: unknown }) {
  if (!isRecord(item)) return <pre>{JSON.stringify(item)}</pre>;

  switch (item["type"]) {
    case "text":
      return <pre>{String(item["text"] ?? "")}</pre>;
    case "image":
    case "audio": {
      const mime = String(item["mimeType"] ?? "unknown");
      const data = String(item["data"] ?? "");
      const bytes = Math.ceil((data.length * 3) / 4);
      return (
        <div className="mono call-meta">
          [{item["type"]}: {mime}, ~{bytes} bytes base64]
        </div>
      );
    }
    case "resource": {
      const resource = item["resource"];
      if (!isRecord(resource)) return null;
      return (
        <div>
          <div className="mono call-meta">{String(resource["uri"] ?? "")}</div>
          {typeof resource["text"] === "string" ? (
            <pre>{resource["text"]}</pre>
          ) : typeof resource["blob"] === "string" ? (
            <div className="mono call-meta">[binary resource: ~{Math.ceil((resource["blob"].length * 3) / 4)} bytes]</div>
          ) : null}
        </div>
      );
    }
    case "resource_link":
      return (
        <div className="mono call-meta">
          {String(item["uri"] ?? "")} {String(item["name"] ?? "")}
        </div>
      );
    default:
      return <pre>{JSON.stringify(item, null, 2)}</pre>;
  }
}

function ResultPane({ result, durationMs, tokens }: { result: CallToolResponse; durationMs: number; tokens: { req: number; res: number } }) {
  const obj = result as Record<string, unknown>;

  // Legacy compat shape, same as renderContent(): { toolResult } with no `content`.
  if ("toolResult" in obj && !("content" in obj)) {
    return (
      <div className="call-result">
        <pre>{JSON.stringify(obj["toolResult"], null, 2)}</pre>
      </div>
    );
  }

  if ("content" in obj) {
    const isError = obj["isError"] === true;
    const content = Array.isArray(obj["content"]) ? obj["content"] : [];
    return (
      <div className="call-result">
        <div className={isError ? "call-result-body mark-err" : "call-result-body"}>
          {content.length === 0 ? <pre>(empty content)</pre> : content.map((item, i) => <ContentItem key={i} item={item} />)}
        </div>
        {obj["structuredContent"] != null && (
          <div className="call-field">
            <div className="cap">structured content</div>
            <pre>{JSON.stringify(obj["structuredContent"], null, 2)}</pre>
          </div>
        )}
        <div className="drawer-meta mono">
          {durationMs}ms · {tokens.req} in / {isError ? "0" : tokens.res} out{isError ? " · isError true" : ""}
        </div>
      </div>
    );
  }

  if ("error" in obj) {
    return (
      <div className="call-result">
        <pre className="mark-err">{String(obj["error"])}</pre>
        <div className="drawer-meta mono">{durationMs}ms · {tokens.req} in / 0 out · transport failure</div>
      </div>
    );
  }

  return (
    <div className="call-result">
      <pre>{JSON.stringify(obj, null, 2)}</pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The form itself
// ---------------------------------------------------------------------------

interface ArgumentFormProps {
  alias: string;
  tool: CallToolEntry;
}

export function ArgumentForm({ alias, tool }: ArgumentFormProps) {
  const { fields, wholeRaw } = buildFieldSpecs(tool.inputSchema);
  const form = useForm<Record<string, unknown>>({ defaultValues: defaultValuesFor(fields, wholeRaw) });
  const values = form.watch();

  const [callTool, callState] = useCallToolMutation();
  const [callMeta, setCallMeta] = useState<{ durationMs: number; tokens: { req: number; res: number } } | null>(null);

  useEffect(() => {
    form.reset(defaultValuesFor(fields, wholeRaw));
    setCallMeta(null);
    // fields/wholeRaw are derived from `tool` every render; keying off the
    // tool identity (namespaced name) is what should actually reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.namespaced]);

  const canSubmit = requiredFilled(fields, wholeRaw, values) && !callState.isLoading;
  const argsLine = previewArgsLine(fields, wholeRaw, values);
  const cliLine = `fleetmcp call ${alias} ${tool.name}${argsLine ? ` ${argsLine}` : ""}`;

  const onSubmit = async () => {
    const built = buildArguments(fields, wholeRaw, values);
    if (!built.ok) {
      form.setError("root", { message: built.error });
      return;
    }
    const start = performance.now();
    try {
      const result = await callTool({ alias, tool: tool.name, arguments: built.args }).unwrap();
      setCallMeta({
        durationMs: Math.round(performance.now() - start),
        tokens: { req: estimateTokens(built.args), res: estimateTokens(result) },
      });
    } catch {
      // callState.error already carries the apiError envelope; nothing more to do.
      setCallMeta(null);
    }
  };

  return (
    <div>
      <Form {...form}>
        <form
          className="call-arg-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          {wholeRaw ? (
            <div className="call-field">
              <FormField
                control={form.control}
                name={RAW_KEY}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="cap">
                      arguments (raw JSON) <span className="mono call-ceiling">// ponytail: schema has oneOf/anyOf/$ref, escalation ceiling reached</span>
                    </FormLabel>
                    <FormControl>
                      <textarea {...field} value={String(field.value ?? "")} className="mono" rows={6} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          ) : fields.length === 0 ? (
            <p className="mono call-meta">No arguments.</p>
          ) : (
            fields.map((f) => (
              <div className="call-field" key={f.key}>
                <FormField
                  control={form.control}
                  name={f.key}
                  render={({ field }) => {
                    if (f.kind === "boolean") {
                      return (
                        <FormItem className="call-field-checkbox">
                          <FormControl>
                            <Checkbox checked={Boolean(field.value)} onCheckedChange={field.onChange} />
                          </FormControl>
                          <FormLabel className="cap">
                            {f.key}
                            {f.required ? " *" : ""}
                          </FormLabel>
                        </FormItem>
                      );
                    }
                    if (f.kind === "enum") {
                      return (
                        <FormItem>
                          <FormLabel className="cap">
                            {f.key}
                            {f.required ? " *" : ""}
                          </FormLabel>
                          <Select value={String(field.value ?? "")} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="select…" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(f.enumValues ?? []).map((v) => (
                                <SelectItem key={String(v)} value={String(v)}>
                                  {String(v)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      );
                    }
                    return (
                      <FormItem>
                        <FormLabel className="cap">
                          {f.key}
                          {f.required ? " *" : ""}
                          {f.kind === "json" ? <span className="mono call-ceiling"> // ponytail: array/object field, raw JSON</span> : null}
                        </FormLabel>
                        <FormControl>
                          {f.kind === "json" ? (
                            <textarea {...field} value={String(field.value ?? "")} className="mono" rows={3} />
                          ) : (
                            <Input
                              {...field}
                              value={String(field.value ?? "")}
                              type={f.kind === "number" ? "number" : "text"}
                              autoComplete="off"
                            />
                          )}
                        </FormControl>
                      </FormItem>
                    );
                  }}
                />
              </div>
            ))
          )}

          {form.formState.errors["root"]?.message && (
            <p className="server-form-error">{String(form.formState.errors["root"].message)}</p>
          )}

          <Button type="submit" variant="outline" className="dlg-action dlg-action-primary" disabled={!canSubmit}>
            {callState.isLoading ? "calling…" : "call"}
          </Button>
        </form>
      </Form>

      <div className="call-preview">
        <div className="call-preview-block">
          <span className="cap">as</span>
          <span className="mono">{tool.namespaced}</span>
          <button type="button" className="call-copy" onClick={() => void copyText(tool.namespaced)}>
            copy
          </button>
        </div>
        <div className="call-preview-block">
          <span className="cap">cli</span>
          <span className="mono">{cliLine}</span>
          <button type="button" className="call-copy" onClick={() => void copyText(cliLine)}>
            copy
          </button>
        </div>
      </div>

      {callState.error !== undefined && (
        <div className="call-result">
          <pre className="mark-err">{errorMessage(callState.error)}</pre>
        </div>
      )}
      {callState.data !== undefined && callMeta && <ResultPane result={callState.data} durationMs={callMeta.durationMs} tokens={callMeta.tokens} />}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (isRecord(error) && isRecord(error["data"]) && isRecord(error["data"]["error"])) {
    const message = error["data"]["error"]["message"];
    if (typeof message === "string") return message;
  }
  return "Request failed.";
}
