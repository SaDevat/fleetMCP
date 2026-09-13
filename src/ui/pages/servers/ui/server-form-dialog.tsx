import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import { useAppDispatch, useAppSelector } from "@/ui/shared/api/index.ts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/components/ui/dialog.tsx";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/ui/components/ui/form.tsx";
import { Input } from "@/ui/components/ui/input.tsx";
import { Button } from "@/ui/components/ui/button.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/components/ui/select.tsx";
import { closeForm, selectFormAlias, selectFormMode } from "../model.ts";
import { useAddServerMutation, useEditServerMutation, useGetServersQuery, type ServerBody } from "../api.ts";

const formSchema = z
  .object({
    alias: z.string().min(1, "Alias is required"),
    type: z.enum(["stdio", "http"]),
    command: z.string().optional(),
    argsText: z.string().optional(),
    envText: z.string().optional(),
    url: z.string().optional(),
    headersText: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "stdio" && !val.command?.trim()) {
      ctx.addIssue({ path: ["command"], code: "custom", message: "Command is required" });
    }
    if (val.type === "http") {
      if (!val.url?.trim()) {
        ctx.addIssue({ path: ["url"], code: "custom", message: "URL is required" });
      } else if (!URL.canParse(val.url)) {
        ctx.addIssue({ path: ["url"], code: "custom", message: "Must be a valid URL" });
      }
    }
  });

type FormValues = z.infer<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  alias: "",
  type: "stdio",
  command: "",
  argsText: "",
  envText: "",
  url: "",
  headersText: "",
};

/** "KEY=val,KEY2=val2" (or "Key:val" for headers) -- same convention as `fleetmcp config add`. */
function parseKv(text: string | undefined, sep: "=" | ":"): Record<string, string> {
  const record: Record<string, string> = {};
  const trimmed = (text ?? "").trim();
  if (!trimmed) return record;
  for (const pair of trimmed.split(",")) {
    const idx = pair.indexOf(sep);
    if (idx > 0) record[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return record;
}

function stringifyKv(record: Record<string, string> | undefined, sep: "=" | ":"): string {
  return Object.entries(record ?? {})
    .map(([k, v]) => `${k}${sep}${v}`)
    .join(",");
}

function parseArgs(text: string | undefined): string[] {
  const trimmed = (text ?? "").trim();
  return trimmed.length ? trimmed.split(/\s+/) : [];
}

function buildBody(values: FormValues): ServerBody {
  if (values.type === "stdio") {
    return {
      type: "stdio",
      command: values.command!.trim(),
      args: parseArgs(values.argsText),
      env: parseKv(values.envText, "="),
    };
  }
  return {
    type: "http",
    url: values.url!.trim(),
    headers: parseKv(values.headersText, ":"),
  };
}

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const fbq = error as FetchBaseQueryError;
  const data = fbq.data as { error?: { message?: string } } | undefined;
  return data?.error?.message ?? "Something went wrong.";
}

export function ServerFormDialog() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector(selectFormMode);
  const alias = useAppSelector(selectFormAlias);
  const { data } = useGetServersQuery();
  const entry = alias ? data?.servers.find((s) => s.alias === alias) : undefined;

  const [addServer, addState] = useAddServerMutation();
  const [editServer, editState] = useEditServerMutation();

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY_VALUES });

  useEffect(() => {
    if (mode === "edit" && entry) {
      form.reset({
        alias: entry.alias,
        type: entry.type,
        command: entry.command ?? "",
        argsText: (entry.args ?? []).join(" "),
        envText: stringifyKv(entry.env, "="),
        url: entry.url ?? "",
        headersText: stringifyKv(entry.headers, ":"),
      });
    } else if (mode === "add") {
      form.reset(EMPTY_VALUES);
    }
  }, [mode, entry, form]);

  const type = form.watch("type");
  const isSaving = addState.isLoading || editState.isLoading;
  const error = errorMessage(mode === "add" ? addState.error : editState.error);

  const onSubmit = async (values: FormValues) => {
    const body = buildBody(values);
    if (mode === "add") {
      await addServer({ ...body, alias: values.alias.trim() } as never).unwrap().then(
        () => dispatch(closeForm()),
        () => undefined,
      );
    } else if (mode === "edit" && alias) {
      await editServer({ alias, body }).unwrap().then(
        () => dispatch(closeForm()),
        () => undefined,
      );
    }
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && dispatch(closeForm())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display" style={{ color: "var(--ink)" }}>
            {mode === "add" ? "Add server" : `Edit ${alias}`}
          </DialogTitle>
          <DialogDescription className="mono" style={{ fontSize: ".75rem" }}>
            Written straight to ~/.fleetmcp/config.yml.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="server-form" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="alias"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="cap">alias</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={mode === "edit"} placeholder="my-server" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="cap">transport</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="stdio">stdio</SelectItem>
                      <SelectItem value="http">http</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {type === "stdio" ? (
              <>
                <FormField
                  control={form.control}
                  name="command"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="cap">command</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="bunx" autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="argsText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="cap">args</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="-y @modelcontextprotocol/server-everything" autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="envText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="cap">env</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="KEY=value,KEY2=value2" autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="cap">url</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="https://my-server.com/mcp" autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="headersText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="cap">headers</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Authorization:Bearer …" autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {error && <p className="server-form-error">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" className="dlg-action" onClick={() => dispatch(closeForm())}>
                Cancel
              </Button>
              <Button type="submit" variant="outline" className="dlg-action dlg-action-primary" disabled={isSaving}>
                {mode === "add" ? "Add server" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
