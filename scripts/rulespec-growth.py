#!/usr/bin/env python3
"""Daily cumulative time series of RuleSpec rule files across TheAxiomFoundation rulespec-* repos.

Counts, for every rulespec-* repo in the org, the number of RuleSpec rule files
(*.yaml/*.yml with a 'statutes', 'regulations', or 'policies' path component,
excluding *.test.yaml companion tests and hidden directories) on every day of the
origin default branch's first-parent history, and writes a sparse step-interpolated
daily series to data/rulespec-growth.json.

Exactness guarantee: the per-repo series is reconstructed from
`git log --first-parent --no-renames --name-status -z` (renames surface as D+A, so
the running set of live paths telescopes exactly to the branch tip), and the script
HARD-FAILS unless the reconstructed final set is set-equal to today's
`git ls-tree -r <origin default head>` filtered by the same predicate, per repo.
No estimates, no hand adjustments.

Usage:
  scripts/rulespec-growth.py [--org ORG] [--mirror-root DIR] [--cache-root DIR] [--out FILE]

Requires: git, gh (authenticated for the org). Read-only: local mirrors are only
ever `git fetch`ed; missing repos are cloned blob-less into --cache-root.
"""

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path

RULE_DIRS = {"statutes", "regulations", "policies"}
TEST_SUFFIXES = (".test.yaml", ".test.yml")
RULE_EXTS = (".yaml", ".yml")

# Kind classification: provision-rooted encodings (statutes/, regulations/) vs
# composed policy modules (policies/). A dedup key's subpath always begins with its
# bucket directory (see rule_key), so kind is a pure function of the key — the same
# rule can never collide across kinds.
KIND_OF = {"statutes": "provision", "regulations": "provision", "policies": "policy"}
KINDS = ("provision", "policy")


def key_kind(key):
    return KIND_OF[key[1].split("/", 1)[0]]


def is_rule_file(path: str) -> bool:
    """A RuleSpec rule file: yaml under a statutes/regulations/policies component,
    not a *.test.yaml companion, not under any hidden ('.'-prefixed) directory
    (.github CI, .axiom encoding-manifest metadata, etc.)."""
    if not path.endswith(RULE_EXTS):
        return False
    if path.endswith(TEST_SUFFIXES):
        return False
    parts = path.split("/")
    if any(p.startswith(".") for p in parts[:-1]):
        return False
    return any(p in RULE_DIRS for p in parts[:-1])


def run(args, cwd=None, check=True, binary=False):
    res = subprocess.run(args, cwd=cwd, capture_output=True, check=False)
    if check and res.returncode != 0:
        raise RuntimeError(
            f"command failed ({res.returncode}): {' '.join(map(str, args))}\n{res.stderr.decode(errors='replace')}"
        )
    if binary:
        return res.stdout
    return res.stdout.decode(errors="surrogateescape")


def git(repo_dir, *args, binary=False, check=True):
    # --no-replace-objects: immune to local `git replace` refs in mirrors.
    return run(["git", "--no-replace-objects", "-C", str(repo_dir), *args], check=check, binary=binary)


def list_repos(org):
    out = run(["gh", "repo", "list", org, "--limit", "200", "--json", "name", "-q", ".[].name"])
    return sorted(n for n in out.split() if n.startswith("rulespec-"))


def locate_repo(org, name, mirror_root, cache_root, log):
    """Return a git dir for `name`, fetching only. Never modifies mirrors beyond fetch."""
    mirror = mirror_root / name
    want = re.compile(rf"github\.com[:/]{re.escape(org)}/{re.escape(name)}(\.git)?/?$", re.I)
    if (mirror / ".git").exists() or (mirror / "HEAD").exists():
        try:
            url = git(mirror, "remote", "get-url", "origin").strip()
            shallow = git(mirror, "rev-parse", "--is-shallow-repository").strip()
            if want.search(url) and shallow == "false":
                return mirror
            log(f"  {name}: local mirror unsuitable (url={url!r} shallow={shallow}); using cache clone")
        except RuntimeError as e:
            log(f"  {name}: local mirror unusable ({e}); using cache clone")
    cache_root.mkdir(parents=True, exist_ok=True)
    clone = cache_root / name
    if not (clone / ".git").exists():
        run(["gh", "repo", "clone", f"{org}/{name}", str(clone), "--",
             "--filter=blob:none", "--no-checkout", "--quiet"])
    return clone


def default_branch_head(repo_dir):
    """(branch, sha) of the ORIGIN default branch (never local main), or None if empty."""
    out = git(repo_dir, "ls-remote", "--symref", "origin", "HEAD")
    m = re.search(r"^ref:\s+refs/heads/(\S+)\s+HEAD$", out, re.M)
    if not m:
        return None
    branch = m.group(1)
    git(repo_dir, "fetch", "--quiet", "origin", branch)
    sha = git(repo_dir, "rev-parse", "FETCH_HEAD^{commit}").strip()
    return branch, sha


