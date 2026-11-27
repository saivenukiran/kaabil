// Generates the API reference from the route list and the schemas, so it cannot drift from the code:
//
//   npx tsx scripts/gen-api-docs.mjs            writes docs/api/endpoints.md and docs/api/openapi.json
//   npx tsx scripts/gen-api-docs.mjs --check    exits 1 if the committed files are out of date (run by docs:check)
//
// The route list is packages/contract/src/routes.ts; tests make sure it matches the real server.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { AUTH_ENDPOINTS, CLIENT_CALLS, ErrorBodySchema, ROUTES } from '../packages/contract/src/index.ts';

const check = process.argv.includes('--check');
const toJson = (schema) => {
  const j = z.toJSONSchema(schema, { unrepresentable: 'any' });
  delete j.$schema;
  return j;
};

const AREAS = [
  ['system', 'System'],
  ['family', 'Family: the account, the care group, medicines, pairing, doses and alerts'],
  ['phone', "The person's phone"],
  ['live', 'Live events: streams and long polling'],
  ['voice', 'Voice: custom voice recordings, and cloud voice status'],
  ['calls', 'Calls'],
  ['dev', 'Developer console (only when KAABIL_DEV_CONSOLE=1)'],
];
const WHO = {
  none: 'anyone',
  session: 'a signed-in family member (session cookie)',
  device: "the person's paired phone (`Authorization: Bearer <device token>`)",
  dev: 'a signed-in family member, and only when the developer console is on',
};
const PLACEHOLDER = { id: '$GROUP_ID', mid: '$MEDICINE_ID', did: '$DEVICE_ID', aid: '$ALERT_ID', hash: '$TEXT_HASH' };

// ---- JSON Schema to a table of fields
function typeOf(s) {
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return `one of ${s.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  const alts = s.anyOf ?? s.oneOf;
  if (alts) {
    const nonNull = alts.filter((a) => a.type !== 'null');
    if (nonNull.length === 1 && alts.length === 2) return `${typeOf(nonNull[0])} or null`;
    const consts = alts.map((a) => a.properties?.type?.const).filter(Boolean);
    return consts.length === alts.length ? `one of the events ${consts.map((c) => `\`${c}\``).join(', ')}` : 'one of several shapes';
  }
  if (s.type === 'array') return `array of ${s.items ? typeOf(s.items) : 'anything'}`;
  return s.type ?? 'string';
}
function limits(s) {
  const out = [];
  if (s.minLength !== undefined && s.maxLength !== undefined) out.push(`${s.minLength} to ${s.maxLength} characters`);
  else if (s.maxLength !== undefined) out.push(`up to ${s.maxLength} characters`);
  else if (s.minLength !== undefined) out.push(`at least ${s.minLength} character${s.minLength === 1 ? '' : 's'}`);
  if (s.minimum !== undefined && s.minimum > Number.MIN_SAFE_INTEGER) out.push(`at least ${s.minimum}`);
  if (s.exclusiveMinimum !== undefined) out.push(`above ${s.exclusiveMinimum}`);
  if (s.minItems !== undefined && s.maxItems !== undefined) out.push(`${s.minItems} to ${s.maxItems} items`);
  else if (s.maxItems !== undefined) out.push(`up to ${s.maxItems} items`);
  else if (s.minItems !== undefined) out.push(`at least ${s.minItems} item${s.minItems === 1 ? '' : 's'}`);
  if (s.type === 'array' && s.items) {
    const each = limits(s.items).filter((x) => !x.startsWith('no other'));
    if (each.length) out.push(`each item: ${each.join(', ')}`);
  }
  if (s.pattern) out.push(`matches \`${s.pattern}\``);
  if (s.additionalProperties === false && s.properties) out.push('no other fields');
  return out;
}
function rows(s, path, required, out) {
  const alts = s.anyOf ?? s.oneOf;
  const isUnionOfObjects = alts && alts.every((a) => a.type === 'object');
  const skipRoot = !path && s.type === 'object' && s.properties; // the body itself is not a row; its fields are
  if (!skipRoot) out.push({ name: path || '(body)', type: typeOf(s), required, note: [s.description, ...limits(s)].filter(Boolean).join('. ') });
  if (isUnionOfObjects && !path) {
    alts.forEach((a, i) => {
      out.push({ name: `option ${i + 1}`, type: 'object', required: false, note: 'send exactly one of the options' });
      for (const [k, v] of Object.entries(a.properties ?? {})) rows(v, k, (a.required ?? []).includes(k), out);
    });
    return out.slice(1);
  }
  if (s.type === 'object' && s.properties) {
    for (const [k, v] of Object.entries(s.properties)) rows(v, path ? `${path}.${k}` : k, (s.required ?? []).includes(k), out);
  } else if (s.type === 'array' && s.items?.type === 'object' && s.items.properties) {
    for (const [k, v] of Object.entries(s.items.properties)) rows(v, `${path}[].${k}`, (s.items.required ?? []).includes(k), out);
  }
  return out;
}
function table(schema) {
  const js = toJson(schema);
  const all = rows(js, '', true, []);
  const lines = ['| Field | Type | Required | Notes |', '|---|---|---|---|'];
  for (const r of all) lines.push(`| \`${r.name}\` | ${r.type} | ${r.required ? 'yes' : 'no'} | ${r.note || ''} |`);
  return lines.join('\n');
}

