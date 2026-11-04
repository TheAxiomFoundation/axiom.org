import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  removeStaleRows,
  replaceRuleCitations,
  WRITE_RETRY_DELAYS_MS,
  writeWithRetries,
} from "./rulespec-index-writes.mjs";

const quiet = { warn: () => {} };
const noSleep = () => Promise.resolve();

/** A PostgREST stand-in that records each finished call and answers it
 *  from a queue of responses per table and verb. */
function fakeSupabase(answers: Record<string, Array<{ error?: unknown; count?: number }>> = {}) {
  const calls: Array<{ table: string; verb: string; args: unknown[] }> = [];
  const answer = (key: string) => (answers[key]?.length ? answers[key].shift()! : { error: null });
  const client = {
    from(table: string) {
      return {
        delete(options?: unknown) {
          const filters: unknown[] = [];
          const finish = (verb: string, args: unknown[]) => {
            filters.push([verb, ...args]);
            calls.push({ table, verb: "delete", args: [options, ...filters] });
            return Promise.resolve(answer(`${table}.delete`));
          };
          return {
            in: (...args: unknown[]) => finish("in", args),
            lt: (...args: unknown[]) => finish("lt", args),
          };
        },
        upsert(rows: unknown[], options: unknown) {
          calls.push({ table, verb: "upsert", args: [rows, options] });
          return Promise.resolve(answer(`${table}.upsert`));
        },
      };
    },
  };
  return { client, calls };
}

describe("writeWithRetries", () => {
  it("resolves to the first successful response, after transient failures", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "502 Bad Gateway" } })
      .mockResolvedValueOnce({ error: { message: "ECONNRESET" } })
      .mockResolvedValueOnce({ error: null, count: 3 });
    const sleep = vi.fn(noSleep);
    await expect(writeWithRetries("w", run, { sleep, log: quiet })).resolves.toEqual({
      error: null,
      count: 3,
    });
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(WRITE_RETRY_DELAYS_MS.slice(0, 2));
  });

  it("fails closed once every attempt has failed", async () => {
    const run = vi.fn().mockResolvedValue({ error: { message: "statement timeout" } });
    await expect(
      writeWithRetries("stale-row cleanup", run, { sleep: noSleep, log: quiet }),
    ).rejects.toThrow("stale-row cleanup failed after 5 attempts: statement timeout");
    expect(run).toHaveBeenCalledTimes(WRITE_RETRY_DELAYS_MS.length + 1);
  });

  it("makes exactly min(failures + 1, attempts) calls, and succeeds iff failures < attempts", async () => {
    const attempts = WRITE_RETRY_DELAYS_MS.length + 1;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: attempts + 3 }), async (failures) => {
        let calls = 0;
        const run = async () => (++calls <= failures ? { error: { message: "x" } } : { error: null });
        const outcome = await writeWithRetries("w", run, { sleep: noSleep, log: quiet }).then(
          () => "ok",
          () => "failed",
        );
        expect(calls).toBe(Math.min(failures + 1, attempts));
        expect(outcome).toBe(failures < attempts ? "ok" : "failed");
      }),
      { seed: 215, numRuns: 50 },
    );
  });
});

describe("removeStaleRows", () => {
  it("retries each cleanup delete and reports both counts", async () => {
    const { client, calls } = fakeSupabase({
      "rulespec_files.delete": [{ error: { message: "502" } }, { count: 4 }],
      "rule_citations.delete": [{ error: { message: "reset" } }, { error: { message: "reset" } }, { count: 9 }],
    });
    const write = (label: string, run: () => Promise<unknown>) =>
      writeWithRetries(label, run as never, { sleep: noSleep, log: quiet });
    await expect(removeStaleRows(client, "2026-11-02T00:00:00Z", { write })).resolves.toEqual({
      files: 4,
      ruleCitations: 9,
    });
    expect(calls.filter((c) => c.table === "rulespec_files")).toHaveLength(2);
    expect(calls.filter((c) => c.table === "rule_citations")).toHaveLength(3);
    for (const call of calls) {
      expect(call.args).toEqual([{ count: "exact" }, ["lt", "synced_at", "2026-11-02T00:00:00Z"]]);
    }
  });

  it("rejects when a cleanup delete keeps failing", async () => {
    const { client } = fakeSupabase({
      "rule_citations.delete": Array(5).fill({ error: { message: "down" } }),
    });
    const write = (label: string, run: () => Promise<unknown>) =>
      writeWithRetries(label, run as never, { sleep: noSleep, log: quiet });
    await expect(removeStaleRows(client, "t", { write })).rejects.toThrow(
      "stale rule citation cleanup failed after 5 attempts: down",
    );
  });
});

