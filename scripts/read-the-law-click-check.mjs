/**
 * Read-the-law click-through check: drive the real graph app in
 * Chrome, click a QUESTION node, click "Read the law", and assert the
 * popup opens a subsection-focused URL with the consumer spotlighted.
 *
 * This covers the layer the server-side sweep (read-the-law-sweep.mts)
 * cannot see: the inspector's meta → target selection → popup flow in
 * the compiled client bundle. The #190 "no question focuses" regression
 * lived exactly there (a display-fallback meta.citation hijacking the
 * curated-citation branch) and was invisible to every server-side test.
 *
 * Needs the dev server running with live data:
 *   node scripts/read-the-law-click-check.mjs
 *   SWEEP_BASE=http://localhost:3001 node scripts/read-the-law-click-check.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.SWEEP_BASE ?? "http://localhost:3000";
const CASES = [
  {
    compose: "us:statutes/26/32",
    question: "qualifying child name age and tin",
    // The consumer's citation 26 USC 32(c)(3) must focus c/3 and
    // spotlight the consumer.
    popupIncludes: ["/us/statute/26/32/c/3", "rule=eitc_qualifying_child"],
  },
  {
    compose: "us:statutes/26/22",
    question: "retired on disability before year end",
    popupIncludes: ["/us/statute/26/22/b/2", "rule=retired_on_permanent_total_disability"],
  },
];

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
});
let failures = 0;

for (const test of CASES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  // A fresh browser triggers the first-visit tours, whose steps close
  // the law popup on entry (closeAll) — mark every tour seen so the
  // check exercises the app the way a returning user meets it.
  await page.evaluateOnNewDocument(() => {
    for (const surface of ["graph", "subgraph", "reader"]) {
      const key = `axiom-tour-seen:${surface}`;
      window.localStorage.setItem(key, "1");
      window.sessionStorage.setItem(key, "1");
    }
  });
  await page.goto(`${BASE}/app?compose=${encodeURIComponent(test.compose)}`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await new Promise((r) => setTimeout(r, 4000));

  const clicked = await page.evaluate((want) => {
    const els = [...document.querySelectorAll("button, [role=button], div, span")];
    for (const el of els) {
      const t = (el.textContent || "").toLowerCase().trim();
      if (t.includes(want) && t.length < 120) {
        el.click();
        return t.slice(0, 80);
      }
    }
    return null;
  }, test.question);
  if (!clicked) {
    console.log(`FAIL ${test.compose}: question node "${test.question}" not found`);
    failures++;
    await page.close();
    continue;
  }
  await new Promise((r) => setTimeout(r, 1500));

  const hasButton = await page.evaluate(() =>
    Boolean(document.querySelector('[data-testid="read-the-law"]'))
  );
  if (!hasButton) {
    console.log(`FAIL ${test.compose}: inspector has no Read-the-law button`);
    failures++;
    await page.close();
    continue;
  }
  await page.evaluate(() =>
    document.querySelector('[data-testid="read-the-law"]').click()
  );

  let popupSrc = null;
  for (let i = 0; i < 20 && !popupSrc; i++) {
    popupSrc = await page.evaluate(
      () => document.querySelector("iframe")?.src ?? null
    );
    if (!popupSrc) await new Promise((r) => setTimeout(r, 500));
  }
  if (!popupSrc) {
    console.log(`FAIL ${test.compose}: popup never opened`);
    failures++;
  } else {
    const missing = test.popupIncludes.filter((part) => !popupSrc.includes(part));
    if (missing.length > 0) {
      console.log(`FAIL ${test.compose}: popup ${popupSrc} missing ${missing.join(", ")}`);
      failures++;
    } else {
      console.log(`ok   ${test.compose}: ${popupSrc.slice(BASE.length)}`);
    }
  }
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "click-check: all passed" : `click-check: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