// ---- Markdown
const key = (r) => `${r.method} ${r.path}`;
function curl(r) {
  const url = `"$BASE${r.path.replace(/:([a-z]+)/g, (_, p) => PLACEHOLDER[p] ?? `$${p.toUpperCase()}`)}"`;
  const parts = ['curl', '-s'];
  if (r.method !== 'GET') parts.push('-X', r.method);
  if (r.auth === 'session' || r.auth === 'dev') parts.push('-b cookies.txt');
  if ((r.auth === 'session' || r.auth === 'dev') && r.method !== 'GET') parts.push('-H "Origin: $BASE"');
  if (r.auth === 'device') parts.push('-H "Authorization: Bearer $DEVICE_TOKEN"');
  for (const [k, v] of Object.entries(r.headers ?? {})) parts.push(`-H "${k}: ${v}"`);
  if (r.request && 'schema' in r.request) parts.push('-H "Content-Type: application/json"', `-d '${JSON.stringify(r.request.example)}'`);
  if (r.request && 'raw' in r.request) parts.push('--data-binary @clip.wav');
  parts.push(url);
  return parts.join(' ');
}

function section(r) {
  const out = [`### \`${r.method} ${r.path}\``, '', `**${r.summary}**`, '', `Who may call it: ${WHO[r.auth]}.`, ''];
  if (r.description) out.push(r.description, '');
  if (r.params) out.push('Path parameters', '', '| Name | Meaning |', '|---|---|', ...Object.entries(r.params).map(([k, v]) => `| \`${k}\` | ${v} |`), '');
  if (r.query) out.push('Query', '', '| Name | Meaning |', '|---|---|', ...Object.entries(r.query).map(([k, v]) => `| \`${k}\` | ${v} |`), '');
  if (r.headers) out.push('Headers to send', '', '| Header | Value |', '|---|---|', ...Object.entries(r.headers).map(([k, v]) => `| \`${k}\` | \`${v}\` |`), '');
  if (r.request) {
    out.push('Request body', '');
    if ('schema' in r.request) out.push(table(r.request.schema), '', 'Example', '', '```json', JSON.stringify(r.request.example, null, 2), '```', '');
    else out.push(`${r.request.raw} (\`${r.request.contentType}\`).`, '');
  }
  out.push(`Success: **${r.status}**`, '');
  if ('schema' in r.response) out.push(table(r.response.schema), '');
  else out.push(r.response.contentType === '-' ? 'No body.' : `${r.response.raw} (\`${r.response.contentType}\`).`, '');
  if (r.errors?.length) out.push('Errors', '', '| Status | When |', '|---|---|', ...r.errors.map((e) => `| ${e.status} | ${e.when} |`), '');
  out.push('With curl', '', '```bash', curl(r), '```', '');
  const call = CLIENT_CALLS[key(r)];
  if (call) out.push('With the typed client (`@kaabil/contract`)', '', '```ts', call, '```', '');
  return out.join('\n');
}

