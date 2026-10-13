import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Everything kept between runs. One JSON file, so a GitHub Action can cache it. */
export interface State {
  version: 1;
  /** Fingerprint -> ISO time first seen. */
  seen: Record<string, string>;
  /** "tech:<domain>" -> sorted tech names; "page:<url>" -> page line hashes. */
  snapshots: Record<string, { at: string; items: string[] }>;
  runs: Array<{ at: string; calls: number; costMicros: number; found: number; new: number }>;
}

export const emptyState = (): State => ({ version: 1, seen: {}, snapshots: {}, runs: [] });

/** Reads the state file, or an empty state when there is none yet. */
export function loadState(path: string): State {
  if (!existsSync(path)) return emptyState();
  const s = JSON.parse(readFileSync(path, "utf8")) as Partial<State>;
  return { ...emptyState(), ...s, version: 1 };
}

/** Writes the state through a temp file, so a crash never leaves half a file. */
export function saveState(path: string, s: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(s, null, 2));
  renameSync(`${path}.tmp`, path);
}

/** Drops fingerprints older than `days` and keeps the last 200 runs, so the file stays small. */
export function prune(s: State, now: Date, days = 180): State {
  const cutoff = now.getTime() - days * 86_400_000;
  const seen = Object.fromEntries(Object.entries(s.seen).filter(([, at]) => new Date(at).getTime() >= cutoff));
  return { ...s, seen, runs: s.runs.slice(-200) };
}
