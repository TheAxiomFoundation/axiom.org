"use client";

import {
  CircleCheck,
  CirclePause,
  CircleQuestionMark,
  CircleX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import styles from "./ops-dashboard.module.css";
import { relativeTime } from "./ops-dashboard";
import { Explain } from "./ops-pipeline";
import { gradeWorkflow, type WorkflowGrade, type WorkflowHealth } from "@/lib/axiom/workflow-health";

const GRADES: Record<WorkflowGrade, { icon: LucideIcon; word: string; className?: string }> = {
  ok: { icon: CircleCheck, word: "OK" },
  warning: { icon: TriangleAlert, word: "Warning", className: styles.healthWarning },
  failing: { icon: CircleX, word: "Failing", className: styles.healthFailing },
  off: { icon: CirclePause, word: "Off" },
  unknown: { icon: CircleQuestionMark, word: "Unknown" },
};

const CONCLUSION_WORDS: Record<string, string> = { success: "passed", failure: "failed" };
const conclusionWord = (conclusion: string) => CONCLUSION_WORDS[conclusion] ?? conclusion.replace(/_/g, " ");

export interface WorkflowChip {
  grade: WorkflowGrade;
  /** Running, waiting, the last run's age, off or unknown. */
  when: string;
  /** "N failed in 7 days"; null when none (or not counted). */
  failed: string | null;
  /** What it does, its grade's reason and its numbers, for the tooltip. */
  title: string;
}

/** What one chip says. */
export function workflowChip(workflow: WorkflowHealth, referenceMs: number): WorkflowChip {
  const { grade, reason } = gradeWorkflow(workflow, workflow.read, referenceMs);
  const read = workflow.read;
  const age = read?.last ? relativeTime(read.last.at, referenceMs) : null;
  const when = !read
    ? "unknown"
    : grade === "off"
      ? age
        ? `off · ${age}`
        : "off"
      : read.running && !read.running.waiting
        ? "running"
        : read.running
          ? "waiting"
          : (age ?? "no runs");
  const failed = !workflow.stateOnly && read?.week?.failed ? `${read.week.failed} failed in 7 days` : null;
  const facts = [`${workflow.does}.`, `${reason}.`];
  if (read?.last) facts.push(`Last run: ${conclusionWord(read.last.conclusion)}, ${relativeTime(read.last.at, referenceMs)}.`);
  if (read?.running) {
    facts.push(
      read.running.waiting
        ? "A run is waiting to start."
        : `A run is in progress, started ${relativeTime(read.running.at, referenceMs)}.`
    );
  }
  if (read?.week && !workflow.stateOnly) {
    const { runs, failed: failures, cancelled } = read.week;
    facts.push(`Last 7 days: ${runs} run${runs === 1 ? "" : "s"}, ${failures} failed, ${cancelled} cancelled.`);
  }
  return { grade, when, failed, title: facts.join(" ") };
}

/**
 * The workflows the pipeline depends on, one chip each: its grade (an icon
 * and a word, never color alone), its name, its last run's age, and its
 * failures in the last 7 days. A chip opens the workflow's runs on GitHub.
 */
export function WorkflowHealthStrip({
  workflows,
  referenceMs,
}: {
  workflows: WorkflowHealth[];
  referenceMs: number;
}) {
  if (workflows.length === 0) return null;
  return (
    <section aria-labelledby="ops-workflows-title" className={styles.health}>
      <div className={styles.healthHead}>
        <h2 id="ops-workflows-title" className={styles.healthLabel}>
          Workflows
        </h2>
        <Explain label="Workflows">
          <span>
            The GitHub workflows the pipeline depends on. Each shows how its last run ended, how long ago, and its
            failures in the last 7 days. Open one to see its runs.
          </span>
          <span>
            A check: the last run passed. A triangle: failures this week, a cancelled last run, or no run for longer
            than expected. A cross: the last run failed. A pause: turned off. A question mark: GitHub could not be
            read.
          </span>
          <span>
            &ldquo;Failed&rdquo; means only that the run ended in failure: it can still have done part of its work.
            Read from GitHub every few minutes.
          </span>
        </Explain>
      </div>
      <ul className={styles.healthChips}>
        {workflows.map((workflow) => {
          const chip = workflowChip(workflow, referenceMs);
          const { icon: Icon, word, className } = GRADES[chip.grade];
          return (
            <li key={`${workflow.repo}/${workflow.file}`}>
              <a
                href={workflow.url}
                target="_blank"
                rel="noreferrer"
                title={chip.title}
                data-grade={chip.grade}
                className={`${styles.healthChip} ${className ?? ""}`}
              >
                <Icon size={14} aria-hidden className={styles.healthIcon} />
                <span className="sr-only">{word}: </span>
                <span className={styles.healthName}>{workflow.label}</span>
                <span className={styles.healthWhen}>{chip.when}</span>
                {chip.failed && <span className={styles.healthFailed}>{chip.failed}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
