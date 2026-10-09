import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSEHOLDS, composePrompt, findHousehold } from "@/lib/aspen/content";
import { CHAT_KEY, ChatWindow, hostname, readNdjson, type SavedChat, type Turn } from "./chat-window";

type Handler = (init?: RequestInit) => Promise<Response> | Response;

function jsonResponse(data: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, body: null, json: async () => data } as unknown as Response;
}

function streamResponse(stream: ReadableStream<Uint8Array>) {
  return { ok: true, status: 200, body: stream, json: async () => ({}) } as unknown as Response;
}

const encoder = new TextEncoder();
const encodeLines = (lines: unknown[]) =>
  encoder.encode(lines.map((l) => `${typeof l === "string" ? l : JSON.stringify(l)}\n`).join(""));

/** A response body the test feeds line by line. */
function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push: (...lines: unknown[]) => controller.enqueue(encodeLines(lines)),
    close: () => controller.close(),
  };
}

function streamOf(lines: unknown[]) {
  const s = controlledStream();
  if (lines.length) s.push(...lines);
  s.close();
  return s.stream;
}

/** fetch routed by path; anything unrouted (events) answers {ok: true}. */
function routeFetch(routes: Record<string, Handler | Handler[]>) {
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    const route = queues.get(path);
    if (!route) return jsonResponse({ ok: true });
    const handler = Array.isArray(route) ? route.shift() : route;
    if (!handler) throw new Error(`no more responses for ${path}`);
    return handler(init);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function calls(mock: ReturnType<typeof routeFetch>, path: string) {
  return mock.mock.calls
    .filter(([url]) => String(url) === path)
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function saved(): SavedChat {
  return JSON.parse(localStorage.getItem(CHAT_KEY) ?? "null");
}

const draftBox = () => screen.getByLabelText("Your question") as HTMLTextAreaElement;
const pickRetiree = () => fireEvent.click(screen.getByRole("button", { name: /Retiree in Phoenix/ }));
const openFollowUp = () => fireEvent.click(screen.getByRole("button", { name: "Ask a follow-up" }));

/** Rates the newest answer (looks right, would act, would apply) and waits for the save. */
async function rateAnswer() {
  const verdict = screen.getByRole("region", { name: "Your verdict" });
  fireEvent.click(within(verdict).getByRole("button", { name: "Looks right" }));
  fireEvent.click(within(verdict).getByRole("button", { name: "Yes" }));
  fireEvent.click(within(verdict).getByRole("button", { name: "Apply" }));
  fireEvent.click(within(verdict).getByRole("button", { name: "Save rating" }));
  await screen.findByText("Your rating is saved. Thank you.");
}

const RETIREE = HOUSEHOLDS[0];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("aspen.participant", "p-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readNdjson", () => {
  it("reads lines split across chunks and skips garbled or blank lines", async () => {
    const text = '{"type":"meta","promptId":"p"}\n\n{garbled\n{"type":"delta","text":"Café"}\n{"type":"done"}';
    const bytes = encoder.encode(text);
    const accent = bytes.indexOf(0xc3);
    const cuts = [12, accent + 1, bytes.length - 4];
    const chunks = [0, ...cuts].map((start, i) => bytes.slice(start, [...cuts, bytes.length][i]));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((chunk) => c.enqueue(chunk));
        c.close();
      },
    });
    const lines: Record<string, unknown>[] = [];
    await readNdjson(stream, (line) => lines.push(line));
    expect(lines).toEqual([
      { type: "meta", promptId: "p" },
      { type: "delta", text: "Café" },
      { type: "done" },
    ]);
  });

  it("handles an empty body", async () => {
    const onLine = vi.fn();
    await readNdjson(streamOf([]), onLine);
    expect(onLine).not.toHaveBeenCalled();
  });
});

describe("hostname", () => {
  it("labels a source by its host, or by the raw text when it does not parse", () => {
    expect(hostname("https://des.az.gov/snap")).toBe("des.az.gov");
    expect(hostname("not a url")).toBe("not a url");
  });
});

