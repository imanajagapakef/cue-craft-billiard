/**
 * Policy loader — reads every CONFIGURABLE value from the `settings` table.
 *
 * Defaults live here and in docs/BUSINESS_DECISIONS.md. They are fallbacks, not
 * the source of truth: a seeded database overrides them. A missing or malformed
 * row falls back rather than throwing, because a settings typo must not take the
 * booking flow offline.
 */

import { db } from "./db.ts";
import type { DepositPolicy } from "./pricing.ts";

export type Settings = {
  venueName: string;
  depositPercent: number;
  depositMinIdr: number;
  depositRoundingIdr: number;
  holdDurationMinutes: number;
  graceMinutes: number;
  overageIncrementMinutes: number;
  bufferMinutes: number;
  cancelFreeUntilHours: number;
  noShowGraceMinutes: number;
  extensionIncrementsMinutes: number[];
  extensionMaxMinutes: number;
  qrisStaticPayload: string | null;
};

export const DEFAULT_SETTINGS: Settings = {
  venueName: "Cue & Rail Club",
  depositPercent: 30,
  depositMinIdr: 25_000,
  depositRoundingIdr: 1_000,
  holdDurationMinutes: 15,
  graceMinutes: 15,
  overageIncrementMinutes: 15,
  bufferMinutes: 10,
  cancelFreeUntilHours: 2,
  noShowGraceMinutes: 15,
  extensionIncrementsMinutes: [15, 30, 60],
  extensionMaxMinutes: 60,
  qrisStaticPayload: null,
};

export function depositPolicy(s: Settings): DepositPolicy {
  return {
    percent: s.depositPercent,
    minIdr: s.depositMinIdr,
    roundingIdr: s.depositRoundingIdr,
  };
}

let cached: { value: Settings; at: number } | null = null;
const TTL_MS = 30_000;

export async function getSettings(): Promise<Settings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const rows = await db.setting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const value: Settings = {
    venueName: str(map, "venue_name", DEFAULT_SETTINGS.venueName),
    depositPercent: num(map, "deposit_percent", DEFAULT_SETTINGS.depositPercent),
    depositMinIdr: num(map, "deposit_min_idr", DEFAULT_SETTINGS.depositMinIdr),
    depositRoundingIdr: num(map, "deposit_rounding_idr", DEFAULT_SETTINGS.depositRoundingIdr),
    holdDurationMinutes: num(map, "hold_duration_minutes", DEFAULT_SETTINGS.holdDurationMinutes),
    graceMinutes: num(map, "grace_minutes", DEFAULT_SETTINGS.graceMinutes),
    overageIncrementMinutes: num(
      map,
      "overage_increment_minutes",
      DEFAULT_SETTINGS.overageIncrementMinutes,
    ),
    bufferMinutes: num(map, "buffer_minutes", DEFAULT_SETTINGS.bufferMinutes),
    cancelFreeUntilHours: num(map, "cancel_free_until_hours", DEFAULT_SETTINGS.cancelFreeUntilHours),
    noShowGraceMinutes: num(map, "no_show_grace_minutes", DEFAULT_SETTINGS.noShowGraceMinutes),
    extensionIncrementsMinutes: intArray(
      map,
      "extension_increments_minutes",
      DEFAULT_SETTINGS.extensionIncrementsMinutes,
    ),
    extensionMaxMinutes: num(map, "extension_max_minutes", DEFAULT_SETTINGS.extensionMaxMinutes),
    qrisStaticPayload: strOrNull(map, "qris_static_payload"),
  };

  cached = { value, at: Date.now() };
  return value;
}

/** Called after a settings write so the next read sees it immediately. */
export function invalidateSettingsCache(): void {
  cached = null;
}

function str(map: Map<string, unknown>, key: string, fallback: string): string {
  const v = map.get(key);
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function strOrNull(map: Map<string, unknown>, key: string): string | null {
  const v = map.get(key);
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(map: Map<string, unknown>, key: string, fallback: number): number {
  const v = map.get(key);
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function intArray(map: Map<string, unknown>, key: string, fallback: number[]): number[] {
  const v = map.get(key);
  if (!Array.isArray(v)) return fallback;
  const ints = v.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return ints.length > 0 ? ints : fallback;
}