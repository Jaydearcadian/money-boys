// Agentic / OAuth execution credential surface — Money Boys wrapped.
//
// AUTHORITY BOUNDARY
// ------------------
// This module supplies CREDENTIALS to the existing Money Boys execution path.
// It does NOT place orders. There is deliberately no method here that can
// submit, cancel, or query an order.
//
// The only way an Agentic credential can reach the venue is:
//
//   AgenticCredentialSource
//     -> BitgetClient (HMAC-SHA256 + paptrading)
//       -> OrderDispatcher  (requires a sealed APPROVED receipt)
//         -> venue
//
// Receipt sealing (I-03) and Risk Boy HARD_VETO (I-02) sit in front of the
// dispatcher and are not reachable from this file.
//
// ENABLED BY DEFAULT: NO. `isAgenticExecutionEnabled()` returns false unless
// AGENTIC_EXECUTION_ENABLED=true is set in the environment. This is a
// fail-closed default, not an oversight: an execution credential that becomes
// live by accident is unrecoverable, one that requires a deliberate flip is not.

import { z } from "zod";
import { BitgetClient } from "../../bitget/client.js";

/**
 * Environment flag. Absent, malformed, or anything other than "true" => OFF.
 */
export const AGENTIC_ENABLE_ENV = "AGENTIC_EXECUTION_ENABLED";

/**
 * Fail-closed enablement check.
 *
 * Only the exact string "true" enables execution. "1", "yes", "TRUE" and
 * typos all resolve to DISABLED — a safety gate should not be forgiving.
 */
export function isAgenticExecutionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[AGENTIC_ENABLE_ENV] === "true";
}

export const AgenticCredentialSchema = z.object({
  apiKey: z.string().min(1),
  secretKey: z.string().min(1),
  passphrase: z.string().min(1),
  /**
   * Demo vs live. Agentic execution against LIVE is a separate authorization
   * and is not reachable from this module — see `AgenticRouteSchema`.
   */
  route: z.enum(["demo", "live"]),
});
export type AgenticCredential = z.infer<typeof AgenticCredentialSchema>;

export const AgenticRouteSchema = z.enum(["demo"]);
export type AgenticRoute = z.infer<typeof AgenticRouteSchema>;

export class AgenticExecutionDisabledError extends Error {
  readonly enableEnvVar = AGENTIC_ENABLE_ENV;
  constructor() {
    super(
      `Agentic execution is disabled. Set ${AGENTIC_ENABLE_ENV}=true to enable. ` +
        "This gate is fail-closed by design.",
    );
    this.name = "AgenticExecutionDisabledError";
  }
}

export interface AgenticCredentialSource {
  readonly descriptor: { id: string; authority: "credential_supplier"; version: string };
  /** Throws AgenticExecutionDisabledError unless explicitly enabled. */
  load(): Promise<AgenticCredential>;
}

/**
 * Build a credential source backed by environment variables.
 *
 * Reads only Agentic-scoped variables. It will NOT fall back to the exchange
 * Demo credential variables — those belong to the Demo adapter and must not
 * silently cross credential domains. (Named in code only; never in prose, so
 * the repository secret scanner cannot mistake a comment for a leak.)
 */
export function createEnvAgenticCredentialSource(
  env: NodeJS.ProcessEnv = process.env,
): AgenticCredentialSource {
  return {
    descriptor: {
      id: "agentic-env-credential-source",
      authority: "credential_supplier",
      version: "1",
    },
    async load(): Promise<AgenticCredential> {
      if (!isAgenticExecutionEnabled(env)) {
        throw new AgenticExecutionDisabledError();
      }
      const parsed = AgenticCredentialSchema.safeParse({
        apiKey: env["AGENTIC_API_KEY"] ?? "",
        secretKey: env["AGENTIC_SECRET_KEY"] ?? "",
        passphrase: env["AGENTIC_PASSPHRASE"] ?? "",
        route: (env["AGENTIC_ROUTE"] ?? "demo") as "demo" | "live",
      });
      if (!parsed.success) {
        throw new Error(
          "Agentic credentials invalid or incomplete: check AGENTIC_API_KEY / " +
            "AGENTIC_SECRET_KEY / AGENTIC_PASSPHRASE",
        );
      }
      // Only the demo route is wired. Live requires its own review.
      if (parsed.data.route !== "demo") {
        throw new Error(
          "Agentic route 'live' is not wired. Only 'demo' is permitted by this module.",
        );
      }
      return parsed.data;
    },
  };
}

/**
 * Convert credentials into a BitgetClient for the Money Boys dispatcher.
 *
 * `demoTrading: true` routes through the same base URL with the `paptrading: 1`
 * header. This is the ONLY construction path from an Agentic credential to a
 * venue client, and it returns a client — never an order.
 */
export async function toBitgetClientForAgentic(
  source: AgenticCredentialSource,
  baseUrl?: string,
): Promise<BitgetClient> {
  const cred = await source.load();
  return new BitgetClient({
    apiKey: cred.apiKey,
    secretKey: cred.secretKey,
    passphrase: cred.passphrase,
    demoTrading: cred.route === "demo",
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });
}
