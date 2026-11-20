// What the person chose to see on the bar; the hover panel always shows everything.
// Limits are opt-out lists, so anything new shows by itself. Session numbers are opt-in.
// Prefs: { hidden: [providerId], showResetTime: bool,
//          showBars: bool, sessionOnBar: ["context"|"calls"|"compactions"] }
// showResetTime: every window shows its time to reset, not only amber and red ones.
// showBars: each limit has its bar when there's room; off, the bar shows numbers only.

const normalize = (p) => ({
  hidden: [...(p?.hidden ?? [])],
  showResetTime: p?.showResetTime === true,
  showBars: p?.showBars !== false,
  sessionOnBar: [...(p?.sessionOnBar ?? [])],
});

// Saved choices win once they exist; until then the layout's props preset them.
export function effectivePrefs(saved, props) {
  return normalize(saved ?? props);
}

export function isShown(prefs, providerId) {
  return !prefs.hidden.includes(providerId);
}

const flip = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function toggleProvider(prefs, providerId) {
  return { ...normalize(prefs), hidden: flip(prefs.hidden, providerId) };
}

export function toggleShowResetTime(prefs) {
  return { ...normalize(prefs), showResetTime: !prefs.showResetTime };
}

export function toggleShowBars(prefs) {
  return { ...normalize(prefs), showBars: !prefs.showBars };
}

export const isOnBar = (prefs, row) => prefs.sessionOnBar.includes(row);

export function toggleOnBar(prefs, row) {
  return { ...normalize(prefs), sessionOnBar: flip(prefs.sessionOnBar, row) };
}
