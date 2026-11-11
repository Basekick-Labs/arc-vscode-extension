/**
 * Classification of Arc's refusals.
 *
 * Arc restricts reads per database (and, with RBAC, per measurement). A token
 * can hold the coarse `read` permission and still be refused for a database
 * or measurement its grants do not cover. How Arc answers a list-everything
 * request for such a token depends on the version:
 *
 *   - Arc 26.09 and earlier refuse it (`SHOW DATABASES` answers 403 "no read
 *     permission to list databases"); a scoped caller has to name a database.
 *   - Newer Arc returns only the databases the token can read.
 *
 * HTTP 403 is therefore ambiguous, and Arc tells the cases apart only by
 * message. This module is the one place that reads those messages, so the
 * extension never has to guess:
 *
 *   - **scoped** — the token may read, but not what was asked for. Normal for
 *     a tenant-scoped token, not a fault. Naming a database (or measurement)
 *     the token is granted is the only thing that helps.
 *   - **forbidden** — the token carries no read permission at all. A
 *     different token is needed; naming a database will not help.
 *   - **denied** — any other refusal: the token lacks admin, write or delete,
 *     or the server has the operation turned off. Arc's own message says
 *     which, so it is shown as is. Only *read* refusals are reworded.
 *   - **unavailable** — Arc could not read its own permission data and
 *     refused rather than guess. A server-side fault that says nothing about
 *     the token or the database.
 *
 * Deliberately free of any `vscode` import so it can be unit-tested in plain
 * Node and reused by anything in the extension.
 */

/** What Arc's refusal means, and therefore what the user should do. */
export type ArcErrorKind =
  | 'auth'          // 401: token missing, invalid or expired
  | 'scoped'        // 403: may read, but not this database / measurement
  | 'forbidden'     // 403: no read permission at all
  | 'denied'        // 403: any non-read refusal (admin, write, delete, disabled operation)
  | 'unavailable'   // 503 (or 403 on older Arc): Arc could not load the grants (server fault)
  | 'license'       // 403: feature needs an enterprise license
  | 'not_found'     // 404
  | 'network'       // could not reach the server
  | 'server'        // anything else
  ;

export interface ArcErrorInfo {
  kind: ArcErrorKind;
  /** HTTP status, when the error came from a response. */
  status?: number;
  /**
   * For `scoped`: the database Arc named, or undefined when the request asked
   * for every database (Arc then sends `*`, an empty name, or no name at all).
   */
  database?: string;
  /** For `scoped`: the measurement Arc named, when the refusal was for one. */
  measurement?: string;
  /** Arc's own message, when it sent one. */
  serverMessage?: string;
}

/**
 * The read refusals Arc sends, and what each one means. Matching is anchored
 * on the permission word `read`: Arc uses the same shapes for write and
 * delete (`access denied: no write permission for db.m`), and those must not
 * be reported as a read problem.
 *
 * Query path (`SHOW DATABASES`, `SHOW TABLES FROM db`, SELECT,
 * `GET /api/v1/measurements`):
 *
 *   access denied: no read permission to list databases      -> scoped (Arc 26.09 and earlier)
 *   access denied: no read permission for database 'x'       -> scoped ('x')
 *   access denied: no read permission for x.m                -> scoped ('x', measurement 'm')
 *   access denied: no read permission for x.*                -> scoped ('x')
 *   access denied: no read permission for *.*                -> scoped (no name)
 *
 * Coarse refusal, which means the token has no read permission:
 *
 *   Permission denied: read required                         -> forbidden
 *
 * Fail-closed answer when Arc main cannot read its grants (at the query door):
 *
 *   503 Permission store unavailable; retry later (reason hub_unavailable)  -> unavailable
 *
 * Arc's query path reports every RBAC denial for a table, including a grant
 * lookup that failed, as `no read permission for db.m`, so those always read
 * as a measurement-level refusal; only Arc can tell them apart.
 *
 * Also matched, defensively: `no permission for read on database 'x'`
 * (scoped), `token does not have 'read' permission` (forbidden) and 403
 * `permission data unavailable` (unavailable). These are Arc's internal
 * reasons; neither 26.09.4 nor main sends them as a response body today.
 */
const PERMISSION_DATA_UNAVAILABLE = 'permission data unavailable';
const PERMISSION_STORE_UNAVAILABLE = 'permission store unavailable';
const HUB_UNAVAILABLE_REASON = 'hub_unavailable';

/** `access denied: no read permission to list databases` — names none */
const GATE_LIST_RE = /^access denied: no read permission to list databases/i;
/** `access denied: no read permission for database 'x'` */
const GATE_DATABASE_RE = /^access denied: no read permission for database '([^']*)'/i;
/** `access denied: no read permission for <db>.<measurement>` */
const GATE_MEASUREMENT_RE = /^access denied: no read permission for ([^\s.']+)\.(\S+)/i;
/** `no permission for read on database 'x'` */
const MIDDLEWARE_RE = /^no permission for read on database '([^']*)'/i;
/** The coarse "no read permission at all" refusals. */
const NO_READ_RES = [
  /^permission denied: read required/i,
  /^token does not have 'read' permission/i
];

