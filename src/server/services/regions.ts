import "server-only";
import { inArray, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { stateRegions } from "../db/schema";
import { writeAudit } from "../audit";
import { AppError, forbidden } from "../errors";
import type { Actor } from "../actor";
import { can } from "../rbac";
import { NIGERIAN_STATES, REGIONS, REGION_LABELS, type Region, type RegionMap } from "@/lib/constants";

/** Every state with its bank (null = not assigned to either bank yet). */
export async function getRegionMap(): Promise<RegionMap> {
  const rows = await getDb().select().from(stateRegions);
  const map: RegionMap = Object.fromEntries(NIGERIAN_STATES.map((s) => [s, null]));
  for (const r of rows) if (r.state in map) map[r.state] = r.region;
  return map;
}

/** SQL condition "this state column belongs to the given bank" — live, so reassignments apply everywhere. */
export function stateInRegion(col: AnyColumn | SQL, region: Region): SQL {
  return sql`${col} in (select ${stateRegions.state} from ${stateRegions} where ${stateRegions.region} = ${region})`;
}

const updateSchema = z.object({
  assignments: z.partialRecord(z.enum(NIGERIAN_STATES), z.enum(REGIONS).nullable()),
});

export async function updateRegionMap(actor: Actor, input: unknown): Promise<RegionMap> {
  if (!can(actor.role, "region:manage")) throw forbidden("Only administrators can change bank assignments.");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Invalid bank assignment.");
  const before = await getRegionMap();
  const changes = Object.entries(parsed.data.assignments).filter(([s, r]) => before[s] !== r) as [string, Region | null][];
  if (!changes.length) return before;
  await getDb().transaction(async (tx) => {
    const removals = changes.filter(([, r]) => r === null).map(([s]) => s);
    if (removals.length) await tx.delete(stateRegions).where(inArray(stateRegions.state, removals));
    for (const [state, region] of changes.filter(([, r]) => r !== null) as [string, Region][]) {
      await tx
        .insert(stateRegions)
        .values({ state, region, updatedBy: actor.id, updatedAt: new Date() })
        .onConflictDoUpdate({ target: stateRegions.state, set: { region, updatedBy: actor.id, updatedAt: new Date() } });
    }
    await writeAudit(tx, actor, {
      action: "REGIONS_UPDATED",
      entityType: "config",
      entityLabel: "State → bank assignment",
      oldValue: Object.fromEntries(changes.map(([s]) => [s, before[s] ? REGION_LABELS[before[s]!] : "Unassigned"])),
      newValue: Object.fromEntries(changes.map(([s, r]) => [s, r ? REGION_LABELS[r] : "Unassigned"])),
    });
  });
  return getRegionMap();
}

