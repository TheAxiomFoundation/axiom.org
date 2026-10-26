/**
 * Everything the Aspen convening page says, in one place, so the run of
 * show can change without touching components. The session: Aspen
 * Institute State Benefits Leadership Cohort, Phoenix, Monday, Oct 26,
 * 2026, a 90-minute reception that flows into the cohort dinner.
 *
 * Follows the session plan sent to Aspen on Oct 7: participants try the
 * problem before we name it, and the session builds to one idea: a single
 * open set of rules that anyone can check changes what's possible for
 * benefits delivery. The copy avoids "tonight" and "this evening" (Ariel's notes).
 */

export const EVENT = {
  title: "What does AI tell residents about benefits?",
  cohort: "Aspen Institute State Benefits Leadership Cohort",
  place: "Phoenix",
  date: "Monday, October 26, 2026",
  shortDate: "Oct 26",
  /** On the cover slide, after the place. */
  coverDate: "October 26, 2026",
  hosts: "Ariel Kennan and Max Ghenis, the Axiom Foundation",
  /** The cover slide names the presenters, with the logo on its own line below. */
  presenters: "Ariel Kennan and Max Ghenis",
  /** The participant URL shown on the big screen. */
  joinUrl: "axiom.org/aspen",
  contactEmail: "hello@axiom.org",
} as const;

export const STAGE_IDS = [
  "welcome",
  "try",
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
  /** Under the heading on the stage's first slide; empty for none. */
  summary: string;
  /** The phone's line under the heading, when it differs from the slide's. */
  phoneSummary?: string;
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
    agenda: "Ask the AI a benefits question, then rate it.",
    summary: "Ask as a resident or caseworker. Rate the answer. Then tell us more about AI use in your agency.",
    phoneSummary: "Pick who you're asking as and a household, then ask. Or write your own question.",
  },
  {
    id: "reveal",
    label: "What we saw",
    title: "What we saw",
    agenda: "The room's results, then discussion.",
    summary: "Could a resident act on these answers?",
    // The phone shows the look-up card under the heading, so no line of its own.
    phoneSummary: "",
  },
  {
    id: "scale",
    label: "At scale",
    title: "AI gets it wrong at scale",
    agenda: "PolicyBench: 50 AI models on SNAP.",
    summary: "We asked 50 AI models to calculate SNAP for households sampled from US microdata.",
  },
  {
    id: "foundation",
    label: "Shared foundation",
    title: "What if we had a shared foundation to power all digital tools?",
    summary: "",
    agenda: "One open set of rules for every tool.",
  },
  {
    id: "groups",
    label: "Small groups",
    title: "What would you build first with one open set of rules?",
    agenda: "Vote on what to build first, then talk it through in groups.",
    summary: "Vote on your phone, then talk through your choice with your group.",
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
    summary: "Thank you for joining us. Enjoy dinner.",
  },
];

/**
 * TV moments (the run-through, Oct 23): while the room looks at the screen
 * together, a phone shows one line and one number, and comes back for the vote.
 */
export const LOOK_UP = {
  heading: "Look up at the screen",
  reveal: { label: "answers in this room looked right", empty: "The room's results are on the screen." },
  scale: { label: "of AI answers told a household that qualifies for SNAP it would get $0" },
  foundation: {
    label: "in this room say a resident, screener or AI can't fully check an answer against their state's rules today",
    empty: "What one open set of rules would do is on the screen.",
  },
  later: "Your phone comes back for the vote.",
} as const;

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
 * The household chips. Participants ask the AI about them; the chat runs no
 * rules check. All but the Connecticut couple are in states whose SNAP the
 * gallery chatbot's Axiom rules cover; finbot has no Connecticut SNAP, so the
 * live demo on At scale 7/7 asks its own question (LIVE_DEMO). The retiree in
 * Phoenix leads: the convening is in Phoenix. The Connecticut couple is At
 * scale's example household (PolicyBench scenario_027), so participants can
 * ask the AI about it before the room sees how 50 models did. The first person and
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
  /** Why this household is on the list, for presenters (no component shows it yet). */
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
    id: "ct-couple",
    label: "Couple, with savings",
    blurb: "68 and 39, disability income, $48,000 in the bank",
    state: "Connecticut",
    program: "SNAP",
    programShort: "SNAP (food stamps)",
    plural: true,
    firstPerson:
      "We live in Hartford, Connecticut. I'm 68 and I get $2,513 a month from Social Security. My spouse is 39, blind and has a disability. We have $48,000 in the bank.",
    thirdPerson:
      "a couple in Hartford, Connecticut: a 68-year-old who gets $2,513 a month from Social Security and a 39-year-old spouse who is blind and has a disability, with $48,000 in the bank",
    why: "PolicyBench scenario_027: 42 of the 49 models that answered said $0. Connecticut's broad-based categorical eligibility (200% of poverty, no asset limit) waives the net income and asset tests, so the couple qualifies for the minimum benefit: $24 a month under FY2026 standards (PolicyBench's reference), $25 from October 1, 2026.",
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
/** The two kinds of detail, shown as separate rows so the list scans quickly. */
export const TWIST_GROUPS = [
  { id: "money", label: "Income and costs" },
  { id: "people", label: "People in the home" },
] as const;
export type TwistGroupId = (typeof TWIST_GROUPS)[number]["id"];

