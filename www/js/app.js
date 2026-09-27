// @ts-check
/* app.js — the entry point. Loads or starts a run, renders, and re-renders on
   every dispatch. Nothing else lives here.

   A `?seed=` in the URL starts a specific run, which is what SPEC §13 phase 3
   wants from a dev panel and what §9's end card needs to offer a rerun on the
   same seed. */

import { init, subscribe } from './ui/store.js';
import { render } from './ui/render.js';
import { loadPortraits } from './ui/portrait.js';

const url = new URL(location.href);
const raw = url.searchParams.get('seed');
const seed = raw !== null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : undefined;

init(seed);
subscribe(render);

/* Resolve the sprite metadata before the first paint so portraits do not
   flicker from drawn bust to sprite. It cannot fail the boot: if the art has
   not been generated, or the device is offline on a first run, the drawn
   portraits are used and the game plays exactly the same. */
loadPortraits().finally(render);

/* The Android hardware back button closes the app mid-run without this
   (SPEC §12). Capacitor's App plugin is only present in the shell, so this is
   registered lazily and is a no-op on the web. */
if (/** @type {any} */ (window).Capacitor) {
  import('@capacitor/app')
    .then(({ App }) => {
      App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) history.back();
        // Otherwise swallow it: a run in progress should not be closed by a
        // stray back press. Exiting is a deliberate act, added in phase 6.
      });
    })
    .catch(() => { /* web build: no plugin, nothing to do */ });
}
