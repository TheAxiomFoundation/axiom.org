import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The certificate is vendored byte-for-byte from axiom-oracles at
// CERTIFICATE_COMMIT. The status sentence, the SHA-256 and the link all
// derive from that one file, so the page cannot state a verdict its linked
// certificate does not carry. Re-vendor with:
//   git -C ../axiom-oracles show <commit>:certificates/us-tariff-duty.json > public/downloads/us-tariff-duty.certificate.json
export const CERTIFICATE_COMMIT = "6dcf4ecc3b4a9d4cfadade5ea52b10f0c7981d75";
export const CERTIFICATE_REPO_PATH = "certificates/us-tariff-duty.json";
export const certificateUrl = `https://github.com/TheAxiomFoundation/axiom-oracles/blob/${CERTIFICATE_COMMIT}/${CERTIFICATE_REPO_PATH}`;
export const certificateDownloadPath = "/downloads/us-tariff-duty.certificate.json";

// Certificate premise key → the word the page uses for it, in display order.
const PREMISES = [
  ["exercised", "exercised"],
  ["executable", "executable"],
  ["conformant", "conformance"],
  ["closed", "closure"],
] as const;

export type TariffCertificate = {
  certified?: { state?: unknown; value?: unknown };
  verdicts?: Record<string, { value?: unknown; rulespec_commit?: unknown } | undefined>;
};

function joinList(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function describeCertificate(certificate: TariffCertificate) {
  // Certification is a public claim; a certificate in any other state needs
  // new copy chosen by a person, so the build fails instead of rendering.
  if (certificate.certified?.state !== "no" || certificate.certified?.value !== false) {
    throw new Error("tariff certificate is not in the 'not certified' state; update the status copy by hand");
  }
  const passing: string[] = [];
  const failing: string[] = [];
  for (const [key, label] of PREMISES) {
    const value = certificate.verdicts?.[key]?.value;
    if (typeof value !== "boolean") throw new Error(`tariff certificate verdict "${key}" is not a boolean`);
    (value ? passing : failing).push(label);
  }
  const passClause = passing.length === 0
    ? "No check passes"
    : `${capitalize(joinList(passing))} ${passing.length === 1 ? "check passes" : "checks pass"}`;
  const failClause = failing.length === 0 ? "" : `; ${joinList(failing)} ${failing.length === 1 ? "does" : "do"} not`;
  const evaluated = certificate.verdicts?.closed?.rulespec_commit;
  return {
    sentence: `${passClause}${failClause}.`,
    passing,
    failing,
    evaluatedRulespecCommit: typeof evaluated === "string" ? evaluated : undefined,
  };
}

let cachedBytes: Buffer | undefined;
function certificateBytes() {
  if (!cachedBytes) cachedBytes = readFileSync(resolve(process.cwd(), `public${certificateDownloadPath}`));
  return cachedBytes;
}

export function getCertificateStatus() {
  const bytes = certificateBytes();
  return {
    ...describeCertificate(JSON.parse(bytes.toString("utf8")) as TariffCertificate),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