export interface Twist {
  id: string;
  label: string;
  group: TwistGroupId;
  i: string;
  we: string;
  they: string;
  skip?: readonly string[];
}

export const TWISTS: readonly Twist[] = [
  {
    id: "gig",
    label: "Gig income",
    group: "money",
    i: "I also make about $400 a month driving for a delivery app.",
    we: "We also make about $400 a month driving for a delivery app.",
    they: "They also make about $400 a month driving for a delivery app.",
  },
  {
    id: "child-support",
    label: "Pays child support",
    group: "money",
    i: "I pay $300 a month in child support for a child who doesn't live with me.",
    we: "One of us pays $300 a month in child support for a child who doesn't live with us.",
    they: "They pay $300 a month in child support for a child who doesn't live with them.",
  },
  {
    id: "student",
    label: "College student",
    group: "people",
    i: "I'm also a part-time college student.",
    we: "One of us is a part-time college student.",
    they: "They're also a part-time college student.",
    skip: ["az-retiree", "ct-couple"],
  },
  {
    id: "green-card",
    label: "Green card holder",
    group: "people",
    i: "I've had a green card for two years.",
    we: "One of us has had a green card for two years.",
    they: "One adult in the household has had a green card for two years.",
  },
  {
    id: "medical",
    label: "Medical bills",
    group: "money",
    i: "I pay about $250 a month out of pocket for medical care.",
    we: "We pay about $250 a month out of pocket for medical care.",
    they: "They pay about $250 a month out of pocket for medical care.",
  },
  {
    id: "utilities",
    label: "Pays utilities",
    group: "money",
    i: "I also pay $180 a month for electricity and heat.",
    we: "We also pay $180 a month for electricity and heat.",
    they: "They also pay $180 a month for electricity and heat.",
    skip: ["ny-parent", "ca-family", "ga-ctc"],
  },
  {
    id: "savings",
    label: "Savings",
    group: "money",
    i: "I have $8,000 in savings.",
    we: "We have $8,000 in savings.",
    they: "They have $8,000 in savings.",
    skip: ["ct-couple"],
  },
  {
    id: "roommate",
    label: "Roommate",
    group: "people",
    i: "I share an apartment with a roommate who buys and cooks food separately.",
    we: "We share our home with a roommate who buys and cooks food separately.",
    they: "They share an apartment with a roommate who buys and cooks food separately.",
  },
  {
    id: "pregnant",
    label: "Pregnant",
    group: "people",
    i: "I'm also pregnant.",
    we: "One of us is pregnant.",
    they: "They're also pregnant.",
    skip: ["az-retiree", "ct-couple"],
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

/** Questions in their display order, without duplicates. */
export function orderedQuestions(questions: QuestionId | readonly QuestionId[]): QuestionId[] {
  const picked = new Set(Array.isArray(questions) ? questions : [questions]);
  return QUESTION_IDS.filter((id) => picked.has(id));
}

/** The known questions in a request: a list, or the single id older pages sent. In display order. */
export function questionsFrom(list: unknown, single?: unknown): QuestionId[] {
  const raw: unknown[] = Array.isArray(list) ? list : single !== undefined && single !== null ? [single] : [];
  return orderedQuestions(raw.filter((q): q is QuestionId => QUESTION_IDS.includes(q as QuestionId)));
}

/**
 * The prompt a perspective, household, details and one or more questions
 * compose to; several questions are asked one after another, in display
 * order. The participant can edit it before sending; both versions are saved.
 */
export function composePrompt(
  perspective: PerspectiveId,
  household: Household,
  questions: QuestionId | readonly QuestionId[],
  twistIds: readonly string[] = [],
): string {
  const details = twistsFor(household)
    .filter((t) => twistIds.includes(t.id))
    .map((t) => (perspective === "caseworker" ? t.they : household.plural ? t.we : t.i));
  const extra = details.length ? ` ${details.join(" ")}` : "";
  const asked = orderedQuestions(questions);
  if (perspective === "resident") {
    return `${household.firstPerson}${extra} ${asked.map((q) => residentQuestion(q, household)).join(" ")}`;
  }
  return `I'm a caseworker in ${household.state}. My client is ${household.thirdPerson}.${extra} ${asked.map((q) => clientQuestion(q, household)).join(" ")}`;
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
 * A baseline asked with the overall rating in Try it, shown on Shared
 * foundation: is there a source of truth anyone can check answers against today?
 */
export const SOURCE_OF_TRUTH = {
  id: "source-of-truth",
  title: "Checking answers today",
  question: "Can a resident, a screener or an AI check an answer against the state's official rules today?",
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
  { id: "experience", label: "How is AI performing overall in your agency?" },
  { id: "misunderstood", label: "Which policies do the public and caseworkers most often misunderstand?" },
] as const;
export type DiscussionQuestionId = (typeof DISCUSSION_QUESTIONS)[number]["id"];

/** A 1–5 scale for a discussion question: its heading, what each category rates, and what the ends mean. */
export interface RatingScale {
  title: string;
  low: string;
  high: string;
  categories: readonly { id: string; label: string }[];
}

/**
 * The discussion questions people rate on a scale in Try it; the third
 * (misunderstood policies) uses topic picks instead. Category labels are
 * short statements, so one scale (Not at all → Fully) reads for all of them.
 */
export const RATING_SCALES: Partial<Record<DiscussionQuestionId, RatingScale>> = {
  performance: {
    title: "How did the AI do at answering the question(s)?",
    low: "Not at all",
    high: "Fully",
    categories: [
      { id: "amount", label: "Got the amount right" },
      { id: "state-rules", label: "Knew the state's rules" },
      { id: "clarity", label: "Was clear to a resident" },
      { id: "sources", label: "Showed where the answer came from" },
      { id: "uncertainty", label: "Admitted what it didn't know" },
    ],
  },
  experience: {
    title: "How is AI performing overall in your agency?",
    low: "Not well",
    high: "Very well",
    categories: [
      { id: "residents", label: "For residents" },
      { id: "staff", label: "For your staff" },
      { id: "you", label: "For you" },
    ],
  },
};

/**
 * The optional comment under the agency question. It asks for both sides, so
 * no one has to call their own agency's AI a failure. Comments are anonymous
 * and stay off the phones; the presenter chooses when to show them.
 */
export const AGENCY_COMMENT = {
  prompt: "Where has AI helped your agency, and where has it fallen short?",
  hint: "Optional and anonymous. Please don't name people or share client details.",
} as const;

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
    label: "See and trace the rules",
    detail: "Staff read the rules in plain language and trace each one to the law.",
  },
  {
    id: "project",
    label: "Project policy changes",
    detail: "See who a change affects before it lands.",
  },
  {
    id: "flows",
    label: "Build caseworker flows",
    detail: "Ask only the questions each case needs.",
  },
  {
    id: "apply",
    label: "Create application interfaces",
    detail: "New ways to apply, on the same rules as the eligibility system.",
  },
] as const;
export type UseCaseId = (typeof USE_CASES)[number]["id"];

/** Small groups on a phone: who fills in the form. The slide carries the longer BREAKOUT_PROMPT. */
export const GROUP_PHONE_INTRO = "One person per group fills this in and shares it with the room.";

/** Small groups 2/2: how the groups work, said before they start. */
export const BREAKOUT_PROMPT = "Pick one use from the vote and answer three questions together. One person reports back for the group.";

/**
 * The three questions every group answers: one box each on the group's phone,
 * one line each on its report-back card. `id` is the breakout payload field;
 * the idea keeps its original name, `note`.
 */
export const GROUP_QUESTIONS = [
  { id: "note", short: "Idea", label: "What would you build first?", placeholder: "One or two sentences" },
  { id: "who", short: "Who", label: "Who would use it, and what would change for them?", placeholder: "Caseworkers, residents, policy staff…" },
  { id: "trust", short: "Trust", label: "What would have to be true for your agency to trust it?", placeholder: "Who reviews it, what it has to match…" },
] as const;

/** The second, optional group box: what the group raised beyond its best idea (Alex's ask, Oct 12). */
export const GROUP_RAISED = {
  label: "Anything else your group raised?",
  placeholder: "Barriers, what your workforce would need, open questions",
} as const;

/**
 * SNAP's minimum benefit for households of one or two in the 48 states and DC:
 * $24 under FY2026 standards; $25 from October 1, 2026 (USDA FY2027 COLA memo,
 * August 21, 2026).
 */
export const MINIMUM_BENEFIT = { fy2026: 24, fy2027: 25, effective: "October 1, 2026" } as const;

// ---------------------------------------------------------------------------
// PolicyBench
// ---------------------------------------------------------------------------

/**
 * SNAP figures from the PolicyBench dashboard export
 * (PolicyEngine/policybench, release dashboard-data-20261014, the latest on
 * 2026-10-15; dashboard-data.json sha256 22db9a9c…). "Eligible" = the 13
 * scored households whose PolicyEngine reference SNAP is above $0; each of
 * 50 models answered each one with no tools, 643 parsed answers in all.
 * The same counting reproduces the Sep 30 release's 46 / 591 / 242 / 188.
 * "Said $0" = a prediction of $0 or less. Failure causes are PolicyBench's own `failureSubtype`
 * annotations; "categorical_eligibility" covers broad-based categorical
 * eligibility (BBCE).
 */
export const POLICYBENCH = {
  snapshot: "October 14, 2026",
  url: "https://policybench.org",
  models: 50,
  eligibleHouseholds: 13,
  eligibleAnswers: 643,
  saidZero: 268,
  saidZeroBbce: 197,
  /** At scale's example household (scenario_027): 42 of the 49 models that answered said $0; one got it right. */
  example: {
    state: "Connecticut",
    description: "A couple, 68 and 39. The 39-year-old is blind and has a disability. $2,536 a month, almost all Social Security disability. $48,000 in savings.",
    modelsAsked: 50,
    /** glm-5.2's answer didn't parse. */
    modelsAnswered: 49,
    modelsSaidZero: 42,
    /**
     * gpt-6-astra matched the $288 reference exactly. Four more said $276 (FY2025's $23
     * minimum), which At scale 3/7's within-10% rule would also count; one said $388 and
     * one $5,160. The slides say "matched exactly" so the two counts don't collide.
     */
    modelsExact: 1,
    /**
     * PolicyBench's reference: the FY2026 minimum benefit, $24 a month, every
     * month of 2026. Models were asked for the annual amount
     * (policybench/prompts.py), so the reference is $288. PolicyEngine kept
     * USDA's FY2026 allotments and deductions for every month, October to
     * December included ($24 minimum, $546 two-person maximum), with the 2026
     * poverty guideline from October. Gross income is 1.44 times the
     * poverty guideline, under Connecticut's 200% limit, so the couple is
     * categorically eligible and the $48,000 doesn't count.
     */
    reference: { monthly: 24, annual: 288, standards: "FY2026" },
    /**
     * USDA's FY 2027 standards (October 1, 2026, to September 30, 2027;
     * memo of August 21, 2026): the minimum allotment for households of one
     * or two in the 48 states and DC is $25 and the two-person maximum is
     * $562 (https://www.fna.usda.gov/snap/allotment/cola). Under them the
     * couple's $2,536 is still below 200% of poverty ($3,607). Its net
     * income is about $2,300 ($2,536 less the $217 standard deduction and
     * $19 of medical costs above $35 a month), and 30% of that, about $690,
     * is above the maximum, so it gets the minimum.
     */
    fromOctober: { monthly: 25, standards: "FY2027", effective: "October 1, 2026" },
    /**
     * Calendar 2026 under current law: nine months at FY2026's $24 and three
     * at FY2027's $25. PolicyBench holds FY2026 amounts through December
     * under its July 2026 law cutoff, which is why its reference is $288
     * (the PolicyBench session, Oct 23).
     */
    currentLaw: { annual: 291 },
  },
} as const;

// ---------------------------------------------------------------------------
// From Max's Nava Open Source Summit deck (axiom-audiences PR #141,
// decks/nava-2026-10, Oct 13, 2026), moved to the Oct 14 release
// (dashboard-data-20261014) on Oct 15 so all of At scale uses one snapshot.
// Recomputed the deck's way: parsed no-tools answers; within 10% of the
// reference for households owed money, within $1 for households owed $0.
// That method reproduces every Oct 13 row on the deck exactly.
// ---------------------------------------------------------------------------

/** Where models still break: accuracy by program, for households owed money and households owed $0. */
export const WHERE_MODELS_BREAK = {
  title: "Where models still break",
  note: "Share of model answers within 10% of the reference amount (within $1 for households owed $0)",
  source:
    "policybench.org, October 14, 2026 · 50 models, no tools · income taxes before refundable credits · TANF (1 household) and SSI (2) omitted",
  rows: [
    { program: "State refundable credits", households: 18, owed: 17.6, zero: 98.6 },
    { program: "SNAP", households: 13, owed: 36.7, zero: 96.9 },
    { program: "Federal income tax", households: 36, owed: 45.6, zero: 93.8 },
    { program: "State income tax", households: 36, owed: 47.8, zero: 91.1 },
    { program: "Federal refundable credits", households: 13, owed: 52.4, zero: 96.1 },
    { program: "Payroll tax", households: 60, owed: 88.5, zero: 98.6 },
    { program: "Self-employment tax", households: 8, owed: 94.4, zero: 99.3 },
  ],
} as const;

/** One household, as every model sees it (PolicyBench scenario_027, from the October 14 snapshot). */
export const EXAMPLE_HOUSEHOLD = {
  title: "One household, as every model sees it",
  facts: [
    "Connecticut, 2026",
    "A couple, 68 and 39",
    "The 39-year-old is blind and has a disability",
    "Social Security disability $30,160 a year",
    "$48,000 in the bank",
    "Plus $275 in interest and $650 in medical costs a year",
  ],
  program: "SNAP for 2026",
  reference: 288,
  models: 50,
  /** Every model's annual answer, as the tiles show them: $0 first, the right answer last, then the one that didn't parse. */
  answers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 276, 276, 276, 276, 388, 5160, 288, null] as readonly (number | null)[],
  source: "Scenario explorer, policybench.org, October 14, 2026 snapshot",
} as const;

