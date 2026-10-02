/**
 * Classification of Arc's refusals.
 *
 * Arc restricts reads per database. A token can hold the coarse `read`
 * permission and still be refused for a database its grants do not cover, and
 * Arc will not answer a list-everything request with a filtered list — a
 * scoped caller has to name a database, the same bar `SHOW DATABASES` applies.
 *
 * That makes HTTP 403 ambiguous: it is the answer to three different
 * questions, and Arc tells them apart only by message. This module is the one
 * place that reads those messages, so the extension never has to guess:
 *
 *   - **scoped** — the token may read, but not what was asked for. Normal for
 *     a tenant-scoped token, not a fault. Retrying is pointless; naming a
 *     database the token is granted is the only thing that helps.
 *   - **forbidden** — the token carries no read permission at all. A
 *     different token is needed; naming a database will not help.
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
  | 'scoped'        // 403: may read, but not this database
  | 'forbidden'     // 403: no read permission at all
  | 'unavailable'   // 403: Arc could not load the grants (server fault)
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
  /** Arc's own message, when it sent one. */
  serverMessage?: string;
}

/**
 * The bodies Arc sends on a refusal. All the 403s share a status code and
 * differ only in message, so the message is the whole discriminator.
 *
 * From the handler gates on the query path, which is what this extension
 * uses (`SHOW DATABASES`, `SHOW TABLES FROM db`, `GET /api/v1/measurements`):
 *
 *   access denied: no read permission to list databases      -> scoped (no name)
 *   access denied: no read permission for database 'x'       -> scoped ('x')
 *   access denied: no read permission for x.*                -> scoped ('x')
 *
 * From the resource-scoped read middleware, which the database listing
 * endpoints use — included so this classifier stays correct if the extension
 * ever calls them, and because Arc may move a route behind it:
 *
 *   no permission for read on database 'x'                   -> scoped ('x')
 *
 * Coarse refusals, which mean the token has no read permission:
 *
 *   token does not have 'read' permission                    -> forbidden
 *   Permission denied: read required                         -> forbidden
 *
 * And the fail-closed answer, checked first because a broken permission store
 * must never be reported as a scoping state:
 *
 *   permission data unavailable                              -> unavailable
 *
 * Matching is by stable fragment rather than whole string, so a change to the
 * permission word or the surrounding punctuation cannot silently reclassify
 * one as another.
 */
const PERMISSION_DATA_UNAVAILABLE = 'permission data unavailable';

/** `access denied: no <perm> permission for database 'x'` */
const GATE_DATABASE_RE = /^access denied: no \w+ permission for database '([^']*)'/i;
/** `access denied: no <perm> permission for <db>.<measurement>` */
const GATE_MEASUREMENT_RE = /^access denied: no \w+ permission for ([^\s.]+)\./i;
/** `access denied: no <perm> permission to list databases` — names none */
const GATE_LIST_RE = /^access denied: no \w+ permission to list databases/i;
/** `no permission for <perm> on database 'x'` */
const MIDDLEWARE_RE = /^no permission for \w+ on database '([^']*)'/i;

/**
 * Classify a 403 by its message. Returns the kind and, for a scoped refusal,
 * the database Arc named — `undefined` when Arc named none, or named the
 * wildcard, because "name a database" is the advice in both cases and
 * `"*"` is not a database a user can be told to pick.
 */
function classifyForbidden(message: string): { kind: ArcErrorKind; database?: string } {
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
  for (const pattern of [GATE_DATABASE_RE, GATE_MEASUREMENT_RE, MIDDLEWARE_RE]) {
    const match = pattern.exec(text);
    if (match) {
      const name = match[1];
      return { kind: 'scoped', database: name && name !== '*' ? name : undefined };
    }
  }
  // An unrecognised 403 is reported as a missing permission on purpose:
  // naming the token's permissions is safe to say about any refusal, whereas
  // telling someone to pick a database they may already have picked is not.
  return { kind: 'forbidden' };
}

/**
 * Describe an error from an Arc request. `status` and `serverMessage` come
 * from the caller so this stays independent of the HTTP library.
 */
export function classifyArcError(
  status: number | undefined,
  serverMessage: string | undefined,
  networkCode?: string,
): ArcErrorInfo {
  if (status === undefined) {
    return { kind: networkCode ? 'network' : 'server', serverMessage };
  }
  if (status === 401) {
    return { kind: 'auth', status, serverMessage };
  }
  if (status === 403) {
    const { kind, database } = classifyForbidden(serverMessage ?? '');
    return { kind, status, database, serverMessage };
  }
  if (status === 404) {
    return { kind: 'not_found', status, serverMessage };
  }
  return { kind: 'server', status, serverMessage };
}

/**
 * A sentence that names the fix, for the status bar, a toast, or a tree item.
 * Never a bare status code, and never a stack trace.
 */
export function arcErrorMessage(info: ArcErrorInfo): string {
  switch (info.kind) {
    case 'auth':
      return 'Arc rejected the token — it is missing, invalid or expired. Update the connection\'s token.';
    case 'scoped':
      return info.database
        ? `This token has no read access to database '${info.database}'. It may be able to read others — set a different database on this connection.`
        : 'This token is restricted to specific databases, so Arc will not list them all. Set the database on this connection to one the token can read.';
    case 'forbidden':
      return 'This token does not carry the read permission Arc requires. Use a token with read permission.';
    case 'unavailable':
      return 'Arc could not read its own permission data and refused the request rather than guessing. This is a server-side fault — check the Arc server log.';
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
