import type { Metadata } from "next";
import { JourneyDeck, type DeckMode } from "@/components/landing/journey-live/journey-deck";

export const metadata: Metadata = {
  title: "How a statute gets encoded — Axiom Foundation",
  description: "The encoder walkthrough as a slide: play it step by step, or scroll through it.",
  robots: { index: false },
};

// The encoder walkthrough for a presenter. ?mode=video (the default) plays
// one step for each "next"; ?mode=scroll scrubs the story with the wheel.
// ?embed=1 is the picture alone, for a frame inside a slide deck.
export default async function PresentEncoderPage({ searchParams }: { searchParams: Promise<{ mode?: string; embed?: string }> }) {
  const { mode, embed } = await searchParams;
  const deckMode: DeckMode = mode === "scroll" ? "scroll" : "video";
  return <JourneyDeck key={`${deckMode}${embed ? "-embed" : ""}`} mode={deckMode} embed={embed === "1"} />;
}