/** What the models miss: the top two models' explanations, beside the rule they skip. */
export const WHAT_MODELS_MISS = {
  title: "What the models miss",
  quotes: [
    {
      model: "GPT-6 Sol · rank 1",
      text: "Monthly Social Security income of about 2513 exceeds the two-person SNAP net-income limit even after the applicable standard and reported medical deductions.",
    },
    {
      model: "Claude Opus 5.5 · rank 2",
      text: "Monthly gross income is about $2,536. Subtracting the standard deduction and a small medical deduction leaves net income of about $2,308. This exceeds the roughly $1,763 net income limit for a household of 2, and there are no shelter costs to reduce it.",
    },
  ],
  ruleLabel: "Broad-based categorical eligibility",
  /** The room knows BBCE, so the slide says only what it does here (the dry run, Oct 25). */
  rule: "Connecticut covers gross income up to 200% of poverty, with no asset limit. This couple is under that line, so they skip the net income test both models used. They qualify.",
  sources: "7 CFR 273.2(j)(2) · USDA FNA BBCE chart, June 2026 · PolicyBench, Oct 14, 2026",
} as const;

/** Why this matters for AI: the front door to the law. */
export const FRONT_DOOR = {
  /** Replaces the At scale heading on this slide, where the stage turns from the problem to the fix. */
  heading: "We can help AI get it right at scale",
  title: "AI is becoming a front door to benefits. Now is the moment to get it right nationally.",
  asker: { name: "People and agents", detail: "ask what the law says" },
  model: "AI model",
  today: { label: "Today", result: "A guess", detail: "from training data and web search" },
  axiom: { label: "With Axiom", source: "Encoded law", sourceDetail: "open, cited, executable", result: "The rule", detail: "with its citation" },
} as const;

