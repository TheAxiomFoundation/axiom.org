/** Shared scroll stops for the 3D scene, chapter links, and accessible story. */
export const JOURNEY_CHAPTERS = [
  {
    at: 0,
    label: "The library",
    title: "Start with the law itself.",
    text: "One volume in a much larger collection.",
  },
  {
    at: 0.14,
    label: "The volume",
    title: "Title 7, off the shelf.",
    text: "The source comes forward. Nothing is detached from it.",
  },
  {
    at: 0.3,
    label: "The provision",
    title: "Open to § 2017.",
    text: "The words that will become an executable rule.",
  },
  {
    at: 0.45,
    label: "The encoding",
    title: "From a passage to a rule.",
    text: "Typed, cited, and connected to the words it represents.",
  },
  {
    at: 0.59,
    label: "The verification",
    title: "A disagreement. A correction.",
    text: "Run, check, compare independently, and review. A failed check sends the rule back.",
  },
  {
    at: 0.81,
    label: "The connections",
    title: "One rule. Many programs.",
    text: "Shared dependencies become a common foundation for programs.",
  },
  {
    at: 1,
    label: "The whole",
    title: "The graph, growing.",
    text: "Every encoding adds to the network. The wider body of law is still ahead.",
  },
] as const;
export function chapterAt(p: number) {
  const bounds = [0.085, 0.235, 0.355, 0.5, 0.715, 0.885];
  const found = bounds.findIndex((end) => p < end);
  return found === -1 ? 6 : found;
}
export function verificationAt(p: number) {
  if (p < 0.515) return "run";
  if (p < 0.55) return "checks";
  if (p < 0.615) return "disagreement";
  if (p < 0.66) return "corrected";
  if (p < 0.69) return "compare";
  return "review";
}
