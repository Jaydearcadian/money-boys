/**
 * Append-only prediction / evaluation log sink.
 *
 * REUSES THE EXISTING OBSERVATION STREAM rather than introducing a second file.
 * The existing two `ObservationRecord` lines are never touched: new records are
 * appended after them, so their bytes are preserved exactly.
 *
 * DISCRIMINATION BY `recordType`
 *   Historical observation lines have NO `recordType` field. New lines carry
 *   `recordType: "PREDICTION"` or `"OUTCOME_EVALUATION"`. Readers must treat a
 *   missing `recordType` as the legacy observation shape. That is what makes
 *   byte-identity preservation possible without rewriting history.
 *
 * TAMPER EVIDENCE
 *   Each new record carries `previousRecordHash` — the `recordHash` of the line
 *   immediately above it (or the legacy line's own hash when appending after an
 *   observation). Rewriting or removing any earlier line therefore breaks the
 *   chain at the next reader.
 *
 * IDEMPOTENCE
 *   Appending a record whose `recordId` is already present writes nothing.
 *
 * NO AUTHORITY
 *   This sink cannot write a PAPER_DEMO_TRADING line, a phase transition, or an
 *   `executionEnabledAt`. Those are not part of any record type here.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson } from "./source-model.js";
import type { OutcomeEvaluationRecord } from "./outcome.js";
import type { PredictionRecord } from "./prediction.js";

export interface LegacyObservationLine {
  /** Legacy lines have no recordType. */
  recordId: string;
  [k: string]: unknown;
}

export type LogLine = PredictionRecord | OutcomeEvaluationRecord | LegacyObservationLine;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Raw line hashes, in file order. The linkage base for the next append. */
export function readLineHashes(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const parsed = JSON.parse(l) as LogLine;
      const withHash = parsed as { recordHash?: string; sourceEvidenceHash?: string };
      return withHash.recordHash ?? withHash.sourceEvidenceHash ?? sha256(l);
    });
}

/** Hash of the last line, or null for an empty/absent log. */
export function tailHash(path: string): string | null {
  const hashes = readLineHashes(path);
  return hashes.length === 0 ? null : hashes[hashes.length - 1]!;
}

export function readLogLines(path: string): LogLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LogLine);
}

export function readPredictions(path: string): PredictionRecord[] {
  return readLogLines(path).filter((l): l is PredictionRecord => (l as { recordType?: string }).recordType === "PREDICTION");
}

export function readEvaluations(path: string): OutcomeEvaluationRecord[] {
  return readLogLines(path).filter(
    (l): l is OutcomeEvaluationRecord => (l as { recordType?: string }).recordType === "OUTCOME_EVALUATION",
  );
}

function alreadyPresent(path: string, recordId: string): boolean {
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(`"${recordId}"`);
}

/**
 * Append a prediction record, stamping the linkage from the current tail.
 *
 * Returns "appended" | "duplicate". A duplicate writes NOTHING — re-running an
 * identical prediction must not mutate or duplicate the stream.
 */
export function appendPrediction(
  record: Omit<PredictionRecord, "previousRecordHash">,
  path: string,
): { outcome: "appended" | "duplicate"; stored: PredictionRecord } {
  if (alreadyPresent(path, record.recordId)) {
    const existing = readPredictions(path).find((p) => p.recordId === record.recordId);
    return { outcome: "duplicate", stored: existing as PredictionRecord };
  }
  const stored = { ...record, previousRecordHash: tailHash(path) } as PredictionRecord;
  appendFileSync(path, JSON.stringify(stored) + "\n", "utf8");
  return { outcome: "appended", stored };
}

/** Append an outcome evaluation, stamping linkage from the current tail. */
export function appendEvaluation(
  record: Omit<OutcomeEvaluationRecord, "previousRecordHash">,
  path: string,
): { outcome: "appended" | "duplicate"; stored: OutcomeEvaluationRecord } {
  if (alreadyPresent(path, record.recordId)) {
    const existing = readEvaluations(path).find((e) => e.recordId === record.recordId);
    return { outcome: "duplicate", stored: existing as OutcomeEvaluationRecord };
  }
  const stored = { ...record, previousRecordHash: tailHash(path) } as OutcomeEvaluationRecord;
  appendFileSync(path, JSON.stringify(stored) + "\n", "utf8");
  return { outcome: "appended", stored };
}

/**
 * Verify the linkage chain. Returns the index of the first broken link, or
 * null when the chain is intact.
 */
export function verifyChain(path: string): number | null {
  const lines = readLogLines(path);
  let previous: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]! as { previousRecordHash?: string | null; recordHash?: string; sourceEvidenceHash?: string };
    if (line.previousRecordHash === undefined) {
      // Legacy observation line: it carries no linkage, so it cannot break one.
      previous = line.recordHash ?? line.sourceEvidenceHash ?? sha256(JSON.stringify(lines[i]));
      continue;
    }
    if (line.previousRecordHash !== previous) return i;
    previous = line.recordHash ?? sha256(JSON.stringify(lines[i]));
  }
  return null;
}

/** Canonical content hash, exported for tests and cross-checks. */
export function contentHash(value: unknown): string {
  return sha256(canonicalJson(value));
}