// ---------------------------------------------------------------------------
// At scale 6/7: the same models, given our rules engine as a tool. PolicyBench's
// preliminary internal pilot of October 23–25, 2026, the three models run on
// 100 households (Max's call on d1943 in the dry run, Oct 25: replace the
// October 14–15 tool pilot with this table, nonzero amounts within $1, the
// accuracy change and the cost change as a percent). Hand-copied from the
// final build, PolicyBench scripts dccf8bf:
//   ~/reviews/policybench-v2-microcosm-2026-10/aspen/free-plan-pooled.json
//     (sha256 5c40b635…): models[].arms.{web,both}.k of n = 276, and
//     models[].vsWeb.both {points, lo, hi}, a 95% household bootstrap;
//   paper/v2-preview/build/v2-preview.json (sha256 f06e95cf…):
//     settings[].settings.{web,both}.costPerHousehold and vsWeb.costPct.
// Cost is at API list prices, searches at $10 per 1,000 (OpenAI, Anthropic)
// and $14 (Gemini) with no free allowance. The models ran through their APIs
// with PolicyBench's prompt, not in chat apps. At 100 households a change of
// under about 10 points is within noise. The references come from the same
// engine the tool runs (policyengine-us 2.60.4), and an AI judge disputes
// some of them, none adjudicated yet; that is why it is a pilot. Never call
// it a published PolicyBench result. The screens say "our rules engine" and
// leave PolicyEngine unnamed (Max, Oct 25).
// ---------------------------------------------------------------------------