const md = [
  '# API reference',
  '',
  '> **Generated** from `packages/contract/src/routes.ts` and the schemas in `packages/contract/src/schemas.ts` by `scripts/gen-api-docs.mjs`. Do not edit by hand; run `npx tsx scripts/gen-api-docs.mjs`. Tests check that this list is exactly the server\'s endpoints. The same content as OpenAPI 3.1 is in [`openapi.json`](openapi.json).',
  '',
  'Start with the [guide](README.md) for conventions (errors, sign-in, live events) and a worked example. The `curl` examples assume `BASE` is the address (for example `http://localhost:8080`), `cookies.txt` is a cookie jar from signing in, and `DEVICE_TOKEN` is the token from pairing.',
  '',
  '## All endpoints',
  '',
  '| Method | Path | Who | What |',
  '|---|---|---|---|',
  ...ROUTES.map((r) => `| ${r.method} | \`${r.path}\` | ${r.auth} | ${r.summary} |`),
  '',
  '## Sign-in (Better Auth)',
  '',
  'Family sign-in is [Better Auth](https://better-auth.com), mounted under `/api/auth/`. Its shapes are the library\'s; these are the ones the apps use. The library has more endpoints under the same prefix (organization management among them); treat the care-group routes above as the supported way to manage a group.',
  '',
  '| Method | Path | Body | What it does |',
  '|---|---|---|---|',
  ...AUTH_ENDPOINTS.map((e) => `| ${e.method} | \`${e.path}\` | \`${e.body}\` | ${e.does} |`),
  '',
  ...AREAS.flatMap(([area, title]) => {
    const rs = ROUTES.filter((r) => r.area === area);
    return rs.length ? [`## ${title}`, '', ...rs.map(section)] : [];
  }),
].join('\n').replace(/\n{3,}/g, '\n\n') + '\n';

// ---- OpenAPI 3.1
const operationId = (r) => r.method.toLowerCase() + r.path.replace(/\/:?([a-z-]+)/g, (_, w) => w[0].toUpperCase() + w.slice(1)).replace(/[^A-Za-z0-9]/g, '');
const paths = {};
for (const r of ROUTES) {
  const url = r.path.replace(/:([a-z]+)/g, '{$1}');
  const parameters = [
    ...Object.entries(r.params ?? {}).map(([name, description]) => ({ name, in: 'path', required: true, description, schema: { type: 'string' } })),
    ...Object.entries(r.query ?? {}).map(([name, description]) => ({ name, in: 'query', required: false, description, schema: { type: 'string' } })),
    ...Object.entries(r.headers ?? {}).map(([name, description]) => ({ name, in: 'header', required: true, description: `Send \`${description}\``, schema: { type: 'string' } })),
  ];
  const op = { tags: [r.area], summary: r.summary, description: r.description, operationId: operationId(r), parameters, responses: {} };
  if (r.auth === 'session' || r.auth === 'dev') op.security = [{ session: [] }];
  if (r.auth === 'device') op.security = [{ device: [] }];
  if (r.request) {
    op.requestBody = { required: true, content: 'schema' in r.request ? { 'application/json': { schema: toJson(r.request.schema), example: r.request.example } } : { [r.request.contentType.split(' ')[0]]: { schema: { type: 'string', format: 'binary' } } } };
  }
  op.responses[String(r.status)] = { description: 'Success', ...(r.response.contentType === '-' ? {} : { content: 'schema' in r.response ? { 'application/json': { schema: toJson(r.response.schema) } } : { [r.response.contentType]: { schema: { type: 'string' }, description: r.response.raw } } }) };
  for (const e of r.errors ?? []) op.responses[String(e.status)] = { description: e.when, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  (paths[url] ??= {})[r.method.toLowerCase()] = op;
}
const openapi = {
  openapi: '3.1.0',
  info: { title: 'Kaabil API', version: '0.1.0', description: 'The backend of Kaabil Hain Hum. Generated from the route list; see docs/api/README.md. Family sign-in endpoints under /api/auth/ belong to Better Auth and are not described here.' },
  servers: [{ url: '/' }],
  tags: AREAS.map(([name, description]) => ({ name, description })),
  paths,
  components: {
    schemas: { Error: toJson(ErrorBodySchema) },
    securitySchemes: {
      session: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'The session cookie Better Auth sets on sign-in (the name gets a __Secure- prefix over HTTPS). Data-changing requests must also come from an allowed Origin.' },
      device: { type: 'http', scheme: 'bearer', description: "The device token the person's phone receives when it pairs." },
    },
  },
};
const json = JSON.stringify(openapi, null, 2) + '\n';

const files = [['docs/api/endpoints.md', md], ['docs/api/openapi.json', json]];
if (check) {
  const stale = files.filter(([p, c]) => !existsSync(p) || readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== c).map(([p]) => p);
  if (stale.length) {
    console.log(`Out of date: ${stale.join(', ')}. Run: npx tsx scripts/gen-api-docs.mjs`);
    process.exit(1);
  }
  console.log(`API reference is up to date (${ROUTES.length} endpoints).`);
} else {
  for (const [p, c] of files) writeFileSync(p, c, { encoding: 'utf8' });
  console.log(`Wrote ${files.map(([p]) => p).join(' and ')} (${ROUTES.length} endpoints).`);
}
