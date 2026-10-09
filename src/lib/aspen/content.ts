/**
 * Everything the Aspen convening page says, in one place, so the run of
 * show can change without touching components. The session: Aspen
 * Institute State Benefits Leadership Cohort, Phoenix, Monday, Oct 26,
 * 2026, a 90-minute reception that flows into the cohort dinner.
 *
 * Follows the session plan sent to Aspen on Oct 7: participants try the
 * problem before we name it, and the session builds to one idea: a single
 * set of open, validated rules changes what's possible for benefits
 * delivery. The copy avoids "tonight" and "this evening" (Ariel's notes).
 */

export const EVENT = {
  title: "What does AI tell your residents about benefits?",
  cohort: "Aspen Institute State Benefits Leadership Cohort",
  place: "Phoenix",
  date: "Monday, October 26, 2026",
  shortDate: "Oct 26",
  hosts: "Ariel Kennan and Max Ghenis, the Axiom Foundation",
  /** The participant URL shown on the big screen. */
  joinUrl: "axiom.org/aspen",
  contactEmail: "hello@axiom.org",
} as const;

export const STAGE_IDS = [
  "welcome",
  "try",
  "rate",
  "reveal",
  "scale",
  "foundation",
  "groups",
  "next",
  "dinner",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

/**
 * The red thread: each stage's summary picks up where the last one left
 * off, so the page reads as one story from the question residents already
 * ask to the states that go first. No clock times: the room sets the pace.
 * Copy stays short, so it reads at phone size.
 */
export interface Stage {
  id: StageId;
  label: string;
  title: string;
  /** One line for the agenda. */
  agenda: string;
  /** The thread: how this stage follows from the one before. */
  summary: string;
  /** Segments that depend on the room, e.g. on headcount. */
  optional?: boolean;
}

export const STAGES: readonly Stage[] = [
  {
    id: "welcome",
    label: "Welcome",
    title: "Welcome",
    agenda: "Aspen opens and introduces Ariel and Max.",
    summary: "Residents already ask AI about benefits. What does it tell them, and is it right?",
  },
  {
    id: "try",
    label: "Try it",
    title: "Ask the AI",
    agenda: "Ask the AI a benefits question, then rate the answer.",
    summary: "Ask what a resident would ask. Then rate the answer.",
  },
  {
    id: "rate",
    label: "Rate it",
    title: "How did AI do?",
    agenda: "Rate how AI did overall.",
    summary: "Rate the AI, and how AI has worked at your agency.",
  },
  {
    id: "reveal",
    label: "What we saw",
    title: "What we saw",
    agenda: "The room's results, then discussion.",
    summary: "Could a resident act on these answers?",
  },
  {
    id: "scale",
    label: "At scale",
    title: "AI gets it wrong at scale",
    agenda: "PolicyBench: 46 AI models on SNAP.",
    summary: "We asked 46 AI models to calculate SNAP for real households. Many told families who qualify they'd get $0.",
  },
  {
    id: "foundation",
    label: "Shared foundation",
    title: "A shared foundation",
    agenda: "One open set of rules for every tool.",
    summary: "Every tool rebuilds your rules on its own. One open, validated set gives them all the right answer.",
  },
  {
    id: "groups",
    label: "Small groups",
    title: "How would you use it?",
    agenda: "Vote on what to build first, then talk it through in groups.",
    summary: "With rules your team can see, test and change, what would you build first? Vote, then talk it through with your group.",
    optional: true,
  },
  {
    id: "next",
    label: "Next steps",
    title: "Next steps",
    agenda: "A short form for states that want to go further.",
    summary: "Tell us if your state wants to go further.",
  },
  {
    id: "dinner",
    label: "Thank you",
    title: "Thank you",
    agenda: "Thank you, then dinner.",
    summary: "Thank you for asking the question with us. Enjoy dinner.",
  },
];

export function stageIndex(id: string | null | undefined): number {
  return STAGE_IDS.indexOf(id as StageId);
}

export function isStageId(value: unknown): value is StageId {
  return typeof value === "string" && stageIndex(value) >= 0;
}

// ---------------------------------------------------------------------------
// Who the participant asks as
// ---------------------------------------------------------------------------

export const PERSPECTIVE_IDS = ["resident", "caseworker"] as const;
export type PerspectiveId = (typeof PERSPECTIVE_IDS)[number];

export const PERSPECTIVES: readonly {
  id: PerspectiveId;
  label: string;
  /** The word on the compact toggle. */
  short: string;
  description: string;
}[] = [
  {
    id: "resident",
    label: "A resident",
    short: "Resident",
    description: "Asking for yourself.",
  },
  {
    id: "caseworker",
    label: "A caseworker",
    short: "Caseworker",
    description: "Checking a client's case.",
  },
];

export function isPerspectiveId(value: unknown): value is PerspectiveId {
  return PERSPECTIVE_IDS.includes(value as PerspectiveId);
}

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

export function isUsState(value: unknown): value is (typeof US_STATES)[number] {
  return US_STATES.includes(value as (typeof US_STATES)[number]);
}

// ---------------------------------------------------------------------------
// Households and questions
// ---------------------------------------------------------------------------

/**
 * The household chips. Each one is a household the Axiom rules can
 * compute today (rulespec-us programs served by the gallery chatbot), so
 * "Check against the rules" has an answer for it. Arizona leads: the
 * convening is in Phoenix and Arizona DES is in the room. The first person and
 * client wordings are hand-written so every perspective reads naturally.
 */
export interface Household {
  id: string;
  label: string;
  /** One line under the chip. */
  blurb: string;
  state: string;
  program: string;
  /** Short program name used inside questions. */
  programShort: string;
  /** The resident speaking about themselves. */
  firstPerson: string;
  /** A caseworker describing the household. */
  thirdPerson: string;
  /** Why this household is on the list (shown to presenters only). */
  why: string;
  /** The resident speaks as "we", not "I". */
  plural?: boolean;
}

export const HOUSEHOLDS: readonly Household[] = [
  {
    id: "az-retiree",
    label: "Retiree in Phoenix",
    blurb: "67, lives alone, Social Security, $900 rent",
    state: "Arizona",
    program: "SNAP",
    programShort: "SNAP (food stamps)",
    firstPerson:
      "I live in Phoenix, Arizona. I'm 67 and I live alone. I get $1,200 a month from Social Security and I pay $900 a month in rent.",
    thirdPerson:
      "a 67-year-old in Phoenix, Arizona who lives alone, gets $1,200 a month from Social Security and pays $900 a month in rent",
    why: "Plain elderly household; the shelter deduction for elderly households has no cap.",
  },
  {
    id: "az-savings",
    label: "Disabled, with savings",
    blurb: "80, disability, pension, $58,700 in the bank",
    state: "Arizona",
    program: "SNAP",
    programShort: "SNAP (food stamps)",
    firstPerson:
      "I live in Phoenix, Arizona. I'm 80, I have a disability and I live alone. I get $1,978 a month from Social Security and $560 a month from a private pension. I have $58,700 in the bank.",
    thirdPerson:
      "an 80-year-old in Phoenix, Arizona with a disability who lives alone, gets $1,978 a month from Social Security and $560 a month from a pension, and has $58,700 in the bank",
    why: "PolicyBench: all 46 models said $0. Arizona's expanded categorical eligibility drops the asset test, so the household qualifies.",
  },
  {
    id: "ny-parent",
    label: "Working parent of two",
    blurb: "Kids 8 and 5, earns $2,078/mo, $1,300 rent",
    state: "New York",
    program: "SNAP",
    programShort: "SNAP (food stamps)",
    firstPerson:
      "I live in Buffalo, New York with my two kids, who are 8 and 5. I earn $2,078 a month at my job. Rent is $1,300 a month and I pay for heat separately.",
    thirdPerson:
      "a single parent in Buffalo, New York with two kids aged 8 and 5, who earns $2,078 a month, pays $1,300 a month in rent and pays for heat separately",
    why: "The gallery chatbot's SNAP showcase; earned income and shelter deductions both apply.",
  },
  {
    id: "ca-family",
    label: "Family of four",
    blurb: "Two parents, kids 6 and 4, earns $2,500/mo",
    state: "California",
    program: "SNAP",
    programShort: "CalFresh (SNAP)",
    plural: true,
    firstPerson:
      "We live in Fresno, California: me, my partner and our two kids, who are 6 and 4. Together we earn $2,500 a month. Rent is $1,800 a month and we pay for heat separately.",
    thirdPerson:
      "a family of four in Fresno, California (two parents, kids aged 6 and 4) earning $2,500 a month, paying $1,800 a month in rent and paying for heat separately",
    why: "CalFresh; high rent pushes the excess shelter deduction to its cap.",
  },
  {
    id: "md-tca",
    label: "Parent, no income",
    blurb: "Two kids, no income, needs cash help",
    state: "Maryland",
    program: "TCA",
    programShort: "cash assistance (TCA)",
    firstPerson:
      "I live in Baltimore, Maryland with my two kids. I lost my job and I have no income right now.",
    thirdPerson:
      "a single parent in Baltimore, Maryland with two kids and no income",
    why: "Maryland TCA maximum for a family of three: a plain model answered with the old $727; the rules say $773.",
  },
  {
    id: "ga-ctc",
    label: "Married, two kids, $95k",
    blurb: "Files jointly, kids 8 and 5",
    state: "Georgia",
    program: "CTC",
    programShort: "the Child Tax Credit",
    plural: true,
    firstPerson:
      "We're a married couple in Atlanta, Georgia with two kids, who are 8 and 5. We made $95,000 this year and we file jointly.",
    thirdPerson:
      "a married couple in Atlanta, Georgia with two kids aged 8 and 5, who made $95,000 this year and file jointly",
    why: "2026 Child Tax Credit: $2,200 per child, $4,400. Plain models still guess the pre-2025 or post-sunset amounts.",
  },
];

export function findHousehold(id: string | null | undefined): Household | undefined {
  return HOUSEHOLDS.find((h) => h.id === id);
}

export const QUESTION_IDS = ["amount", "eligible", "more", "cliff", "apply"] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

export const QUESTIONS: readonly { id: QuestionId; label: string }[] = [
  { id: "amount", label: "How much?" },
  { id: "eligible", label: "Eligible?" },
  { id: "more", label: "What else?" },
  { id: "cliff", label: "Earn more?" },
  { id: "apply", label: "How to apply?" },
];

/**
 * Details that make a household harder, each one a rule people often get
 * wrong. A detail adds one sentence in the participant's voice: `i` for a
 * resident alone, `we` for a resident speaking for the household, `they`
 * for a caseworker's client. `skip` lists households it would contradict.
 */
export interface Twist {
  id: string;
  label: string;
  i: string;
  we: string;
  they: string;
  skip?: readonly string[];
}

export const TWISTS: readonly Twist[] = [
  {
    id: "gig",
    label: "Gig income",
    i: "I also make about $400 a month driving for a delivery app.",
    we: "We also make about $400 a month driving for a delivery app.",
    they: "They also make about $400 a month driving for a delivery app.",
  },
  {
    id: "child-support",
    label: "Pays child support",
    i: "I pay $300 a month in child support for a child who doesn't live with me.",
    we: "One of us pays $300 a month in child support for a child who doesn't live with us.",
    they: "They pay $300 a month in child support for a child who doesn't live with them.",
  },
  {
    id: "student",
    label: "College student",
    i: "I'm also a part-time college student.",
    we: "One of us is a part-time college student.",
    they: "They're also a part-time college student.",
    skip: ["az-retiree", "az-savings"],
  },
  {
    id: "green-card",
    label: "Green card holder",
    i: "I've had a green card for two years.",
    we: "One of us has had a green card for two years.",
    they: "One adult in the household has had a green card for two years.",
  },
  {
    id: "medical",
    label: "Medical bills",
    i: "I pay about $250 a month out of pocket for medical care.",
    we: "We pay about $250 a month out of pocket for medical care.",
    they: "They pay about $250 a month out of pocket for medical care.",
  },
  {
    id: "utilities",
    label: "Pays utilities",
    i: "I also pay $180 a month for electricity and heat.",
    we: "We also pay $180 a month for electricity and heat.",
    they: "They also pay $180 a month for electricity and heat.",
    skip: ["ny-parent", "ca-family", "ga-ctc"],
  },
  {
    id: "savings",
    label: "Savings",
    i: "I have $8,000 in savings.",
    we: "We have $8,000 in savings.",
    they: "They have $8,000 in savings.",
    skip: ["az-savings"],
  },
  {
    id: "roommate",
    label: "Roommate",
    i: "I share an apartment with a roommate who buys and cooks food separately.",
    we: "We share our home with a roommate who buys and cooks food separately.",
    they: "They share an apartment with a roommate who buys and cooks food separately.",
  },
  {
    id: "pregnant",
    label: "Pregnant",
    i: "I'm also pregnant.",
    we: "One of us is pregnant.",
    they: "They're also pregnant.",
    skip: ["az-retiree", "az-savings"],
  },
];

export const TWIST_IDS = TWISTS.map((t) => t.id);

/** The details that make sense for a household, in display order. */
export function twistsFor(household: Household | undefined): readonly Twist[] {
  if (!household) return [];
  return TWISTS.filter((t) => !t.skip?.includes(household.id));
}

/** Tax credits are yearly; benefits are monthly. */
function isTaxCredit(h: Household): boolean {
  return h.program === "CTC" || h.program === "EITC";
}

function residentQuestion(q: QuestionId, h: Household): string {
  const I = h.plural ? "we" : "I";
  if (q === "eligible") return `Do ${I} qualify for ${h.programShort}?`;
  if (q === "more") return `What benefits can ${I} get, and how much would each one be?`;
  if (q === "apply") return `How do ${I} apply for ${h.programShort}, and what documents do ${I} need?`;
  if (q === "cliff") {
    return isTaxCredit(h)
      ? `If ${I} earn $10,000 more next year, how does ${h.programShort} change?`
      : `If ${I} earn $200 more a month, how much ${h.programShort} would ${I} lose?`;
  }
  return isTaxCredit(h)
    ? `How much will ${I} get from ${h.programShort} for 2026?`
    : `How much ${h.programShort} can ${I} get each month?`;
}

function clientQuestion(q: QuestionId, h: Household): string {
  if (q === "eligible") return `Does this household qualify for ${h.programShort}?`;
  if (q === "more") return `What benefits should I screen them for, and how much would each one be?`;
  if (q === "apply") return `How should they apply for ${h.programShort}, and what documents will they need?`;
  if (q === "cliff") {
    return isTaxCredit(h)
      ? `If they earn $10,000 more next year, how does ${h.programShort} change?`
      : `If they earn $200 more a month, how much ${h.programShort} would they lose?`;
  }
  return isTaxCredit(h)
    ? `How much ${h.programShort} should they get for 2026?`
    : `How much ${h.programShort} should they get each month?`;
}

/**
 * The prompt a perspective, household, details and question compose to.
 * The participant can edit it before sending; both versions are saved.
 */
export function composePrompt(
  perspective: PerspectiveId,
  household: Household,
  question: QuestionId,
  twistIds: readonly string[] = [],
): string {
  const details = twistsFor(household)
    .filter((t) => twistIds.includes(t.id))
    .map((t) => (perspective === "caseworker" ? t.they : household.plural ? t.we : t.i));
  const extra = details.length ? ` ${details.join(" ")}` : "";
  if (perspective === "resident") {
    return `${household.firstPerson}${extra} ${residentQuestion(question, household)}`;
  }
  return `I'm a caseworker in ${household.state}. My client is ${household.thirdPerson}.${extra} ${clientQuestion(question, household)}`;
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

export const VERDICTS = [
  { id: "right", label: "Looks right" },
  { id: "unsure", label: "Not sure" },
  { id: "wrong", label: "Looks wrong" },
] as const;
export type VerdictId = (typeof VERDICTS)[number]["id"];

export const WOULD_ACT = [
  { id: "yes", label: "Yes" },
  { id: "maybe", label: "Maybe" },
  { id: "no", label: "No" },
] as const;
export type WouldActId = (typeof WOULD_ACT)[number]["id"];

export const WENT_WELL = [
  "Plain and clear",
  "Gave a number",
  "Cited sources",
  "Asked good follow-ups",
  "Right program",
  "Pointed to other help",
  "Told me where to apply",
] as const;

export const WENT_WRONG = [
  "Wrong amount",
  "Wrong rule or limit",
  "Out of date",
  "Said I don't qualify",
  "Too vague",
  "No sources",
  "Missed a program",
  "Too long",
] as const;

/** What the participant thinks a resident would do with the answer: the harm question. */
export const RESIDENT_ACTIONS = [
  { id: "apply", label: "Apply" },
  { id: "not-apply", label: "Not apply" },
  { id: "call", label: "Call to check" },
  { id: "unsure", label: "Not sure" },
] as const;
export type ResidentActionId = (typeof RESIDENT_ACTIONS)[number]["id"];

/**
 * A baseline asked in Rate it, shown on Shared foundation: is there a
 * source of truth anyone can check answers against today?
 */
export const SOURCE_OF_TRUTH = {
  id: "source-of-truth",
  title: "Checking answers today",
  question: "Can a resident, a screener or an AI check an answer against your state's official rules today?",
  options: [
    { id: "yes", label: "Yes" },
    { id: "partly", label: "Partly" },
    { id: "no", label: "No" },
  ],
} as const;
export type SourceOfTruthId = (typeof SOURCE_OF_TRUTH.options)[number]["id"];

export const POST_CHECK = [
  { id: "match", label: "It matched" },
  { id: "close", label: "Close" },
  { id: "wrong", label: "It was wrong" },
] as const;
export type PostCheckId = (typeof POST_CHECK)[number]["id"];

// ---------------------------------------------------------------------------
// Discussion (What we saw) and small groups
// ---------------------------------------------------------------------------

export const DISCUSSION_QUESTIONS = [
  { id: "performance", label: "How well did the AI answers perform?" },
  { id: "experience", label: "How has your agency experienced AI so far, with clients and with staff?" },
  { id: "misunderstood", label: "Which policies do the public and caseworkers most often misunderstand?" },
] as const;
export type DiscussionQuestionId = (typeof DISCUSSION_QUESTIONS)[number]["id"];

/** A 1–5 scale for a discussion question: its heading in Rate it, what each category rates, and what the ends mean. */
export interface RatingScale {
  title: string;
  low: string;
  high: string;
  categories: readonly { id: string; label: string }[];
}

/**
 * The discussion questions people rate on a scale in Rate it; the third
 * (misunderstood policies) uses topic picks instead. Category labels are
 * short statements, so one scale (Not at all → Fully) reads for all of them.
 */
export const RATING_SCALES: Partial<Record<DiscussionQuestionId, RatingScale>> = {
  performance: {
    title: "How did the AI do?",
    low: "Not at all",
    high: "Fully",
    categories: [
      { id: "amount", label: "Got the amount right" },
      { id: "state-rules", label: "Knew your state's rules" },
      { id: "clarity", label: "Was clear to a resident" },
      { id: "sources", label: "Showed where the answer came from" },
      { id: "uncertainty", label: "Admitted what it didn't know" },
    ],
  },
  experience: {
    title: "How has AI worked out at your agency so far?",
    low: "Mostly a problem",
    high: "Mostly a help",
    categories: [
      { id: "residents", label: "For residents" },
      { id: "staff", label: "For your staff" },
    ],
  },
};

export const RATING_POINTS = [1, 2, 3, 4, 5] as const;

/** Quick picks for the "most often misunderstood" question. */
export const DISCUSSION_TOPICS = [
  "Categorical eligibility",
  "Asset tests",
  "Earned income deductions",
  "Shelter and utility costs",
  "Work requirements",
  "Immigrant eligibility",
  "Student rules",
  "Self-employment income",
  "Child support",
  "Who counts in the household",
  "Benefit cliffs",
  "Reporting and renewals",
] as const;

/** The uses people vote on before the small groups, from the session plan. */
export const USE_CASES = [
  {
    id: "see-edit",
    label: "See and edit the rules",
    detail: "Staff read the rules their programs run on, in plain language, and change them.",
  },
  {
    id: "project",
    label: "Project policy changes",
    detail: "See who a change would affect, and by how much, before it lands.",
  },
  {
    id: "flows",
    label: "Build caseworker flows",
    detail: "Ask only the questions a case needs, in the order the rules need them.",
  },
  {
    id: "apply",
    label: "Create application interfaces",
    detail: "New ways to apply, built on the same rules as the eligibility system.",
  },
] as const;
export type UseCaseId = (typeof USE_CASES)[number]["id"];

export const BREAKOUT_PROMPT =
  "How would your team use a tool that does this? Who would use it first, and what would have to be true for you to trust it?";

// ---------------------------------------------------------------------------
// PolicyBench
// ---------------------------------------------------------------------------

/**
 * SNAP figures from the PolicyBench dashboard export
 * (PolicyEngine/policybench, release dashboard-data-20260930, snapshot
 * 2026-09-30, version 1.1). "Eligible" = the 13 scored households whose
 * PolicyEngine reference SNAP is above $0; each of 46 models answered each
 * one with no tools, 591 parsed answers in all. "Said $0" = a prediction
 * of $0 or less. Failure causes are PolicyBench's own `failureSubtype`
 * annotations; "categorical_eligibility" covers broad-based categorical
 * eligibility (BBCE).
 */
export const POLICYBENCH = {
  snapshot: "September 30, 2026",
  url: "https://policybench.org",
  models: 46,
  eligibleHouseholds: 13,
  eligibleAnswers: 591,
  saidZero: 242,
  saidZeroBbce: 188,
  bestModelZeros: 2,
  /** The household every model got wrong (scenario_013). */
  azCase: {
    description:
      "An 80-year-old Arizonan with a disability, living alone on $2,538 a month from Social Security and a pension, with $58,700 in the bank.",
    modelsAsked: 46,
    modelsSaidZero: 46,
    answer:
      "Eligible. Income is under Arizona's expanded categorical eligibility limit (200% of poverty), so there is no asset test, and the household gets the minimum benefit of $24 a month.",
  },
} as const;

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((100 * part) / whole) : 0;
}

// ---------------------------------------------------------------------------
// The fix
// ---------------------------------------------------------------------------

export const ONE_SET_OF_RULES = [
  { label: "AI tools", detail: "The chatbots residents and staff already ask." },
  { label: "Community screeners", detail: "Partner tools that say what to apply for." },
  { label: "State systems", detail: "Eligibility, caseworker flows and notices." },
  { label: "Staff training", detail: "Training built on the rules themselves." },
  { label: "Policy changes", detail: "See the effect of a change before it lands." },
  { label: "Research", detail: "Evaluators and analysts run the same rules." },
] as const;

/**
 * What it takes for a state to get there: the validation ladder (Bronze,
 * Silver and Gold A) from the September plan decks, in plain language.
 * Draft for Ariel: the convening doc asks for one slide on what the
 * Golden A enables for a state and what it takes.
 */
export const GOLDEN_A = [
  {
    tier: "Bronze A",
    name: "Independent audit",
    gets: "An outside research firm checks a sample of your rules against the source documents and publishes what it finds.",
    takes: "Nothing from your team.",
  },
  {
    tier: "Silver A",
    name: "Validated with your state",
    gets: "Your rules, checked against your own manuals and your system's code. Every gap is found and explained. Any tool built on them gives the answer your agency would.",
    takes: "Your policy manuals, read access to how your system computes, and a few hours of your policy staff.",
  },
  {
    tier: "Gold A",
    name: "Your system runs on them",
    gets: "Your own eligibility system runs on the validated rules. A policy change updates every tool at once: the chatbot, the screener and your system.",
    takes: "Silver A, plus integration, operations and support to run in production.",
  },
] as const;

export const NEXT_STEPS = {
  ask: "We have the opportunity to solve this nationally. A few states validating their rules with us first will prove it.",
  options: [
    {
      id: "accurate_ai",
      label: "Accurate AI answers",
      detail: "AI tools that give residents and staff the right answer for your state.",
    },
    {
      id: "state_systems",
      label: "State systems",
      detail: "Your eligibility systems, screeners and caseworker tools on validated rules.",
    },
  ],
} as const;

/**
 * Shown with every AI answer: the answers are a demo of an unmodified
 * general-purpose model, and the model's maker has no part in the page.
 */
export const DEMO_NOTE = "A demo. Answers come from OpenAI's GPT model, unedited. OpenAI does not sponsor or endorse this page.";

export const DISCLOSURE = {
  short:
    "We'll look at everyone's answers together. They're saved, with no names on screen.",
  details: [
    "We don't ask for your name. Please don't type personal details about real people.",
    "Your questions go to OpenAI to get the AI's answer, and to the Axiom rules chatbot when you check against the rules.",
    "The Axiom Foundation keeps what you type to learn which rules are hardest to get right. The screen never shows who asked what.",
    "The next-steps form is the only place we ask for an email, and only to follow up with you.",
  ],
} as const;