export interface EnginePilotRow {
  model: string;
  /** Nonzero dollar amounts within $1 of the reference, of the pilot's `amounts`. */
  web: number;
  both: number;
  /** The change from web search alone, in points, with its 95% interval, as the export rounds them. */
  change: { points: number; lo: number; hi: number };
  /** Mean list-price cost per household, in dollars. */
  cost: { web: number; both: number };
}

export interface EnginePilot {
  title: string;
  /** Households per model, and the nonzero dollar amounts they hold. */
  households: number;
  amounts: number;
  arms: { web: string; both: string };
  note: string;
  rows: readonly EnginePilotRow[];
  measures: string;
  source: string;
}

/** A share of `of`, as a percentage to one decimal. */
export function share(hits: number, of: number): number {
  return Math.round((1000 * hits) / of) / 10;
}

/** The change from `from` to `to`, as a whole percent: -86 for a cost that fell by 86%. */
export function percentChange(from: number, to: number): number {
  return Math.round(100 * (to / from - 1));
}

export const ENGINE_PILOT: EnginePilot = {
  title: "The same models, given our rules engine as a tool",
  households: 100,
  amounts: 276,
  arms: { web: "Web search", both: "Web search and our rules engine" },
  note: "Nonzero dollar amounts within $1 of the reference: 276 per model across 100 US households",
  rows: [
    { model: "GPT-6 Luna", web: 152, both: 212, change: { points: 21.7, lo: 13.9, hi: 29.3 }, cost: { web: 0.0558, both: 0.0078 } },
    { model: "Claude Sonnet 5.5", web: 164, both: 268, change: { points: 37.7, lo: 31.3, hi: 44.1 }, cost: { web: 0.1122, both: 0.0781 } },
    { model: "Gemini 3.5 Flash-Lite", web: 64, both: 151, change: { points: 31.5, lo: 24.6, hi: 38.5 }, cost: { web: 0.3431, both: 0.0313 } },
  ],
  measures:
    "Our rules engine also computes PolicyBench's reference answers, so this shows whether a model can describe a household to it, not whether the engine is right. The models ran through their APIs with our prompt, not in chat apps.",
  source:
    "Preliminary internal pilot · PolicyBench, our benchmark · runs October 23–25, 2026 · 100 US households · intervals are 95% · cost per household at API list prices, searches included",
};

