import { toHttpRequest, type RequestDraft } from "./model";

export type CodeFormat = "curl" | "fetch" | "httpie";

/** Remplace {{nom}} par sa valeur. Une variable inconnue est laissée telle quelle. */
export function resolveVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : match,
  );
}

type Pairs = Array<[string, string]>;
type PreparedBody =
  | { type: "text"; content: string }
  | { type: "urlencoded"; fields: Pairs }
  | { type: "form"; fields: Pairs }
  | null;

interface Prepared {
  method: string;
  url: string;
  headers: Pairs;
  body: PreparedBody;
  basic: { user: string; pass: string } | null;
  followRedirects: boolean;
}

const hasHeader = (headers: Pairs, name: string) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());

function prepare(draft: RequestDraft, variables: Record<string, string>): Prepared {
  const req = toHttpRequest(draft);
  const r = (s: string) => resolveVariables(s, variables);

  let url = r(req.url);
  const headers: Pairs = req.headers.map((h) => [r(h.key), r(h.value)]);
  let basic: Prepared["basic"] = null;

  switch (req.auth.type) {
    case "bearer":
      headers.push(["Authorization", `Bearer ${r(req.auth.token)}`]);
      break;
    case "basic":
      basic = { user: r(req.auth.username), pass: r(req.auth.password) };
      break;
    case "apiKey":
      if (req.auth.in === "header") headers.push([r(req.auth.key), r(req.auth.value)]);
      else {
        const pair = `${encodeURIComponent(r(req.auth.key))}=${encodeURIComponent(r(req.auth.value))}`;
        url += `${url.includes("?") ? "&" : "?"}${pair}`;
      }
      break;
    default:
      break;
  }

  let body: PreparedBody = null;
  switch (req.body.type) {
    case "json":
    case "xml":
    case "raw": {
      const contentType =
        req.body.type === "json" ? "application/json" : req.body.type === "xml" ? "application/xml" : req.body.contentType;
      if (!hasHeader(headers, "content-type")) headers.push(["Content-Type", contentType]);
      body = { type: "text", content: r(req.body.content) };
      break;
    }
    case "urlencoded":
      body = { type: "urlencoded", fields: req.body.fields.map((f) => [r(f.key), r(f.value)]) };
      break;
    case "form-data":
      body = {
        type: "form",
        fields: req.body.fields.flatMap((f) => (f.kind === "text" ? [[r(f.key), r(f.value)] as [string, string]] : [])),
      };
      break;
    default:
      break;
  }

  return { method: req.method, url, headers, body, basic, followRedirects: req.followRedirects };
}

/** Guillemets simples pour un shell de type bash. */
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function toCurl(p: Prepared): string {
  const parts = [`curl${p.method === "GET" ? "" : ` -X ${p.method}`} ${sq(p.url)}`];
  for (const [k, v] of p.headers) parts.push(`-H ${sq(`${k}: ${v}`)}`);
  if (p.basic) parts.push(`-u ${sq(`${p.basic.user}:${p.basic.pass}`)}`);
  if (p.followRedirects) parts.push("-L");
  if (p.body?.type === "text") parts.push(`--data-raw ${sq(p.body.content)}`);
  if (p.body?.type === "urlencoded") for (const [k, v] of p.body.fields) parts.push(`--data-urlencode ${sq(`${k}=${v}`)}`);
  if (p.body?.type === "form") for (const [k, v] of p.body.fields) parts.push(`-F ${sq(`${k}=${v}`)}`);
  return parts.join(" \\\n  ");
}

function toFetch(p: Prepared): string {
  const lines: string[] = [];
  if (p.body?.type === "form") {
    lines.push("const form = new FormData();");
    for (const [k, v] of p.body.fields) lines.push(`form.append(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
    lines.push("");
  }

  const headerLines = p.headers.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  if (p.basic) headerLines.push(`"Authorization": "Basic " + btoa(${JSON.stringify(`${p.basic.user}:${p.basic.pass}`)})`);

  const options = [`method: ${JSON.stringify(p.method)}`];
  if (headerLines.length > 0) options.push(`headers: {\n${headerLines.map((l) => `    ${l}`).join(",\n")},\n  }`);
  if (p.body?.type === "text") options.push(`body: ${JSON.stringify(p.body.content)}`);
  if (p.body?.type === "urlencoded") options.push(`body: new URLSearchParams(${JSON.stringify(p.body.fields)})`);
  if (p.body?.type === "form") options.push("body: form");
  options.push(`redirect: ${JSON.stringify(p.followRedirects ? "follow" : "manual")}`);

  lines.push(`const response = await fetch(${JSON.stringify(p.url)}, {`);
  lines.push(options.map((o) => `  ${o}`).join(",\n") + ",");
  lines.push("});");
  lines.push("console.log(response.status, await response.text());");
  return lines.join("\n");
}

function toHttpie(p: Prepared): string {
  let first = "http";
  if (p.followRedirects) first += " --follow";
  if (p.body?.type === "urlencoded") first += " --form";
  if (p.body?.type === "form") first += " --multipart";
  if (p.body?.type === "text") first += ` --raw ${sq(p.body.content)}`;
  first += ` ${p.method} ${sq(p.url)}`;

  const parts = [first];
  for (const [k, v] of p.headers) parts.push(sq(`${k}:${v}`));
  if (p.basic) parts.push(`--auth ${sq(`${p.basic.user}:${p.basic.pass}`)}`);
  if (p.body?.type === "urlencoded" || p.body?.type === "form") for (const [k, v] of p.body.fields) parts.push(sq(`${k}=${v}`));
  return parts.join(" \\\n  ");
}

export function generateCode(format: CodeFormat, draft: RequestDraft, variables: Record<string, string> = {}): string {
  const prepared = prepare(draft, variables);
  if (format === "curl") return toCurl(prepared);
  if (format === "fetch") return toFetch(prepared);
  return toHttpie(prepared);
}