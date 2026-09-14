import styles from "./core-execution-path.module.css";

const steps = [
  {
    title: "Select the source",
    owner: "Caller",
    artifact: "Candidate + dependencies",
    description:
      "Choose a candidate RuleSpec file and every dependency module explicitly. The caller supplies the root and module targets.",
    boundary: "No automatic dependency inference.",
  },
  {
    title: "Export exact bytes",
    owner: "axiom-encode",
    artifact: "BuildSpec",
    description:
      "The export command preserves the source text in a bounded JSON file and reports its digest. It does not parse, repair, or compile the RuleSpec.",
    boundary: "Assurance: unvalidated_candidate",
  },
  {
    title: "Build and verify",
    owner: "axiom-core + rules engine",
    artifact: "Unsigned bundle",
    description:
      "The pinned Axiom compiler builds the explicit module closure. The bundle retains sources and executable bytes. Offline verification checks the caller’s expected digest, engine identity, and a local rebuild.",
    boundary: "Assurance: development_unsigned",
  },
  {
    title: "Execute and explain",
    owner: "axiom-core + rules engine",
    artifact: "Execution receipt",
    description:
      "The real engine executes a strict native request. Optional rule pins change the scenario while preserving the stored baseline. CLI and Python return the full native result, metadata, and explanation traces.",
    boundary: "Private context + native response",
  },
];

const planned = [
  {
    title: "Signed source intake",
    description:
      "Connect core bundles to the existing signed corpus releases and their source evidence.",
  },
  {
    title: "Independent workload",
    description:
      "Bind execution to separately authorized expected results and explicit comparison evidence.",
  },
  {
    title: "Admission and publication",
    description:
      "Record and sign admission decisions, then select the builds to publish.",
  },
];

export function CoreExecutionPath() {
  return (
    <div className={styles.diagram}>
      <div className={styles.legend}>
        <span className={styles.status}>Implemented</span>
        <span>Local development path · core + encoder</span>
      </div>
      <ol className={styles.path} aria-label="Implemented local execution path">
        {steps.map((step, index) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <p className={styles.owner}>{step.owner}</p>
            <h3 className={styles.title}>{step.title}</h3>
            <p className={styles.artifact}>{step.artifact}</p>
            <p className={styles.description}>{step.description}</p>
            <p className={styles.boundary}>{step.boundary}</p>
          </li>
        ))}
      </ol>
      <p className={styles.limit}>
        A matching digest establishes integrity against the caller’s expected
        bytes. It does not authenticate an author, establish legal correctness,
        or admit a candidate for publication. Keep the original CLI binary and
        private input data for replay; receipts contain private context and traces.
      </p>
      <div className={styles.future}>
        <div className={styles.legend}>
          <span className={styles.plannedStatus}>Planned integration</span>
          <span>Beyond this local checkpoint</span>
        </div>
        <ol className={styles.planned} aria-label="Planned admission and publication path">
          {planned.map((step) => (
            <li key={step.title}>
              <h3 className={styles.plannedTitle}>{step.title}</h3>
              <p className={styles.description}>{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