def rule_key(repo_name, path):
    """Deduplication key: (jurisdiction, path below the statutes/regulations/policies root).

    Monorepos prefix rule paths with a jurisdiction directory (us/, us-co/, uk/, ...);
    satellite repos (rulespec-us-co, ...) keep statutes/ etc. at the top level and carry
    the jurisdiction in the repo name. The same encoded rule therefore maps to the same
    key wherever it lives, which is what lets us count mirrored rules once."""
    parts = path.split("/")
    idx = next(i for i, c in enumerate(parts) if c in RULE_DIRS)
    if idx == 0:
        return (repo_name.removeprefix("rulespec-"), path)
    return ("/".join(parts[:idx]), "/".join(parts[idx:]))


def mine_repo(repo_dir, sha):
    """Walk first-parent history root->tip tracking the live set of rule files.

    Returns (events, final_set, n_clamped) where events = [(unix_ts, count_after_commit,
    [(+1|-1, path), ...])] for commits that changed the count (set-transition deltas, so
    +1/-1 are exactly balanced per path), with timestamps clamped non-decreasing.
    """
    raw = git(repo_dir, "-c", "log.showRoot=true", "log", "--first-parent", "--no-renames",
              "--name-status", "-z", "--format=%x01%H %ct", sha, binary=True)
    tokens = raw.split(b"\x00")
    commits = []  # (ts, [(status, path), ...]) tip -> root
    cur = None
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok.startswith(b"\x01"):
            header = tok[1:].decode()
            _sha, ts = header.split()
            cur = (int(ts), [])
            commits.append(cur)
            i += 1
            continue
        status = tok.strip().decode(errors="surrogateescape")
        if status == "":
            i += 1
            continue
        if cur is None or i + 1 >= len(tokens):
            raise RuntimeError(f"unparseable log stream near token {i}: {tok!r}")
        if status[0] not in "ADMTUX" or len(status) > 2:
            raise RuntimeError(f"unexpected diff status {status!r} (rename/copy despite --no-renames?)")
        path = tokens[i + 1].decode(errors="surrogateescape")
        cur[1].append((status[0], path))
        i += 2

    live = set()
    events = []
    prev_ts = None
    n_clamped = 0
    for ts, changes in reversed(commits):  # root -> tip
        if prev_ts is not None and ts < prev_ts:
            ts = prev_ts
            n_clamped += 1
        prev_ts = ts
        before = len(live)
        deltas = []
        for status, path in changes:
            if not is_rule_file(path):
                continue
            if status == "D":
                if path in live:
                    live.discard(path)
                    deltas.append((-1, path))
            else:  # A, M, T, (U/X never in committed history)
                if path not in live:
                    live.add(path)
                    deltas.append((+1, path))
        # Record any commit that touched rule files (even count-neutral moves, whose
        # key deltas matter for deduplication), plus the root commit as a zero anchor.
        if deltas or not events:
            events.append((ts, len(live), deltas))
        del before
    return events, live, n_clamped


def tree_rule_set(repo_dir, sha):
    raw = git(repo_dir, "ls-tree", "-r", "-z", "--name-only", sha, binary=True)
    return {p.decode(errors="surrogateescape") for p in raw.split(b"\x00") if p and is_rule_file(p.decode(errors="surrogateescape"))}


