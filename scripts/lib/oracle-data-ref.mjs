const ORACLE_REPO = "TheAxiomFoundation/axiom-oracles";

/**
 * Resolve once at the start of a collection run, then reuse the returned SHA
 * for all report requests. Only a missing oracle-data branch permits fallback;
 * authentication, rate-limit, transport, and malformed-response errors stop the
 * run before it can publish a fresh collection timestamp for stale reports.
 *
 * @returns {Promise<{ branch: "oracle-data" | "main", sha: string }>}
 */
export async function resolveOracleDataRef({
  fetch: fetchImpl = globalThis.fetch,
  headers = {},
  log = console.log,
} = {}) {
  /** @type {"oracle-data" | "main"} */
  let branch = "oracle-data";
  let response = await fetchBranch(branch);
  if (response.status === 404) {
    branch = "main";
    response = await fetchBranch(branch);
  }
  if (!response.ok) {
    throw new Error(
      `Could not resolve ${ORACLE_REPO} branch ${branch}: HTTP ${response.status}`,
    );
  }

  const data = await response.json();
  const sha = data?.commit?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Invalid commit SHA for ${ORACLE_REPO} branch ${branch}`);
  }

  log(`[oracle-data] Using ${ORACLE_REPO} ${branch} at ${sha}`);
  return { branch, sha };

  function fetchBranch(ref) {
    return fetchImpl(`https://api.github.com/repos/${ORACLE_REPO}/branches/${ref}`, {
      method: "GET",
      headers,
    });
  }
}