/**
 * At scale 7/7: the live chatbot demo (TheAxiomFoundation/finbot-snap-demo,
 * served at axiom.org/gallery/chatbot). `compare=1` puts plain AI beside AI
 * with the Axiom rules engine, and `q` prefills the question. Inside a frame
 * the demo never sends on its own, so the presenter presses Send. The model
 * is OpenAI's GPT-6 Luna (finbot's default; production sets no FINBOT_MODEL,
 * checked Oct 23, 2026); the demo's copy says what it does and doesn't
 * promise, so the slide stays plain too.
 *
 * The question is the top pick from Pavel's error ledger (#aspen, Oct 23,
 * 2026). Alabama's TANF State Plan, effective October 1, 2024, sets $344 a
 * month for a family of three (Attachment E); Georgia pays $280. Plain AI
 * cites Alabama's older $215, so it says Georgia. On the live chatbot on
 * Oct 23, 2026, plain AI said Georgia 10 times out of 10, and AI with the
 * engine said Alabama, $344 against $280, 10 times out of 10. The earlier
 * Fresno CalFresh question showed no contrast: both sides gave about $250.
 */
export const LIVE_DEMO = {
  title: "The same AI model, on its own and with the Axiom rules engine",
  base: "https://axiom.org/gallery/chatbot",
  question: "Single mom with two kids: does Alabama or Georgia pay more TANF?",
} as const;