describe("replaceRuleCitations", () => {
  const file = (path: string, rules: string[]) => ({
    fileRow: { citation_path: path },
    ruleCitationRows: rules.map((rule_name) => ({
      citation_path: "us/statute/7/2017/a",
      module_citation_path: path,
      rule_name,
    })),
  });

  it("resets each module batch before upserting its rows, including modules that now cite nothing", async () => {
    const { client, calls } = fakeSupabase();
    const indexed = [file("us/m/a", ["r1", "r2"]), file("us/m/b", []), file("us/m/c", ["r3"])];
    const upserted = await replaceRuleCitations(client, indexed, {
      write: (_label: string, run: () => Promise<unknown>) => run(),
      moduleChunkSize: 2,
      rowChunkSize: 200,
      chunkBudgetBytes: 700_000,
    });
    expect(upserted).toBe(3);
    expect(calls.map((c) => [c.verb, c.verb === "delete" ? c.args[1] : (c.args[0] as unknown[]).length])).toEqual([
      ["delete", ["in", "module_citation_path", ["us/m/a", "us/m/b"]]],
      ["upsert", 2],
      ["delete", ["in", "module_citation_path", ["us/m/c"]]],
      ["upsert", 1],
    ]);
  });

  it("retries a failed reset before it writes that batch", async () => {
    const { client, calls } = fakeSupabase({ "rule_citations.delete": [{ error: { message: "502" } }] });
    await replaceRuleCitations(client, [file("us/m/a", ["r1"])], {
      write: (label: string, run: () => Promise<unknown>) =>
        writeWithRetries(label, run as never, { sleep: noSleep, log: quiet }),
      moduleChunkSize: 25,
      rowChunkSize: 200,
      chunkBudgetBytes: 700_000,
    });
    expect(calls.map((c) => c.verb)).toEqual(["delete", "delete", "upsert"]);
  });

  it("upserts every row exactly once, after its module's reset (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 0, maxLength: 12 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 4 }),
        async (ruleCounts, moduleChunkSize, rowChunkSize) => {
          const indexed = ruleCounts.map((n, i) =>
            file(`us/m/${i}`, Array.from({ length: n }, (_, j) => `r${i}_${j}`)),
          );
          const { client, calls } = fakeSupabase();
          const upserted = await replaceRuleCitations(client, indexed, {
            write: (_label: string, run: () => Promise<unknown>) => run(),
            moduleChunkSize,
            rowChunkSize,
            chunkBudgetBytes: 700_000,
          });
          const total = ruleCounts.reduce((a, b) => a + b, 0);
          expect(upserted).toBe(total);
          const reset = new Set<string>();
          const written: string[] = [];
          for (const call of calls) {
            if (call.verb === "delete") {
              for (const path of (call.args[1] as [string, string, string[]])[2]) reset.add(path);
            } else {
              for (const row of call.args[0] as Array<{ module_citation_path: string; rule_name: string }>) {
                expect(reset.has(row.module_citation_path)).toBe(true);
                written.push(row.rule_name);
              }
            }
          }
          expect(reset.size).toBe(indexed.length);
          expect(written).toHaveLength(total);
          expect(new Set(written).size).toBe(total);
        },
      ),
      { seed: 215, numRuns: 100 },
    );
  });
});