/** A name Arc sent that is a real database or measurement, not a wildcard. */
function named(name: string | undefined): string | undefined {
  return name && name !== '*' ? name : undefined;
}

/**
 * Classify a 403 by its message. Returns the kind and, for a scoped refusal,
 * the database (and measurement) Arc named — `undefined` when Arc named none,
 * or named the wildcard, because `"*"` is not something a user can be told to
 * pick.
 */
function classifyForbidden(message: string): Pick<ArcErrorInfo, 'kind' | 'database' | 'measurement'> {
  const text = message.trim();
  const lower = text.toLowerCase();

  if (lower.includes(PERMISSION_DATA_UNAVAILABLE)) {
    return { kind: 'unavailable' };
  }
  // Arc uses 403 for licence-gated features too, with its own wording. Kept
  // ahead of the permission shapes so a licensing problem is never reported
  // as a token-permission one.
  if (lower.includes('enterprise license')) {
    return { kind: 'license' };
  }
  if (GATE_LIST_RE.test(text)) {
    return { kind: 'scoped' };
  }
  for (const pattern of [GATE_DATABASE_RE, MIDDLEWARE_RE]) {
    const match = pattern.exec(text);
    if (match) {
      return { kind: 'scoped', database: named(match[1]) };
    }
  }
  const measurement = GATE_MEASUREMENT_RE.exec(text);
  if (measurement) {
    const database = named(measurement[1]);
    return { kind: 'scoped', database, measurement: database ? named(measurement[2]) : undefined };
  }
  if (NO_READ_RES.some(re => re.test(text))) {
    return { kind: 'forbidden' };
  }
  // Anything else is a refusal Arc already explains: a missing admin, write or
  // delete permission, or an operation the server has turned off. Rewording
  // it as a read problem would send the user to fix the wrong thing.
  return { kind: 'denied' };
}

/**
 * Describe an error from an Arc request. `status`, `serverMessage` and
 * `reason` come from the caller so this stays independent of the HTTP library.
 */
export function classifyArcError(
  status: number | undefined,
  serverMessage: string | undefined,
  networkCode?: string,
  reason?: string,
): ArcErrorInfo {
  if (status === undefined) {
    return { kind: networkCode ? 'network' : 'server', serverMessage };
  }
  if (status === 401) {
    return { kind: 'auth', status, serverMessage };
  }
  if (status === 403) {
    return { ...classifyForbidden(serverMessage ?? ''), status, serverMessage };
  }
  if (status === 503 && (
    reason === HUB_UNAVAILABLE_REASON ||
    (serverMessage ?? '').toLowerCase().includes(PERMISSION_STORE_UNAVAILABLE)
  )) {
    return { kind: 'unavailable', status, serverMessage };
  }
  if (status === 404) {
    return { kind: 'not_found', status, serverMessage };
  }
  return { kind: 'server', status, serverMessage };
}

/** The command a user runs to point a connection at one database. */
export const SET_DATABASE_HINT = 'run "Arc: Set Connection Database"';

/**
 * A sentence that names the fix, for the status bar, a toast, or a tree item.
 * Never a bare status code, and never a stack trace.
 */
export function arcErrorMessage(info: ArcErrorInfo): string {
  switch (info.kind) {
    case 'auth':
      return 'Arc rejected the token — it is missing, invalid or expired. Update the connection\'s token.';
    case 'scoped':
      if (info.database && info.measurement) {
        return `This token has no read access to measurement '${info.database}.${info.measurement}'. Other measurements in '${info.database}' may still be readable.`;
      }
      return info.database
        ? `This token has no read access to database '${info.database}'. It may be able to read others.`
        : `This token is restricted to specific databases, and this Arc server will not list them all for it. To browse one the token can read, ${SET_DATABASE_HINT}.`;
    case 'forbidden':
      return 'This token does not carry the read permission Arc requires. Use a token with read permission.';
    case 'denied':
      return info.serverMessage ?? 'Arc refused the request.';
    case 'unavailable':
      return 'Arc could not read its own permission data and refused the request rather than guessing. This is a server-side fault — retry later, or check the Arc server log.';
    case 'license':
      return info.serverMessage ?? 'This Arc feature requires an enterprise license.';
    case 'not_found':
      return info.serverMessage ?? 'Not found.';
    default:
      return info.serverMessage ?? 'Arc returned an error.';
  }
}

/**
 * Error thrown for a refusal, carrying the classification so a caller can
 * degrade usefully instead of parsing a message.
 */
export class ArcAccessError extends Error {
  readonly info: ArcErrorInfo;

  constructor(info: ArcErrorInfo) {
    super(arcErrorMessage(info));
    this.name = 'ArcAccessError';
    this.info = info;
  }

  /** True when the token may read, but not what was asked for. */
  get isScoped(): boolean {
    return this.info.kind === 'scoped';
  }
}

/** True when err is a scoped refusal — "name a database you are granted". */
export function isScopedRefusal(err: unknown): err is ArcAccessError {
  return err instanceof ArcAccessError && err.isScoped;
}