export function liveDemoUrl(): string {
  return `${LIVE_DEMO.base}?compare=1&q=${encodeURIComponent(LIVE_DEMO.question)}`;
}

/** The same rules for every system: what one shared set of rules gives each group. */
export const SAME_RULES = {
  /** Shared foundation 2/4's heading. */
  heading: "What does one open set of rules enable?",
  /** The room is state benefits leaders, so governments get the big box and the most uses. */
  governments: {
    label: "For governments",
    uses: [
      "Determinations that cite the law they apply, so caseworkers and residents can see the reasons",
      "Caseworker guidance and training built on the same rules",
      "Payment accuracy checks before benefits go out",
      "A policy change tested before it takes effect",
      "Screeners and AI tools that give your agency's answer",
    ],
  },
  audiences: [
    { label: "For individuals", text: "Information to plan for their futures and receive assistance on any channel they use." },
    { label: "For AI systems", text: "One source of record, so models stop estimating benefits amounts and start citing them." },
    { label: "For builders", text: "Tools that guide people through benefits and taxes, built on rules they don't have to re-encode." },
    { label: "For researchers", text: "A computational model of the rules, for estimating what a policy does and reproducing the analysis." },
  ],
} as const;

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((100 * part) / whole) : 0;
}

// ---------------------------------------------------------------------------
// The fix
// ---------------------------------------------------------------------------

/** What makes the one set of rules checkable: the dark box on Shared foundation 1/4. */
export const FOUNDATION_TRAITS = [
  "Every value is built to cite the provision it comes from",
  "Every change carries its effective date",
  "Every release is versioned, so you can see what changed",
] as const;

/** Under the boxes on Shared foundation 1/4, emphasized as in the main deck's value proposition. */
export const ONE_SET_STATEMENT = {
  text: "Every system that helps people discover and enroll in economic security programs runs on the same rules,",
  accent: "reducing cost, duplication and error at once.",
} as const;

export const ONE_SET_OF_RULES = [
  { label: "AI tools", detail: "The chatbots residents and staff already ask." },
  { label: "Community screeners", detail: "Partner tools that say what to apply for." },
  { label: "State systems", detail: "Eligibility, caseworker flows and notices." },
  { label: "Staff training", detail: "Training built on the rules themselves." },
  { label: "Policy changes", detail: "See the effect of a change before it lands." },
  { label: "Research", detail: "Evaluators and analysts run the same rules." },
] as const;

/**
 * Shared foundation 3/4: the encoding pipeline, before "How do we build it?".
 * Copied from the InnovateUS deck (axiom-slides, public/decks/innovateus-2026-10,
 * slide 12; axiom.org/slides/innovateus-2026-10#12), wording unchanged. Each
 * step's small illustration lives with the slide; its text lives here.
 */
export const ENCODING_PIPELINE = {
  heading: "The encoding pipeline",
  lead:
    "We take the law from its official sources, encode it rule by rule, and apply each rule only after its required checks pass. " +
    "An AI judge flags issues for review. Every value keeps the citation it came from. " +
    "One artifact then serves every surface, from a chatbot to a government rules engine.",
  steps: [
    { name: "Intake", caption: "Hundreds of official sources", foot: "Goal: keep every version" },
    { name: "Corpus", caption: "The whole law, word for word", foot: null },
    { name: "Encoding loop", caption: "Drafted, checked, redrafted", foot: "↺ Applied only when required checks pass" },
    { name: "RuleSpec", caption: "One rule, fully cited", foot: null },
    { name: "Graph", caption: "The spec becomes a node", foot: "Typed · cited · executable" },
    { name: "Compile and serve", caption: "One artifact, every surface", foot: null },
  ],
  sources: ["eCFR", "USLM", "state codes ×47", "policy manuals"],
  checks: [
    { label: "deterministic", required: true },
    { label: "comparison models, where available", required: true },
    { label: "AI judge, advisory", required: false },
  ],
  surfaces: [
    { name: "Chatbot", who: "AI labs" },
    { name: "Rules engine", who: "government" },
    { name: "API/MCP", who: "builders" },
  ],
} as const;

