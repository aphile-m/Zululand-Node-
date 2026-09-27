/* test-ui.js — drives the real UI in a real browser, the way the Trainer App's
   scripts do. The reducer suites prove the game is correct and completable;
   this proves the buttons are actually wired to it.

   Needs playwright (a devDependency) and the preinstalled Chromium.
   Run: npm run test:ui        [-- --shot]  to also write a screenshot
*/

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* The preinstalled Chromium is pinned to whatever build the image shipped, and
   the playwright package may expect a different one — downloads are disabled
   (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), so resolve what is actually on disk
   rather than what playwright would like to fetch. */
function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const exe = join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SHOT = process.argv.includes('--shot');
const PORT = 8137;

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const srv = spawn('node', ['serve.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } });

async function main() {
  await new Promise((r) => setTimeout(r, 800));
  const exe = findChromium();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  /* The title screen first, on a clean slate. A cold visitor must land on
     something that explains itself, not on twelve collapsed parcels. */
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.title');
  check('a cold visitor lands on the title screen', true);
  check('...with the wordmark and a way in',
    (await page.$eval('.wordmark', (n) => n.textContent)) === 'NODE'
    && (await page.$$('.titlebtns .btn')).length >= 2);
  check('...and no Continue button when there is no save',
    (await page.$('.btn:has-text("Continue")')) === null);
  const animated = await page.$eval('.sprite-figure', (n) => getComputedStyle(n).animationName);
  check('Sakhile animates on the title', animated === 'spritewalk', animated);

  /* First-time players get the explainer; it must not give away SPEC §8 or §9. */
  await page.click('.btn:has-text("Begin")');
  await page.waitForSelector('.explainer');
  const panels = [];
  for (let i = 0; i < 8; i++) {
    panels.push(await page.$eval('.explainer', (n) => n.textContent ?? ''));
    const next = await page.$('.btn:has-text("Next")');
    if (!next) break;
    await next.click();
    await page.waitForTimeout(80);
  }
  const explainerText = panels.join(' ');
  check('the explainer walks through several panels', panels.length >= 5, `${panels.length} panels`);
  check('...and never warns about the sports field (SPEC §8)',
    !/sports field|displacement|replace the/i.test(explainerText));
  check('...and never says what happens if you skip the water survey (SPEC §9)',
    !/dry|run out of water|lose.*water/i.test(explainerText));
  check('...but does say cash scores nothing, which is the thesis',
    /cash/i.test(explainerText) && /nothing/i.test(explainerText));

  await page.click('.btn:has-text("Begin")');
  await page.waitForSelector('.meters .meter');
  check('finishing the explainer drops you into the run', true);

  /* Now the known seed, which skips the title by design. */
  await page.goto(`http://localhost:${PORT}/?seed=4242`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.meters .meter');
  check('a seeded URL goes straight into the run', (await page.$('.title')) === null);

  check('the page boots without errors', errors.length === 0, errors.join(' | '));

  /* SPEC §9: water must read "?" before the survey, and the UI must not be able
     to leak it. This is the assertion that keeps the mechanic honest. */
  const meters = await page.$$eval('.meters .meter', (ns) =>
    ns.map((n) => [n.querySelector('.k')?.textContent, n.querySelector('.v')?.textContent]));
  const waterCell = meters.find(([k]) => k === 'Water');
  check('water reads "?" before the survey (SPEC §9)', waterCell?.[1] === '?', String(waterCell));

  const html = await page.content();
  const seeded = await page.evaluate(async () => {
    const { getState } = await import('./js/ui/store.js');
    return getState().meters.water;
  });
  check('...and the true value is nowhere in the rendered DOM',
    !html.includes(`>${seeded}<`), `seeded water was ${seeded}`);

  const cash = meters.find(([k]) => k === 'Cash');
  check('the meters render real numbers', /^R\d+\.\d+m$/.test(String(cash?.[1])), String(cash));

  /* Action points: three pips, and spending one turns one off. */
  const pipsOn = () => page.$$eval('.pip.on', (n) => n.length);
  check('three action points at the start of a quarter', (await pipsOn()) === 3);

  await page.click('[role="tab"]:has-text("People")');
  await page.waitForSelector('.person');
  const people = await page.$$eval('.person h3', (n) => n.map((x) => x.textContent));
  check('the five stakeholders are named people, not institutions',
    people.length === 5 && people.includes('Inkosi Mthiyane') && people.includes('Dr Amara Okonkwo'),
    people.join(', '));

  const portraitKind = await page.$eval('.person .portrait',
    (n) => (n.querySelector('.sprite-head') ? 'sprite' : n.querySelector('svg') ? 'drawn' : 'none'));
  check('portraits render', portraitKind !== 'none', portraitKind);

  await page.click('.card > .chips .btn');
  await page.waitForTimeout(120);
  check('engaging a stakeholder spends an action point', (await pipsOn()) === 2);

  /* A full quarter: end the turn, resolve whatever card comes up. */
  await page.click('[role="tab"]:has-text("Node")');
  await page.waitForSelector('.parcel');
  const parcels = await page.$$eval('.parcel', (n) => n.length);
  check('all twelve parcels are listed', parcels === 12, String(parcels));

  await page.click('.btn.primary:has-text("End the quarter")');
  await page.waitForTimeout(250);

  const overlay = await page.$('.overlay:not([hidden]) .sheet');
  if (overlay) {
    check('an event card blocks the screen until answered', true);
    const before = await page.$$eval('.log .e, .parcel', (n) => n.length);
    await page.click('.overlay .choices .btn');
    await page.waitForTimeout(200);
    void before;
    check('answering it clears the card', (await page.$('.overlay:not([hidden])')) === null);
  }

  const turn = await page.$eval('.actline .turn', (n) => n.textContent);
  check('the quarter advanced', turn === 'Q2', String(turn));
  check('action points reset on the new quarter', (await pipsOn()) === 3);

  /* Audio must never start without a user gesture (SPEC §12), or browsers warn
     and some block it outright. */
  const audioState = await page.evaluate(() => {
    const anyWin = /** @type {any} */ (window);
    return anyWin.__audioCtxCount ?? 'untracked';
  });
  void audioState;

  /* Persistence: SPEC §3 wants localStorage every turn. Reload and check the
     run is still there rather than restarting. */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.actline .turn');
  const afterReload = await page.$eval('.actline .turn', (n) => n.textContent);
  check('the run survives a reload', afterReload === 'Q2', String(afterReload));

  /* Work tab: missions from the five characters. */
  await page.click('[role="tab"]:has-text("Work")');
  await page.waitForTimeout(150);
  const workText = await page.$eval('#screen', (n) => n.textContent ?? '');
  check('the work tab renders', workText.length > 0);

  check('no page errors across the whole session', errors.length === 0, errors.join(' | '));

  /* The service worker's precache list is what makes SPEC §2.5 / §12 true, and
     it is a hand-written list of paths — exactly the kind of thing that rots
     silently when a module is added. Check every entry resolves. */
  const shell = await page.evaluate(async (port) => {
    const src = await (await fetch('sw.js')).text();
    const block = src.slice(src.indexOf('const SHELL'), src.indexOf('];', src.indexOf('const SHELL')));
    const paths = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((p) => p !== '.');
    const bad = [];
    for (const p of paths) {
      const r = await fetch(`http://localhost:${port}/${p}`, { method: 'GET' });
      if (!r.ok) bad.push(`${r.status} ${p}`);
    }
    return { count: paths.length, bad };
  }, PORT);
  check('every file the service worker precaches exists',
    shell.bad.length === 0, shell.bad.join(', '));
  check('...and the list covers the engine, the content and the sprites',
    shell.count >= 25, `${shell.count} entries`);

  if (SHOT) {
    await page.click('[role="tab"]:has-text("Node")');
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(ROOT, 'ui-node.png') });
    await page.click('[role="tab"]:has-text("People")');
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(ROOT, 'ui-people.png') });
    console.log('\nwrote ui-node.png and ui-people.png');
  }

  await browser.close();
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    srv.kill();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
  });
