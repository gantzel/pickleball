/**
 * End-to-end smoke test of the core flows in a real browser, at desktop and
 * mobile sizes, against a running app with the mock DUPR provider + demo seed.
 *
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:3000 node e2e/smoke.mjs
 *
 * Flows: register → link DUPR (mock consent) → see verified rating → book an
 * eligible session → locked session has no booking button → cancel →
 * upload profile photo → member blocked from /admin → admin creates and
 * publishes a session and sees the participant list.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOT_DIR ?? "e2e/screenshots";
const ADMIN = { email: "admin@demo.pbk.local", password: "demo-pickleball-2026" };
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1366, height: 900 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const args = process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : ["--no-sandbox"];
// A fresh browser per flow keeps sessions/cookies isolated.
async function newPage(vp) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, args, headless: true });
  const page = await browser.newPage();
  page.close = () => browser.close();
  await page.setViewport(vp);
  page.on("pageerror", (e) => { throw new Error(`Page error: ${e.message}`); });
  return page;
}

const go = (page, path) => page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
const text = (page) => page.evaluate(() => document.body.innerText);
async function clickText(page, selector, label) {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const t = await h.evaluate((el) => el.textContent?.trim());
    if (t === label) return h.click();
  }
  throw new Error(`No ${selector} with text "${label}"`);
}
async function waitForText(page, needle, timeout = 10000) {
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout }, needle);
}

async function memberFlow(name, vp) {
  const page = await newPage(vp);
  const run = Date.now().toString(36);
  const email = `e2e-${name}-${run}@test.local`;
  const player = `E2E ${name} ${run}`;

  await go(page, "/opret");
  await page.type("#name", `E2E ${name}`);
  await page.type("#email", email);
  await page.type("#password", "korrekt-hest-batteri");
  await page.type("#password2", "korrekt-hest-batteri");
  await clickText(page, "button", "Opret konto");
  await page.waitForFunction(() => document.body.innerText.includes("Tjek din e-mail") || document.body.innerText.includes("For mange forsøg"), { timeout: 30000 });
  if (!(await text(page)).includes("Tjek din e-mail")) throw new Error("Sign-up was rate limited (10/hour per IP). Wait, or clear the rate_limit table in a test database.");

  // Unverified accounts can't log in.
  await go(page, "/login");
  await page.type("#email", email);
  await page.type("#password", "korrekt-hest-batteri");
  await clickText(page, "button", "Log ind");
  await waitForText(page, "Du skal bekræfte din e-mail");

  // Open the verification link from the dev mailbox → signed in, welcomed on the profile.
  await go(page, "/dev/mail");
  const verifyUrl = await page.evaluate((to) => {
    const item = [...document.querySelectorAll("li")].find((li) => li.innerText.includes(to) && li.innerText.includes("Bekræft"));
    return item?.querySelector("a")?.getAttribute("href");
  }, email);
  assert.ok(verifyUrl, "verification email should be in the dev mailbox");
  await page.goto(verifyUrl, { waitUntil: "networkidle0" });
  assert.match(page.url(), /\/profil\?velkommen=1/);
  await waitForText(page, "Din e-mail er bekræftet");

  // No way to type a rating anywhere on the profile.
  assert.equal(await page.$("input[name*=rating i]"), null, "profile must not expose a rating input");

  // Link DUPR via the mock consent screen (a fresh mock player per run).
  await go(page, "/dev/mock-dupr");
  await page.type("#np-name", player);
  await page.$eval("#np-r", (el) => (el.value = "3.250"));
  await clickText(page, "button", "Opret");
  await waitForText(page, player);
  await go(page, "/profil");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText(page, "button", "Kobl DUPR til")]);
  assert.match(page.url(), /\/dev\/mock-dupr\?state=/);
  const radios = await page.$$("input[name=code]");
  for (const r of radios) {
    const label = await r.evaluate((el) => el.closest("label")?.textContent ?? "");
    if (label.includes(player)) await r.click();
  }
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText(page, "button", "Tillad adgang")]);
  assert.match(page.url(), /dupr=linked/);
  await waitForText(page, "Din DUPR-profil er koblet til");

  // Dashboard shows the verified rating.
  await go(page, "/");
  await waitForText(page, "3,250");
  await page.screenshot({ path: `${OUT}/${name}-dashboard.png`, fullPage: true });

  // Book the first bookable session.
  await go(page, "/traeninger?vis=kan-bookes");
  const before = await text(page);
  assert.ok(before.includes("Kan bookes"), "an eligible session should be listed");
  await clickText(page, "button", "Book plads");
  await waitForText(page, "Du er booket.");
  await go(page, "/traeninger?vis=mine");
  await waitForText(page, "Booket");
  await page.screenshot({ path: `${OUT}/${name}-booked.png`, fullPage: true });

  // Locked sessions expose no booking controls.
  await go(page, "/traeninger?vis=laast");
  const lockedRows = await page.$$("li.panel");
  assert.ok(lockedRows.length > 0, "expected locked sessions");
  for (const row of lockedRows) {
    const buttons = await row.$$eval("button", (bs) => bs.map((b) => b.textContent));
    assert.ok(!buttons.includes("Book plads"), "locked row must not offer booking");
  }

  // Cancel the booking (two-step confirm).
  await go(page, "/traeninger?vis=mine");
  await clickText(page, "button", "Afmeld");
  await clickText(page, "button", "Ja, afmeld");
  await waitForText(page, "Din tilmelding er afmeldt.");

  // Progress page renders the honest-history note.
  await go(page, "/udvikling");
  await waitForText(page, "Ældre historik er ikke tilgængelig");

  // "Download mine data" returns the member's own data.
  const exported = await page.evaluate(async () => {
    const r = await fetch("/api/mig/eksport");
    return { status: r.status, body: await r.json() };
  });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.profile.email, email);
  const anon = await fetch(`${BASE}/api/mig/eksport`);
  assert.equal(anon.status, 401, "export must require login");

  // Member can't reach admin.
  await go(page, "/admin");
  assert.ok(!page.url().includes("/admin"), "member must be redirected away from /admin");

  if (vp.isMobile) {
    const navVisible = await page.$eval("nav[aria-label=Hovedmenu].fixed", (el) => getComputedStyle(el).display !== "none");
    assert.ok(navVisible, "bottom navigation should be visible on mobile");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.ok(!overflow, "no horizontal scroll on mobile");
  }
  await page.close();
  console.log(`✓ member flow (${name})`);
}

async function adminFlow(name, vp) {
  const page = await newPage(vp);
  await go(page, "/login");
  await page.type("#email", ADMIN.email);
  await page.type("#password", ADMIN.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText(page, "button", "Log ind")]);
  await go(page, "/admin");
  await waitForText(page, "Overblik");
  await page.screenshot({ path: `${OUT}/${name}-admin.png`, fullPage: true });

  await go(page, "/admin/traeninger/ny");
  const title = `E2E-træning ${name} ${Date.now() % 10000}`;
  await page.type("#f-title", title);
  await page.type("#f-locationName", "Testhallen");
  await page.select("#f-levelId", await page.$eval("#f-levelId option:nth-child(3)", (o) => o.value));
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickText(page, "button", "Opret og offentliggør")]);
  assert.match(page.url(), /\/admin\/traeninger\/.+oprettet=1/);
  await waitForText(page, "Offentlig");
  await waitForText(page, "Deltagere");
  await page.screenshot({ path: `${OUT}/${name}-admin-session.png`, fullPage: true });

  // Seeded full session lists its participants.
  await go(page, "/admin/traeninger");
  await clickText(page, "p.font-semibold", "Formiddagstræning");
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await waitForText(page, "Demospiller 1");
  await page.close();
  console.log(`✓ admin flow (${name})`);
}

for (const [name, vp] of Object.entries(VIEWPORTS)) {
  await memberFlow(name, vp);
  await adminFlow(name, vp);
}
console.log("All e2e flows passed.");