/** Shared foundation 4/4's heading. */
export const BUILD_HEADING = "How do we build one open set of rules?";

/**
 * How a shared foundation gets built for a state: rules from public documents
 * first, then the Silver and Gold A validation tiers, worded as in the core
 * deck (decks/ballmer-2026-10-07, Release standard); Silver A's "takes" stays
 * concrete for this room. Bronze A (an independent audit) came off the slide on
 * Oct 15, 2026. `medal` picks the core deck's tier palette; the first step has none.
 */
export const GOLDEN_A = [
  {
    tier: "Starting point",
    name: "Rules from public documents",
    gets: "Programs encoded from publicly available documents, first for screening parity, then as full document bundles.",
    /**
     * The roadmap's twelve core programs (PlanGraph joint-operating-2026-09-13,
     * `team:work:finbot-policy-inventory` scope.programs; graph 1be9a657), in
     * reading order. Federal and state income tax is the thirteenth in the
     * end-of-2027 requirement, since the credits are computed on it.
     */
    programs: ["SNAP", "Medicaid", "CHIP", "TANF", "WIC", "LIHEAP", "CCDF", "SSI", "Medicare", "UI", "EITC", "CTC"],
    takes: "Publicly available documents.",
    medal: null,
  },
  {
    tier: "Silver A",
    name: "Government validation",
    gets: "Axiom validates the encoded rules together with a government partner, against the partner's own internal documents and its existing system code.",
    takes: "Your policy manuals, read access to how your system computes, and a few hours of your policy staff.",
    medal: "silver",
  },
  {
    tier: "Gold A",
    name: "Government system runs on Axiom",
    gets: "A government runs its own production system on the rules it validated.",
    goal: "This is the ultimate goal: all systems can run off the same rules, inside and alongside government.",
    takes: "Silver A, plus the integration, operations and support to run in production.",
    medal: "gold",
  },
] as const;

/**
 * The ask, shown just before the next-steps form: what Silver A takes from
 * a state, and what it never asks for. From Max's Aspen prototype spec
 * (axiom-audiences docs/aspen-page-spec.md).
 */
export const SILVER_ASK = {
  title: "Validate and open rules with us",
  lead: "Silver A is the first step. Gold A is the destination.",
  takes: [
    "3–5 people across policy, operations and technology, a few hours a month.",
    "Manuals, guidance, test cases and access to legacy rules code.",
    "One multi-day on-site session.",
  ],
  guardrails: [
    "No production integration.",
    "No client personal information.",
    "No commitment to buy.",
    "Your reviewers are the final authority.",
  ],
} as const;

export const NEXT_STEPS = {
  ask: "Work with us. Your partnership is the path to solving this nationally.",
  options: [
    {
      id: "accurate_ai",
      label: "Accurate AI answers",
      detail: "AI tools that give residents and staff the right answer for your state.",
    },
    {
      id: "state_systems",
      label: "State systems",
      detail: "Your eligibility systems, screeners and caseworker tools on open rules your team has validated.",
    },
  ],
} as const;

/**
 * Shown with every AI answer: the answers are a demo of an unmodified
 * general-purpose model, and the model's maker has no part in the page.
 */
export const DEMO_NOTE = "Answers come from OpenAI's GPT model, unedited. OpenAI does not sponsor or endorse this page.";

/**
 * What we keep, said up front (agreed with Aspen, Oct 12): answers and
 * ratings are kept for our own analysis, never published, and taking part
 * is optional. Reworded on Oct 16 as a bold header and one plain line per
 * point, for phones; same substance.
 */
export const DISCLOSURE = {
  short: "We keep everyone's answers to learn from and don't publish them. Taking part is optional.",
  details: [
    { title: "No names", text: "We don't ask who you are. Please don't type details about real people." },
    { title: "Where questions go", text: "To OpenAI, for the AI's answer." },
    { title: "What we save", text: "Questions and ratings, to learn which rules are hardest. We don't publish them or show who asked what." },
    { title: "Your choice", text: "Skip anything, or just watch." },
    { title: "Email", text: "Only on the next-steps form, to follow up." },
  ],
} as const;
