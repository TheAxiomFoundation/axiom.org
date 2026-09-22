import { CERTIFICATE_COMMIT, certificateDownloadPath, certificateUrl, getCertificateStatus } from "@/lib/tariff-certificate";
import { displayStatus } from "@/lib/tariff-coverage";
import { coverageBurndown, getTariffMetadata } from "@/lib/tariff-schedule";

export function TariffStatusBlock() {
  const metadata = getTariffMetadata();
  const certificate = getCertificateStatus();
  // Every artifact on the page must name the same certificate; a mismatch is a
  // stale download, so the render fails instead of showing two certificates.
  if (metadata.certificateSha256 !== certificate.sha256 || metadata.certificateCommit !== CERTIFICATE_COMMIT) {
    throw new Error("tariff-schedule.json names a different certificate than the vendored one; rerun bun run build:tariff-schedule");
  }
  const date = metadata.builtAt.slice(0, 10);
  const generated = new Date().toISOString().slice(0, 10);
  return (
    <section aria-labelledby="coverage-status" className="border-y border-[var(--color-rule)] py-6">
      <h2 id="coverage-status" className="m-0 font-body text-lg font-medium text-[var(--color-ink)]">Coverage status: incomplete and not certified.</h2>
      <p className="mt-2 mb-4 max-w-[780px] font-body text-sm leading-relaxed text-[var(--color-ink-secondary)]">
        {certificate.sentence} See the {" "}
        <a className="text-[var(--color-accent)] underline" href={certificateUrl} target="_blank" rel="noreferrer">machine-readable certificate</a> and named burndown.
      </p>
      <details>
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-wider text-[var(--color-accent)]">Named burndown</summary>
        <ul className="mt-4 grid gap-3 pl-5 text-sm text-[var(--color-ink-secondary)]">
          {coverageBurndown(metadata.coverageFamilies).map((row) => <li key={row.ledgerFamily}><strong className="text-[var(--color-ink)]">{row.family} — {displayStatus(row.status)}.</strong> {row.note}</li>)}
        </ul>
      </details>
      <p className="mt-5 mb-0 font-mono text-xs leading-relaxed text-[var(--color-ink-muted)]">
        Built from rulespec-us {metadata.rulespecCommit.slice(0, 10)} (source commit dated {date}; tariff encodings last changed on main {metadata.tariffEncodingsChangedAt.slice(0, 10)}), whose tariff encodings are identical to the certificate&apos;s evaluated commit {metadata.certificateRulespecCommit.slice(0, 10)}; rate text from axiom-corpus scope {metadata.corpusRelease} at {metadata.corpusCommit.slice(0, 10)}, which is not yet in a signed corpus release; page generated {generated}. Freshness is the source commit date, not a monitoring guarantee.
      </p>
      <p className="mt-2 mb-0 font-mono text-xs leading-relaxed text-[var(--color-ink-muted)]">
        Certificate SHA-256: {certificate.sha256}, from axiom-oracles {CERTIFICATE_COMMIT.slice(0, 10)}
        {certificate.evaluatedRulespecCommit ? `; it evaluates rulespec-us ${certificate.evaluatedRulespecCommit.slice(0, 10)}` : ""}.{" "}
        <a className="underline" href={certificateDownloadPath} download>Download certificate</a>
      </p>
    </section>
  );
}