describe("ChatWindow composing", () => {
  it("points to Rate it once the answer is rated", async () => {
    routeFetch({
      "/api/aspen/ask": () => streamResponse(streamOf([{ type: "meta", promptId: "p-r" }, { type: "delta", text: "Ok" }, { type: "done" }])),
      "/api/aspen/rate": () => jsonResponse({ ok: true }),
    });
    const onRateOverall = vi.fn();
    render(<ChatWindow stage="try" rulesUnlocked={false} onRateOverall={onRateOverall} />);
    pickRetiree();
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    await screen.findByText("Ok");
    expect(screen.queryByRole("button", { name: /Next: rate how AI did overall/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    fireEvent.click(await screen.findByRole("button", { name: /Next: rate how AI did overall/ }));
    expect(onRateOverall).toHaveBeenCalledTimes(1);
  });

  it("starts empty with no household picked, asking as a resident", () => {
    routeFetch({});
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    expect(screen.getByRole("button", { name: "A resident" })).toHaveAttribute("aria-pressed", "true");
    // Before the first answer the side column explains the steps.
    expect(screen.getByRole("complementary", { name: "How it works" })).toHaveTextContent("Then rate how AI did overall, in Rate it.");
    expect(draftBox().value).toBe("");
    expect(draftBox()).toHaveAttribute("placeholder", "Pick a household above, or type your own question");
    expect(screen.getByRole("button", { name: /Retiree in Phoenix/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "How much?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask the AI" })).toBeDisabled();
    pickRetiree();
    expect(draftBox().value).toBe(composePrompt("resident", HOUSEHOLDS[0], "amount"));
  });

  it("keeps a typed question when the perspective changes, and drops a composed one for the own question", () => {
    routeFetch({});
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    fireEvent.change(draftBox(), { target: { value: "Can I get WIC in Ohio?" } });
    fireEvent.click(screen.getByRole("button", { name: "A caseworker" }));
    expect(draftBox().value).toBe("Can I get WIC in Ohio?");
    pickRetiree();
    expect(draftBox().value).toMatch(/^I'm a caseworker in Arizona/);
    fireEvent.click(screen.getByRole("button", { name: /Your own question/ }));
    expect(draftBox().value).toBe("");
  });

  it("composes the question from the perspective, household and question chips", () => {
    const fetchMock = routeFetch({});
    render(<ChatWindow stage="try" rulesUnlocked={false} />);

    expect(draftBox().value).toBe("");
    pickRetiree();
    expect(draftBox().value).toBe(composePrompt("resident", RETIREE, "amount"));
    expect(screen.getByRole("button", { name: "A resident" })).toHaveAttribute("aria-pressed", "true");
    // The demo disclaimer: OpenAI has no part in the page.
    expect(screen.getByText(/OpenAI does not sponsor or endorse this page/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "A caseworker" }));
    expect(draftBox().value).toBe(
      "I'm a caseworker in Arizona. My client is a 67-year-old in Phoenix, Arizona who lives alone, gets $1,200 a month from Social Security and pays $900 a month in rent. How much SNAP (food stamps) should they get each month?",
    );
    expect(calls(fetchMock, "/api/aspen/event")[1]).toEqual({
      participantId: "p-1",
      kind: "chip",
      payload: { perspective: "caseworker", householdId: "az-retiree", questionId: "amount", twists: [] },
      stage: "try",
    });

    fireEvent.click(screen.getByRole("button", { name: /Married, two kids/ }));
    expect(draftBox().value).toMatch(/My client is a married couple in Atlanta/);
    expect(draftBox().value).toMatch(/How much the Child Tax Credit should they get for 2026\?$/);

    fireEvent.click(screen.getByRole("button", { name: "A resident" }));
    expect(draftBox().value).toMatch(/^We're a married couple/);
    expect(draftBox().value).toMatch(/How much will we get from the Child Tax Credit for 2026\?$/);

    fireEvent.click(screen.getByRole("button", { name: "Eligible?" }));
    expect(draftBox().value).toMatch(/Do we qualify for the Child Tax Credit\?$/);
    expect(screen.getByRole("button", { name: "Eligible?" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "What else?" }));
    expect(draftBox().value).toMatch(/What benefits can we get, and how much would each one be\?$/);

    fireEvent.click(screen.getByRole("button", { name: "A caseworker" }));
    expect(draftBox().value).toMatch(/What benefits should I screen them for, and how much would each one be\?$/);

    expect(calls(fetchMock, "/api/aspen/event")).toHaveLength(7);
  });

  it("adds details to the household in the right voice, and drops ones a new household contradicts", () => {
    const fetchMock = routeFetch({});
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    expect(screen.queryByRole("group", { name: "Details" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Working parent of two/ }));
    const details = within(screen.getByRole("group", { name: "Details" }));
    // This household already pays for heat, so "Pays utilities" is not offered.
    expect(details.queryByRole("button", { name: /Pays utilities/ })).not.toBeInTheDocument();

    fireEvent.click(details.getByRole("button", { name: "+ Gig income" }));
    fireEvent.click(details.getByRole("button", { name: "+ College student" }));
    expect(details.getByRole("button", { name: "✓ Gig income" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Earn more?" }));
    const ny = findHousehold("ny-parent")!;
    expect(draftBox().value).toBe(composePrompt("resident", ny, "cliff", ["gig", "student"]));
    expect(calls(fetchMock, "/api/aspen/event").at(-1)).toMatchObject({
      kind: "chip",
      payload: { householdId: "ny-parent", questionId: "cliff", twists: ["gig", "student"] },
    });

    // Tapping a detail again removes it.
    fireEvent.click(details.getByRole("button", { name: "✓ College student" }));
    expect(draftBox().value).toBe(composePrompt("resident", ny, "cliff", ["gig"]));

    // A retiree cannot be a student; the gig income carries over.
    fireEvent.click(details.getByRole("button", { name: "+ College student" }));
    fireEvent.click(screen.getByRole("button", { name: /Retiree in Phoenix/ }));
    expect(draftBox().value).toBe(composePrompt("resident", RETIREE, "cliff", ["gig"]));
    expect(within(screen.getByRole("group", { name: "Details" })).queryByRole("button", { name: /College student/ })).not.toBeInTheDocument();
  });

  it("clears the draft and hides the question chips for the participant's own question", () => {
    routeFetch({});
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    const own = screen.getByRole("button", { name: /Your own question/ });
    fireEvent.click(own);
    expect(own).toHaveAttribute("aria-pressed", "true");
    expect(draftBox().value).toBe("");
    expect(screen.queryByRole("button", { name: "How much?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask the AI" })).toBeDisabled();

    fireEvent.change(draftBox(), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Ask the AI" })).toBeDisabled();
    fireEvent.change(draftBox(), { target: { value: "Can I get WIC in Ohio?" } });
    expect(screen.getByRole("button", { name: "Ask the AI" })).toBeEnabled();
  });

});

describe("ChatWindow asking", () => {
  it("streams an answer with sources and puts the rating card below the chat box", async () => {
    const first = controlledStream();
    const second = controlledStream();
    const fetchMock = routeFetch({
      "/api/aspen/ask": [() => streamResponse(first.stream), () => streamResponse(second.stream)],
      "/api/aspen/rate": () => jsonResponse({ ok: true }),
    });
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    pickRetiree();
    const question = draftBox().value;

    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    expect(await screen.findByText(question)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    // While the answer streams, the follow-up box stays closed and its link is disabled.
    expect(screen.getByRole("button", { name: "Ask a follow-up" })).toBeDisabled();
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "A caseworker" })).not.toBeInTheDocument();
    expect(screen.getByText("Your conversation")).toBeInTheDocument();

    const [ask] = calls(fetchMock, "/api/aspen/ask");
    expect(ask).toEqual({
      participantId: "p-1",
      conversationId: expect.any(String),
      turn: 0,
      messages: [{ role: "user", content: question }],
      meta: {
        stage: "try",
        perspective: "resident",
        householdId: "az-retiree",
        questionId: "amount",
        twists: [],
        promptTemplate: question,
      },
    });

    await act(async () => {
      first.push({ type: "meta", promptId: "prompt-1" }, { type: "status", text: "Searching the web" });
    });
    expect(await screen.findByText("Searching the web…")).toBeInTheDocument();

    await act(async () => {
      first.push(
        { type: "delta", text: "You can get **$24**" },
        { type: "delta", text: " a month." },
        {
          type: "done",
          model: "gpt-5",
          backend: "openai",
          webSearch: true,
          sources: [{ url: "https://des.az.gov/snap", title: "Arizona DES" }, { url: "https://www.fns.usda.gov/snap" }],
        },
      );
      first.close();
    });

    expect(await screen.findByText("gpt-5 · web search on")).toBeInTheDocument();
    expect(screen.getByText("$24", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Arizona DES" })).toHaveAttribute("href", "https://des.az.gov/snap");
    expect(screen.getByRole("link", { name: "www.fns.usda.gov" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    const verdict = screen.getByRole("region", { name: "Your verdict" });
    expect(within(verdict).getByText("Rate this answer")).toBeInTheDocument();
    // Rating is not optional: the follow-up and a new question wait for it.
    const lock = screen.getByText(/Rate this answer to ask another question/);
    expect(lock.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask a follow-up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New question" })).not.toBeInTheDocument();
    expect(screen.getByText(/OpenAI does not sponsor or endorse this page/)).toBeInTheDocument();
    expect(within(verdict).queryByText(/Later in the session/)).not.toBeInTheDocument();
    expect(saved().turns.map((t) => [t.role, t.status, t.promptId])).toEqual([
      ["user", undefined, undefined],
      ["assistant", "done", "prompt-1"],
    ]);

    // Rate it: the card gives way to a thank-you and the (locked) rules check.
    fireEvent.click(within(verdict).getByRole("button", { name: "Looks right" }));
    fireEvent.click(within(verdict).getByRole("button", { name: "Yes" }));
    fireEvent.click(within(verdict).getByRole("button", { name: "Apply" }));
    fireEvent.click(within(verdict).getByRole("button", { name: "Save rating" }));
    expect(await screen.findByText("Your rating is saved. Thank you.")).toBeInTheDocument();
    expect(screen.getByText(/Later in the session, you'll check this answer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New question" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask a follow-up" })).toBeEnabled();
    expect(calls(fetchMock, "/api/aspen/rate")[0]).toMatchObject({ promptId: "prompt-1", verdict: "right" });
    await waitFor(() => expect(saved().rated).toEqual(["prompt-1"]));

    // "Ask a follow-up" opens the box. A plain Enter does not send; Ctrl+Enter sends the follow-up with the history.
    fireEvent.click(screen.getByRole("button", { name: "Ask a follow-up" }));
    expect(draftBox()).toHaveAttribute("placeholder", "Ask a follow-up");
    fireEvent.change(draftBox(), { target: { value: "And if I move to Ohio?" } });
    fireEvent.keyDown(draftBox(), { key: "Enter" });
    expect(calls(fetchMock, "/api/aspen/ask")).toHaveLength(1);
    fireEvent.keyDown(draftBox(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(calls(fetchMock, "/api/aspen/ask")).toHaveLength(2));
    expect(calls(fetchMock, "/api/aspen/ask")[1]).toMatchObject({
      turn: 1,
      messages: [
        { role: "user", content: question },
        { role: "assistant", content: "You can get **$24** a month." },
        { role: "user", content: "And if I move to Ohio?" },
      ],
      meta: { questionId: null, promptTemplate: null },
    });

    // Sending closes the box again; while the follow-up streams it cannot reopen.
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask a follow-up" })).toBeDisabled();
    expect(calls(fetchMock, "/api/aspen/ask")).toHaveLength(2);

    await act(async () => {
      second.push(
        { type: "meta", promptId: "prompt-2" },
        { type: "delta", text: "Ohio is different." },
        { type: "done", model: 5, webSearch: "yes", sources: "none" },
      );
      second.close();
    });
    expect(await screen.findByText("Ohio is different.")).toBeInTheDocument();
    expect(screen.getByText("· no web search")).toBeInTheDocument();
    // The newest answer is unrated, so its rating card returns.
    expect(within(screen.getByRole("region", { name: "Your verdict" })).getByText("Rate this answer")).toBeInTheDocument();
    expect(screen.queryByText(/Later in the session/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask a follow-up" })).not.toBeInTheDocument();
  });

  it("keeps the thinking line while only empty text has arrived", async () => {
    const stream = controlledStream();
    routeFetch({ "/api/aspen/ask": () => streamResponse(stream.stream) });
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    pickRetiree();
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    await act(async () => {
      stream.push({ type: "status", text: "Searching the web" });
    });
    expect(await screen.findByText("Searching the web…")).toBeInTheDocument();
    await act(async () => {
      stream.push({ type: "delta", text: "" });
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^Thinking…$/));
    await act(async () => {
      stream.push({ type: "delta", text: "Done." }, { type: "done" });
      stream.close();
    });
    expect(await screen.findByText("Done.")).toBeInTheDocument();
  });

  it("shows an error line from the stream", async () => {
    routeFetch({
      "/api/aspen/ask": () =>
        streamResponse(
          streamOf([
            { type: "meta", promptId: "p-err" },
            { type: "delta", text: "Partial" },
            { type: "error", message: "The model is busy. Try again." },
          ]),
        ),
    });
    render(<ChatWindow stage="try" rulesUnlocked />);
    pickRetiree();
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    expect(await screen.findByText("The model is busy. Try again.")).toHaveClass("text-[var(--color-error)]");
    expect(screen.queryByText("Partial")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your verdict" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask a follow-up" })).toBeEnabled();
  });

  it("shows the server's error for a refused request", async () => {
    routeFetch({
      "/api/aspen/ask": [
        () => jsonResponse({ error: "Slow down: too many questions." }, false, 429),
        () => ({ ok: false, status: 502, body: null, json: () => Promise.reject(new Error("html")) }) as unknown as Response,
        () => jsonResponse({}, true),
      ],
    });
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    pickRetiree();
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    expect(await screen.findByText("Slow down: too many questions.")).toBeInTheDocument();

    openFollowUp();

    fireEvent.change(draftBox(), { target: { value: "Again?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getAllByText("The chatbot didn't answer. Try again.")).toHaveLength(1));

    // An OK response without a body is treated the same way.
    openFollowUp();
    fireEvent.change(draftBox(), { target: { value: "Third try" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getAllByText("The chatbot didn't answer. Try again.")).toHaveLength(2));
  });

  it("leaves failed turns out of the history it sends", async () => {
    const fetchMock = routeFetch({
      "/api/aspen/ask": [
        () => jsonResponse({ error: "Busy" }, false, 503),
        () => streamResponse(streamOf([{ type: "meta", promptId: "p" }, { type: "delta", text: "Hi" }, { type: "done" }])),
      ],
    });
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    pickRetiree();
    const question = draftBox().value;
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    await screen.findByText("Busy");
    openFollowUp();
    fireEvent.change(draftBox(), { target: { value: "Retry" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Hi");
    expect(calls(fetchMock, "/api/aspen/ask")[1].messages).toEqual([
      { role: "user", content: question },
      { role: "user", content: "Retry" },
    ]);
  });

  it("reports a dropped connection", async () => {
    routeFetch({ "/api/aspen/ask": () => Promise.reject(new Error("offline")) });
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    pickRetiree();
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    expect(await screen.findByText("The connection dropped. Try again.")).toBeInTheDocument();
  });

  it("finishes a stream that ends without a done line", async () => {
    routeFetch({
      "/api/aspen/ask": [
        () =>
          streamResponse(
            streamOf([
              { type: "meta", promptId: "p-cut" },
              { type: "delta", text: "Cut short" },
              { type: "unknown" },
            ]),
          ),
        () => streamResponse(streamOf([{ type: "meta", promptId: "p-empty" }])),
      ],
    });
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    pickRetiree();
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    expect(await screen.findByText("Cut short")).toBeInTheDocument();
    await waitFor(() => expect(saved().turns[1]).toMatchObject({ status: "done", promptId: "p-cut" }));
    expect(screen.getByRole("region", { name: "Your verdict" })).toBeInTheDocument();
    await rateAnswer();
    openFollowUp();

    fireEvent.change(draftBox(), { target: { value: "Again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(saved().turns).toHaveLength(4));
    expect(saved().turns[3]).toMatchObject({ status: "error", content: "The AI didn't answer. Try again." });
  });

  it("shows at most six sources", async () => {
    const sources = Array.from({ length: 7 }, (_, i) => ({ url: `https://example${i}.org/page`, title: `Source ${i}` }));
    routeFetch({
      "/api/aspen/ask": () =>
        streamResponse(
          streamOf([
            { type: "meta", promptId: "p" },
            { type: "delta", text: "Answer" },
            { type: "done", model: "gpt-5", webSearch: true, sources },
          ]),
        ),
    });
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    pickRetiree();
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    await screen.findByText("Answer");
    expect(screen.getAllByRole("link", { name: /^Source \d$/ })).toHaveLength(6);
    expect(screen.queryByRole("link", { name: "Source 6" })).not.toBeInTheDocument();
  });

  it("sends the details with a household question", async () => {
    const fetchMock = routeFetch({
      "/api/aspen/ask": () => streamResponse(streamOf([{ type: "meta", promptId: "p-t" }, { type: "delta", text: "Ok" }, { type: "done" }])),
    });
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    pickRetiree();
    fireEvent.click(screen.getByRole("button", { name: "+ Savings" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    await screen.findByText("Ok");
    expect(calls(fetchMock, "/api/aspen/ask")[0].meta).toMatchObject({ householdId: "az-retiree", twists: ["savings"] });
    await waitFor(() => expect(saved().twists).toEqual(["savings"]));
  });

  it("sends the participant's own question without a household or template question", async () => {
    const fetchMock = routeFetch({
      "/api/aspen/ask": () => streamResponse(streamOf([{ type: "delta", text: "Sure." }, { type: "done" }])),
    });
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    fireEvent.click(screen.getByRole("button", { name: "A caseworker" }));
    pickRetiree();
    fireEvent.click(screen.getByRole("button", { name: /Your own question/ }));
    fireEvent.change(draftBox(), { target: { value: "  Is there help with heating in Maine?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
    await screen.findByText("Sure.");
    expect(calls(fetchMock, "/api/aspen/ask")[0]).toMatchObject({
      messages: [{ role: "user", content: "Is there help with heating in Maine?" }],
      meta: { perspective: "caseworker", householdId: null, questionId: null, promptTemplate: null },
    });
    // No prompt id came back, so there is nothing to rate.
    expect(screen.queryByRole("region", { name: "Your verdict" })).not.toBeInTheDocument();
  });
});

describe("ChatWindow saved conversation", () => {
  const turns: Turn[] = [
    { key: "u1", role: "user", content: "Q1" },
    { key: "a1", role: "assistant", content: "Answer one", status: "done", promptId: "p1", model: "gpt-5", webSearch: false, sources: [] },
    { key: "u2", role: "user", content: "Q2" },
    { key: "a2", role: "assistant", content: "Half", status: "streaming", promptId: "p2" },
  ];

  function store(chat: Record<string, unknown>) {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chat));
  }

  it("restores a conversation and marks a turn cut off mid-stream", async () => {
    store({
      perspective: "caseworker",
      householdId: "ny-parent",
      questionId: "eligible",
      draft: "half typed",
      template: "the template",
      conversationId: "c-1",
      turns,
      rated: ["p1"],
    });
    routeFetch({});
    render(<ChatWindow stage="reveal" rulesUnlocked={false} />);

    expect(await screen.findByText("Interrupted. Ask again.")).toBeInTheDocument();
    expect(screen.getByText("Answer one")).toBeInTheDocument();
    expect(screen.queryByText("Half")).not.toBeInTheDocument();
    // The restored draft is still there behind "Ask a follow-up".
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
    openFollowUp();
    expect(draftBox().value).toBe("half typed");
    expect(screen.getByText("Your rating is saved. Thank you.")).toBeInTheDocument();
    expect(screen.getByText(/Later in the session, you'll check this answer/)).toBeInTheDocument();
    await waitFor(() => expect(saved().turns[3]).toMatchObject({ status: "error", content: "Interrupted. Ask again." }));
    expect(saved()).toMatchObject({ conversationId: "c-1", template: "the template", rated: ["p1"] });
  });

  it("starts over with 'New question', keeping the chosen chips", async () => {
    store({
      perspective: "caseworker",
      householdId: "ny-parent",
      questionId: "eligible",
      draft: "",
      template: null,
      conversationId: "c-1",
      turns: turns.slice(0, 2),
      rated: ["p1"],
    });
    routeFetch({});
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "New question" }));

    expect(screen.queryByText("Answer one")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A caseworker" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Working parent of two/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Eligible?" })).toHaveAttribute("aria-pressed", "true");
    expect(draftBox().value).toBe(composePrompt("caseworker", findHousehold("ny-parent")!, "eligible"));
    await waitFor(() => expect(saved().turns).toEqual([]));
    expect(saved().conversationId).not.toBe("c-1");
  });

  it("starts over with 'New question' from an open follow-up, closing it", async () => {
    store({
      perspective: "resident",
      householdId: "own",
      questionId: "amount",
      draft: "",
      template: null,
      conversationId: "c-9",
      turns: turns.slice(0, 2),
      rated: ["p1"],
    });
    routeFetch({});
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask a follow-up" }));
    expect(draftBox()).toHaveAttribute("placeholder", "Ask a follow-up");
    fireEvent.click(screen.getByRole("button", { name: "New question" }));
    expect(screen.getByRole("button", { name: /Your own question/ })).toHaveAttribute("aria-pressed", "true");
    expect(draftBox().value).toBe("");
    expect(draftBox()).toHaveAttribute("placeholder", "Pick a household above, or type your own question");
    expect(screen.queryByRole("button", { name: "Ask a follow-up" })).not.toBeInTheDocument();
  });

  it("falls back to defaults for a partial or unknown saved state", async () => {
    store({ perspective: "alien", householdId: "own", questionId: "amount", conversationId: "c-2", turns: [] });
    routeFetch({});
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Your own question/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "A resident" })).toHaveAttribute("aria-pressed", "true");
    expect(draftBox().value).toBe("");
    await waitFor(() => expect(saved()).toMatchObject({ draft: "", template: null, rated: [], perspective: "resident" }));
  });

  it("ignores a saved value without turns", async () => {
    store({ perspective: "caseworker", householdId: "ga-ctc", turns: "nope" });
    routeFetch({});
    render(<ChatWindow stage="try" rulesUnlocked={false} />);
    await waitFor(() => expect(saved().turns).toEqual([]));
    expect(screen.getByRole("button", { name: "A resident" })).toHaveAttribute("aria-pressed", "true");
    expect(draftBox().value).toBe("");
  });

  it("locks a new question until the restored answer is rated, and points to the rating", async () => {
    store({
      perspective: "resident",
      householdId: "az-retiree",
      questionId: "amount",
      draft: "",
      template: null,
      conversationId: "c-3",
      turns: turns.slice(0, 2),
      rated: [],
    });
    routeFetch({});
    const onStatus = vi.fn();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<ChatWindow stage="try" rulesUnlocked={false} onStatus={onStatus} />);
    await screen.findByText("Answer one");
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith({ asked: true, rated: false }));
    expect(screen.queryByRole("button", { name: "New question" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask a follow-up" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rate it ↓" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    await rateAnswer();
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith({ asked: true, rated: true }));
    expect(screen.getByRole("button", { name: "New question" })).toBeInTheDocument();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("offers the rules check before rating once the rules are unlocked", async () => {
    store({
      perspective: "resident",
      householdId: "az-retiree",
      questionId: "amount",
      draft: "",
      template: null,
      conversationId: "c-4",
      turns: turns.slice(0, 2),
      rated: [],
    });
    const fetchMock = routeFetch({
      "/api/aspen/rules": () =>
        jsonResponse({
          text: "No calculation.",
          computations: [],
          amount: null,
          program: null,
          period: null,
          incomplete: [],
          citations: [],
          errors: [],
        }),
    });
    render(<ChatWindow stage="foundation" rulesUnlocked />);
    const verdict = await screen.findByRole("region", { name: "Your verdict" });
    expect(within(verdict).getByText("Rate this answer")).toBeInTheDocument();
    fireEvent.click(within(verdict).getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText(/answered without running a calculation/)).toBeInTheDocument();
    expect(calls(fetchMock, "/api/aspen/rules")[0]).toEqual({
      participantId: "p-1",
      promptId: "p1",
      messages: [{ role: "user", content: "Q1" }],
    });
  });
});
