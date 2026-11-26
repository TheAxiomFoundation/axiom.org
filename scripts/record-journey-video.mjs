#!/usr/bin/env node
// Records the encoding journey to an MP4, for decks that can only play a
// video (Google Slides). It draws each frame of /preview/journey-video at
// the Aspen presenter's pace, takes a screenshot of it, and pipes the
// frames to ffmpeg, so the video has no dropped frames on any machine.
//
//   bun run dev   # in another terminal
//   node scripts/record-journey-video.mjs --out journey.mp4
//
// Options: --base (default http://localhost:3000), --fps (30), --width
// (1920), --height (1080), --hold-start and --hold-end in seconds (1.5, 6),
// --speed (1: the presenter's pace; 1.3 plays the story 30% faster).
// The clickable parts never glint in the recording.
// Needs ffmpeg on the PATH.

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg("base", "http://localhost:3000");
const out = arg("out", "journey.mp4");
const fps = Number(arg("fps", 30));
const width = Number(arg("width", 1920));
const height = Number(arg("height", 1080));
const holdStart = Number(arg("hold-start", 1.5));
const holdEnd = Number(arg("hold-end", 6));
const speed = Number(arg("speed", 1));

const browser = await chromium.launch({
  channel: "chrome", // the installed Chrome, with the GPU; Playwright's own browser is not needed
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await page.goto(`${base}/preview/journey-video`, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__journeyReady, null, { timeout: 60_000 });
await page.evaluate(() => window.__journeyReady);

const storyMs = await page.evaluate(() => window.__journeyMs);
const frames = Math.ceil(((holdStart + holdEnd) * 1000 + storyMs / speed) / (1000 / fps));
console.log(`story ${(storyMs / speed / 1000).toFixed(1)} s, ${frames} frames at ${fps} fps -> ${out}`);

const ffmpeg = spawn(
  "ffmpeg",
  ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", "16", "-movflags", "+faststart", out],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const done = new Promise((res, rej) => ffmpeg.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));

for (let f = 0; f < frames; f++) {
  const ms = (f * (1000 / fps) - holdStart * 1000) * speed;
  await page.evaluate((ms) => window.__journeyFrame(ms), ms);
  const png = await page.screenshot({ type: "png" });
  if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
  if (f % (fps * 10) === 0) console.log(`${Math.round((100 * f) / frames)}%`);
}
ffmpeg.stdin.end();
await done;
await browser.close();
console.log(`wrote ${out}`);