def to_day(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).date().isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--org", default="TheAxiomFoundation")
    ap.add_argument("--mirror-root", default=str(Path.home() / "TheAxiomFoundation"))
    ap.add_argument("--cache-root", default=os.environ.get("RULESPEC_GROWTH_CACHE",
                    str(Path.home() / ".cache" / "rulespec-growth")))
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "rulespec-growth.json"))
    args = ap.parse_args()
    log = lambda *a: print(*a, file=sys.stderr, flush=True)

    today = dt.datetime.now(dt.timezone.utc).date()
    repos_out, skipped, day_maps = {}, [], {}
    tree_keys, global_events = {}, []
    total_clamped = 0

    names = list_repos(args.org)
    log(f"{len(names)} rulespec-* repos in {args.org}")

    for name in names:
        try:
            repo_dir = locate_repo(args.org, name, Path(args.mirror_root).expanduser(), Path(args.cache_root).expanduser(), log)
            head = default_branch_head(repo_dir)
        except RuntimeError as e:
            skipped.append(name)
            log(f"  {name}: SKIPPED ({str(e).splitlines()[0]})")
            continue
        if head is None:
            skipped.append(name)
            log(f"  {name}: SKIPPED (empty repo, no default branch)")
            continue
        branch, sha = head
        events, final_set, n_clamped = mine_repo(repo_dir, sha)
        total_clamped += n_clamped

        # MANDATORY endpoint verification: reconstruction must equal today's tree exactly.
        tree_set = tree_rule_set(repo_dir, sha)
        if final_set != tree_set:
            missing = sorted(tree_set - final_set)[:5]
            extra = sorted(final_set - tree_set)[:5]
            raise SystemExit(
                f"ENDPOINT MISMATCH in {name} @ {sha}: reconstructed {len(final_set)} vs tree {len(tree_set)}\n"
                f"  in tree but not reconstructed: {missing}\n  reconstructed but not in tree: {extra}"
            )

        day_map = {}
        for chain_idx, (ts, count, deltas) in enumerate(events):  # chain order; last value per day wins
            day_map[to_day(ts)] = count
            if deltas:
                global_events.append((ts, name, chain_idx, [(op, rule_key(name, p)) for op, p in deltas]))
        tree_keys[name] = {rule_key(name, p) for p in tree_set}
        if day_map and max(day_map) > (today + dt.timedelta(days=1)).isoformat():
            raise SystemExit(f"{name}: commit dated in the future ({max(day_map)}); refusing")
        day_maps[name] = day_map
        first_date = min((d for d, c in day_map.items() if c > 0), default=None)
        fkinds = {k: 0 for k in KINDS}
        for p in final_set:
            fkinds[key_kind(rule_key(name, p))] += 1
        # Per-kind endpoint check against this run's fresh ls-tree (tree_set == final_set
        # is already asserted above; kind is a pure function of path, so partition equality
        # follows — assert it explicitly anyway).
        tkinds = {k: 0 for k in KINDS}
        for p in tree_set:
            tkinds[key_kind(rule_key(name, p))] += 1
        if fkinds != tkinds or sum(fkinds.values()) != len(final_set):
            raise SystemExit(f"BY-KIND ENDPOINT MISMATCH in {name}: replayed {fkinds} vs tree {tkinds}")
        repos_out[name] = {
            "final_count": len(final_set),
            "final_count_by_kind": fkinds,
            "first_date": first_date,
            "default_branch": branch,
            "head_sha": sha,
            "series": sorted(day_map.items()),
        }
        log(f"  {name}: {len(final_set)} rule files, {len(events)} change-commits, first={first_date}, clamped={n_clamped}")

    # Merge per-repo step functions into the org-wide daily series.
    all_days = sorted({d for m in day_maps.values() for d in m})
    current = {name: 0 for name in day_maps}
    series, prev_total = [], None
    for day in all_days:
        for name, m in day_maps.items():
            if day in m:
                current[name] = m[day]
        total = sum(current.values())
        if total != prev_total:
            series.append({"date": day, "total": total})
            prev_total = total

    total_today = sum(r["final_count"] for r in repos_out.values())
    assert series and series[-1]["total"] == total_today, "series endpoint != sum of verified per-repo counts"

    # Deduplicated series: distinct (jurisdiction, rule-path) keys across all repos,
    # so a rule mirrored between a satellite repo and a monorepo subtree counts once.
    from collections import Counter
    refcount = Counter()
    dist = {k: 0 for k in KINDS}  # distinct keys currently live, by kind
    day_kind = {}                 # day -> (provision, policy) after last commit that day
    for ts, _name, _idx, deltas in sorted(global_events, key=lambda e: (e[0], e[1], e[2])):
        for op, key in deltas:
            pre = refcount[key]
            refcount[key] = pre + op
            if refcount[key] < 0:
                raise SystemExit(f"negative refcount for {key} — delta accounting bug")
            if pre == 0 and op == +1:
                dist[key_kind(key)] += 1
            elif pre == 1 and op == -1:
                dist[key_kind(key)] -= 1
        day_kind[to_day(ts)] = (dist["provision"], dist["policy"])
    # Endpoint verification, overall and per kind, against today's union of trees.
    replayed_distinct = {k for k, c in refcount.items() if c > 0}
    union_today = set().union(*tree_keys.values()) if tree_keys else set()
    if replayed_distinct != union_today:
        raise SystemExit(
            f"DISTINCT ENDPOINT MISMATCH: replayed {len(replayed_distinct)} vs today's union {len(union_today)}; "
            f"e.g. {sorted(union_today ^ replayed_distinct)[:4]}"
        )
    union_kind = Counter(key_kind(k) for k in union_today)
    if {k: union_kind.get(k, 0) for k in KINDS} != dist:
        raise SystemExit(f"DISTINCT BY-KIND ENDPOINT MISMATCH: replayed {dist} vs today's union {dict(union_kind)}")
    assert sum(1 for c in refcount.values() if c > 0) == sum(dist.values())

    series_distinct, series_distinct_by_kind = [], []
    prev_total, prev_pair = None, None
    for day in sorted(day_kind):
        prov, pol = day_kind[day]
        if prov + pol != prev_total:
            series_distinct.append({"date": day, "total": prov + pol})
            prev_total = prov + pol
        if (prov, pol) != prev_pair:
            series_distinct_by_kind.append({"date": day, "provision": prov, "policy": pol, "total": prov + pol})
            prev_pair = (prov, pol)
    # provision + policy == distinct total at every point, by-kind series consistent
    # with series_distinct on every date it has a point.
    assert all(p["provision"] + p["policy"] == p["total"] for p in series_distinct_by_kind)
    bykind_step = {p["date"]: p["total"] for p in series_distinct_by_kind}
    assert all(bykind_step[p["date"]] == p["total"] for p in series_distinct), "by-kind series diverges from series_distinct"
    total_today_distinct = len(union_today)
    total_today_by_kind = {k: union_kind.get(k, 0) for k in KINDS}
    assert series_distinct[-1]["total"] == total_today_distinct
    assert series_distinct_by_kind[-1]["provision"] == total_today_by_kind["provision"]
    assert series_distinct_by_kind[-1]["policy"] == total_today_by_kind["policy"]

    # Note satellite repos fully mirrored into a larger repo today.
    for name, ks in tree_keys.items():
        if not ks:
            continue
        containers = [o for o, oks in tree_keys.items() if o != name and len(oks) > len(ks) and ks <= oks]
        if containers:
            repos_out[name]["mirrored_into"] = max(containers, key=lambda o: len(tree_keys[o]))

    method = (
        "Rule file := *.yaml/*.yml with a path component 'statutes', 'regulations', or 'policies', "
        "excluding *.test.yaml/*.test.yml companion tests and any path under a hidden ('.'-prefixed) "
        "directory (.github CI, .axiom encoding-manifest metadata). Per repo, the live set of matching "
        "paths is replayed over the origin default branch's first-parent history "
        "(git log --first-parent --no-renames --name-status, committer dates in UTC), collapsed to one "
        "point per calendar day (last value that day); the series is sparse and step-interpolated "
        "(a day's value is the most recent point at or before it). Endpoint verified exactly: per repo, "
        "the replayed final set is set-equal to git ls-tree -r of today's origin default head under the "
        "same predicate; this primary method passed for every repo (no sampling fallback needed). "
        "Because every satellite repo's rules (13 rulespec-us-* states + rulespec-uk-kingston-upon-thames) "
        "are today fully mirrored inside the rulespec-us / rulespec-uk monorepo subtrees, 'series'/'total_today' "
        "(files summed across repos) double-count mirrored rules; 'series_distinct'/'total_today_distinct' "
        "count distinct (jurisdiction, rule-path) keys across all repos, verified the same way against the "
        "union of today's trees — use the distinct series for corpus-size claims. "
        "Kind split: files under statutes/ or regulations/ are 'provision' (provision-rooted encodings); "
        "files under policies/ are 'policy' (composed policy modules); the bucket directory is part of the "
        "dedup key, so kind is a pure function of the key, cross-kind collisions are structurally impossible, "
        "and series_distinct_by_kind/total_today_by_kind partition the distinct totals exactly "
        "(per-repo final_count_by_kind partitions raw file counts). "
        "Predecessor caveat: before RuleSpec, a legacy encoding format (*.rac; Dec 2025-Apr 2026 in "
        "rulespec-us and rulespec-uk, peaking around 278 files) was removed as 'legacy formula artifacts' "
        "on 2026-04-27 and is not counted here."
        + (f" Skipped (inaccessible or empty): {', '.join(skipped)}." if skipped else "")
        + (f" {total_clamped} commit dates clamped for monotonicity." if total_clamped else "")
    )

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "method": method,
        "repos": repos_out,
        "total_today": total_today,
        "total_today_distinct": total_today_distinct,
        "total_today_by_kind": total_today_by_kind,
        "series": series,
        "series_distinct": series_distinct,
        "series_distinct_by_kind": series_distinct_by_kind,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=1) + "\n")
    log(f"\ntotal_today={total_today} (files)  total_today_distinct={total_today_distinct} (deduped: "
        f"{total_today_by_kind['provision']} provision + {total_today_by_kind['policy']} policy)  "
        f"series_points={len(series)}/{len(series_distinct)}/{len(series_distinct_by_kind)}  "
        f"range={series[0]['date']}..{series[-1]['date']}  -> {out_path}")


if __name__ == "__main__":
    main()
