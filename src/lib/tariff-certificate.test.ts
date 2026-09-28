import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CERTIFICATE_COMMIT,
  CERTIFICATE_REPO_PATH,
  certificateDownloadPath,
  certificateUrl,
  describeCertificate,
  getCertificateStatus,
} from "./tariff-certificate";

const verdicts = (values: Record<string, boolean>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));
const notCertified = { state: "no", value: false };

// Byte identity with the pinned axiom-oracles commit runs only where that
// repository is checked out (local lane, not CI), like the schedule artifact.
const oraclesPath = process.env.AXIOM_ORACLES_PATH ?? `${process.env.HOME}/TheAxiomFoundation/axiom-oracles`;
const oraclesAvailable = (() => {
  if (!existsSync(oraclesPath)) return false;
  try {
    execFileSync("git", ["-C", oraclesPath, "cat-file", "-e", `${CERTIFICATE_COMMIT}^{commit}`]);
    return true;
  } catch {
    return false;
  }
})();

describe("tariff certificate status", () => {
  it("derives the rendered sentence from the vendored certificate", () => {
    const status = getCertificateStatus();
    expect(status.sentence).toBe("Exercised check passes; executable, conformance and closure do not.");
    expect(status.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(status.evaluatedRulespecCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("links a pinned commit, never a moving branch", () => {
    expect(certificateUrl).toBe(`https://github.com/TheAxiomFoundation/axiom-oracles/blob/${CERTIFICATE_COMMIT}/${CERTIFICATE_REPO_PATH}`);
    expect(CERTIFICATE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(`public${certificateDownloadPath}`)).toBe(true);
  });

  it("phrases passing and failing premises in display order", () => {
    expect(describeCertificate({ certified: notCertified, verdicts: verdicts({ conformant: false, exercised: true, executable: true, closed: false }) }).sentence)
      .toBe("Exercised and executable checks pass; conformance and closure do not.");
    expect(describeCertificate({ certified: notCertified, verdicts: verdicts({ conformant: false, exercised: false, executable: false, closed: false }) }).sentence)
      .toBe("No check passes; exercised, executable, conformance and closure do not.");
    expect(describeCertificate({ certified: notCertified, verdicts: verdicts({ conformant: true, exercised: true, executable: true, closed: false }) }).sentence)
      .toBe("Exercised, executable and conformance checks pass; closure does not.");
  });

  it("fails closed on a certified or malformed certificate", () => {
    const all = verdicts({ conformant: true, exercised: true, executable: true, closed: true });
    expect(() => describeCertificate({ certified: { state: "yes", value: true }, verdicts: all })).toThrow(/not certified/);
    expect(() => describeCertificate({ verdicts: all })).toThrow(/not certified/);
    expect(() => describeCertificate({ certified: notCertified, verdicts: { exercised: { value: true } } })).toThrow(/is not a boolean/);
  });

  it.skipIf(!oraclesAvailable)("vendors the certificate byte-for-byte from the pinned commit", () => {
    const upstream = execFileSync("git", ["-C", oraclesPath, "show", `${CERTIFICATE_COMMIT}:${CERTIFICATE_REPO_PATH}`]);
    expect(Buffer.compare(upstream, readFileSync(`public${certificateDownloadPath}`))).toBe(0);
  });
});
