// GetAgent / Playbook artifact adapter (research input, NOT execution).
//
// A published Playbook is a strategy artifact. This adapter fetches it and
// binds provenance so Money Boys can reason about it. It deliberately has no
// publish, run, subscribe, or trade method — publication and execution remain
// out of scope and require explicit authorization.
//
// No credentials are accepted or stored by this adapter. Fetching a published
// artifact is a public read; upload/confirm/publish are authenticated control-
// plane calls that are NOT wired here.

import { z } from "zod";
import {
  PlaybookArtifactSchema,
  sealProvenance,
  verifyProvenance,
  type PlaybookArtifact,
} from "./contracts.js";

/**
 * Playbook identifiers are exchange-controlled strings. Bounded and
 * charset-restricted so an id can never be a path traversal or injection
 * payload when an implementation later builds a request from it.
 */
export const PlaybookIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, "playbook id must be alphanumeric with . _ : - only");
export const PlaybookVersionSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[0-9A-Za-z.+-]+$/, "playbook version must be a simple version string");
export type PlaybookId = z.infer<typeof PlaybookIdSchema>;
export type PlaybookVersion = z.infer<typeof PlaybookVersionSchema>;

/** Injectable transport; the default implementation performs no network I/O. */
export type PlaybookFetch = (args: {
  playbookId: PlaybookId;
  version: PlaybookVersion;
}) => Promise<unknown>;

export const PLAYBOOK_ADAPTER_ID = "getagent-playbook-artifact";

export class PlaybookValidationError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`playbook artifact rejected: ${reason}`);
    this.name = "PlaybookValidationError";
    this.reason = reason;
  }
}

/**
 * Validate an untrusted artifact payload and seal provenance over the artifact
 * body plus its identity fields.
 *
 * Throws `PlaybookValidationError` on bad identifiers or an un-shapeable
 * response. Callers are expected to treat any throw as "no artifact" — there
 * is no partial trust.
 */
export async function loadPlaybookArtifact(
  playbookId: string,
  version: string,
  fetchImpl: PlaybookFetch,
  nowIso: string,
): Promise<PlaybookArtifact> {
  const id = PlaybookIdSchema.safeParse(playbookId);
  if (!id.success) {
    throw new PlaybookValidationError("invalid playbook id");
  }
  const ver = PlaybookVersionSchema.safeParse(version);
  if (!ver.success) {
    throw new PlaybookValidationError("invalid playbook version");
  }

  let raw: unknown;
  try {
    raw = await fetchImpl({ playbookId: id.data, version: ver.data });
  } catch {
    throw new PlaybookValidationError("provider unavailable");
  }

  if (raw === null || typeof raw !== "object") {
    throw new PlaybookValidationError("artifact payload must be an object");
  }

  // Opaque to Money Boys: the artifact body is stored verbatim, but it is
  // hashed so tampering downstream is detectable.
  const provenance = sealProvenance(
    PLAYBOOK_ADAPTER_ID,
    { playbookId: id.data, version: ver.data, artifact: raw },
    nowIso,
  );

  return PlaybookArtifactSchema.parse({
    playbookId: id.data,
    version: ver.data,
    artifact: raw,
    source: PLAYBOOK_ADAPTER_ID,
    retrievedAt: nowIso,
    provenance,
  });
}

/**
 * Tamper guard. Returns false rather than throwing.
 *
 * Compares the STORED hash against the payload. It must not recompute the
 * expected hash from the payload under test.
 */
export function verifyPlaybookArtifact(a: PlaybookArtifact): boolean {
  const parsed = PlaybookArtifactSchema.safeParse(a);
  if (!parsed.success) return false;
  return verifyProvenance(
    {
      playbookId: parsed.data.playbookId,
      version: parsed.data.version,
      artifact: parsed.data.artifact,
    },
    parsed.data.provenance,
  );
}
