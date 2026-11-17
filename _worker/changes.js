// Plain-English list of what a staff save changed in data/site.json, for the GitHub commit message.
// describeChanges(oldData, newData) returns lines such as
//   Added one-time event "Halloween" (Oct 31, 2026)
//   Hid special event "CentriFuge Camp"
// It only reads the two copies of the data; it never changes anything.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? MONTHS[+m[2] - 1] + " " + +m[3] + ", " + m[1] : String(s || "");
}
function fmtMonth(s) {
  const m = /^(\d{4})-(\d{2})/.exec(String(s || ""));
  return m ? FULL_MONTHS[+m[2] - 1] + " " + m[1] : String(s || "");
}
const q = (s) => '"' + short(s, 40) + '"';
function short(s, n) {
  s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}
const DATE_KEYS = ["date", "until", "from"];
const TIME_KEYS = ["start", "end"];
function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ""));
  if (!m) return String(t || "");
  const h = +m[1];
  return (h % 12 || 12) + ":" + m[2] + (h < 12 ? " AM" : " PM");
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// Field names in plain words. Fields that mean the same thing share a word, so it's listed once.
const FIELD = {
  title: "title", date: "date", start: "time", end: "time", loc: "location", desc: "details", note: "note",
  url: "link", cat: "ministry", cats: "ministry", auds: "who it's for", until: "end date", from: "start date",
  text: "text", reg: "registration link", links: "links", name: "name", role: "role", phone: "phone",
  email: "email", bio: "bio", ini: "initials", photo: "photo", img: "photo", a: "file", t: "title",
  cap: "caption", year: "year", dow: "day", n: "which week", mode: "repeat pattern", skip: "skipped dates",
  moves: "moved dates", u: "link", attach: "attachment", ids: "what's affected", wid: "activity",
};
const BULLETIN_FIELD = { a: "PDF", t: "special day", s: "message" };
const MESSAGE_FIELD = { title: "message title", scr: "Scripture", by: "speaker", series: "series" };

function fieldList(a, b, names, skip = []) {
  const out = [];
  const keys = [...new Set([...Object.keys(obj(a)), ...Object.keys(obj(b))])];
  for (const k of keys) {
    if (skip.includes(k) || same(a[k], b[k])) continue;
    if (names === BULLETIN_FIELD && k === "s") {
      out.push(...fieldList(obj(a.s), obj(b.s), MESSAGE_FIELD));
      continue;
    }
    let w = names[k] || FIELD[k] || k;
    // Dates and times are short, so show the old and new values.
    const fmt = DATE_KEYS.includes(k) ? fmtDate : TIME_KEYS.includes(k) ? fmtTime : null;
    if (fmt && typeof (a[k] ?? "") === "string" && typeof (b[k] ?? "") === "string") {
      w += " " + (a[k] ? fmt(a[k]) : "(none)") + " → " + (b[k] ? fmt(b[k]) : "(none)");
      if (TIME_KEYS.includes(k)) w = (k === "start" ? "start " : "end ") + w;
    }
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

// Matches old and new items: by id when they have one, otherwise by key, then by text or link.
function match(oldList, newList, keyOf) {
  const pairs = [], usedOld = new Set(), usedNew = new Set();
  const tryKey = (fn) => {
    newList.forEach((n, j) => {
      if (usedNew.has(j)) return;
      const k = fn(n);
      if (k == null || k === "") return;
      const i = oldList.findIndex((o, i2) => !usedOld.has(i2) && fn(o) === k);
      if (i >= 0) { pairs.push([i, j]); usedOld.add(i); usedNew.add(j); }
    });
  };
  tryKey(keyOf);
  tryKey((x) => x && x.text);
  tryKey((x) => x && (x.url || x.u));
  return {
    pairs,
    removed: oldList.map((_, i) => i).filter((i) => !usedOld.has(i)),
    added: newList.map((_, j) => j).filter((j) => !usedNew.has(j)),
  };
}

// One section of the data that is a list of items (events, bulletins, staff and so on).
function listSection(out, oldList, newList, s) {
  oldList = arr(oldList); newList = arr(newList);
  const { pairs, removed, added } = match(oldList, newList, s.key);
  for (const j of added) out.push("Added " + s.what + " " + s.label(newList[j]));
  for (const i of removed) out.push("Deleted " + s.what + " " + s.label(oldList[i]));
  for (const [i, j] of pairs) {
    const a = oldList[i], b = newList[j];
    if (same(a, b)) continue;
    if (s.hide && !!a.hidden !== !!b.hidden) {
      out.push(b.hidden ? "Hid " + s.what + " " + s.label(b) : "Showed " + s.what + " " + s.label(b) + " on the site");
    }
    const f = fieldList(a, b, s.names || FIELD, ["hidden", "id"]);
    if (f.length) out.push("Changed " + s.what + " " + s.label(b) + ": " + f.join(", "));
  }
  // Order (only for lists people reorder on purpose).
  if (s.order) {
    const kept = pairs.slice().sort((x, y) => x[0] - y[0]);
    const before = kept.map((p) => p[1]);
    const after = before.slice().sort((x, y) => x - y);
    if (!same(before, after)) {
      const firstOld = kept[0] && kept[0][1];
      const top = after[0];
      if (top !== firstOld && top != null) out.push("Moved " + s.what + " " + s.label(newList[top]) + " to the top");
      else out.push("Changed the order of " + s.plural);
    }
  }
}

export function describeChanges(oldData, newData) {
  const A = obj(oldData), B = obj(newData);
  const out = [];
  const activityName = (id) => {
    const w = [...arr(B.weekly), ...arr(B.monthly), ...arr(A.weekly), ...arr(A.monthly)].find((x) => x && x.id === id);
    return w ? w.title : id;
  };

  // Site alert (the banner at the top of every page)
  if (!same(A.alert, B.alert)) {
    if (!A.alert && B.alert) out.push("Turned on site alert " + q(B.alert.title));
    else if (A.alert && !B.alert) out.push("Turned off site alert " + q(A.alert.title));
    else out.push("Changed site alert " + q(B.alert.title) + ": " + fieldList(A.alert, B.alert, FIELD).join(", "));
  }

  listSection(out, A.notices, B.notices, {
    what: "notice", plural: "notices", order: true, key: (x) => x && x.id, label: (x) => q(x.text),
  });
  listSection(out, A.events, B.events, {
    what: "one-time event", key: (x) => x && x.id, label: (x) => q(x.title) + " (" + fmtDate(x.date) + ")",
  });
  listSection(out, A.weekly, B.weekly, {
    what: "weekly service", key: (x) => x && x.id, label: (x) => q(x.title) + " (" + (DAYS[x.dow] || "") + "s)",
  });
  listSection(out, A.monthly, B.monthly, {
    what: "monthly event", key: (x) => x && x.id, label: (x) => q(x.title),
  });

  // Cancellations for one date (from Cancel This Date on the Calendar)
  const canceled = (c) => (c.mode === "all" ? "everything" : arr(c.ids).map(activityName).join(", ") || "nothing");
  const note = (c) => (c.note ? " (note: " + q(c.note) + ")" : "");
  {
    const { pairs, removed, added } = match(arr(A.schedChanges), arr(B.schedChanges), (x) => x && x.id);
    for (const j of added) { const c = B.schedChanges[j]; out.push("Canceled " + canceled(c) + " on " + fmtDate(c.date) + note(c)); }
    for (const i of removed) { const c = A.schedChanges[i]; out.push("Restored " + canceled(c) + " on " + fmtDate(c.date)); }
    for (const [i, j] of pairs) {
      const a = A.schedChanges[i], b = B.schedChanges[j];
      if (same(a, b)) continue;
      out.push("Changed what's canceled on " + fmtDate(b.date) + ": now " + canceled(b) + note(b));
    }
  }
  listSection(out, A.overrides, B.overrides, {
    what: "one-date change", key: (x) => x && x.id, label: (x) => "to " + q(activityName(x.wid)) + " on " + fmtDate(x.date),
  });

  listSection(out, A.specials, B.specials, {
    what: "special event", plural: "special events", order: true, hide: true, key: (x) => x && x.id, label: (x) => q(x.title),
  });
  listSection(out, A.bulletins, B.bulletins, {
    what: "bulletin", names: BULLETIN_FIELD, key: (x) => x && x.d, label: (x) => "for " + fmtDate(x.d),
  });
  listSection(out, A.newsletters, B.newsletters, {
    what: "newsletter", names: { a: "PDF", t: "title" }, key: (x) => x && x.d, label: (x) => "for " + fmtMonth(x.d),
  });
  listSection(out, A.staff, B.staff, {
    what: "staff member", plural: "staff", order: true, key: (x) => x && x.id, label: (x) => q(x.name),
  });
  listSection(out, A.careers, B.careers, {
    what: "job posting", key: (x) => x && x.t, label: (x) => q(x.t),
  });
  listSection(out, A.photos, B.photos, {
    what: "photo", key: (x) => x && x.id, label: (x) => q(x.cap || String(x.a || "").split("/").pop()),
  });

  if (!same(A.live, B.live)) out.push("Changed live stream settings: " + fieldList(obj(A.live), obj(B.live), {
    mode: "on/off", before: "minutes before", after: "minutes after", url: "link",
  }).join(", "));

  const sa = obj(A.svcNotes), sb = obj(B.svcNotes);
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (same(sa[k], sb[k])) continue;
    const t = (sb[k] || sa[k] || {}).t;
    out.push((!sa[k] ? "Added" : !sb[k] ? "Removed" : "Changed") + " Worship Services note for video " + k + (t ? " (" + q(t) + ")" : ""));
  }
  if (!same(A.locations, B.locations)) out.push("Changed the list of saved locations");
  if (!same(A.bulletinSkip, B.bulletinSkip)) out.push("Changed bulletin events not to suggest");

  const known = ["alert", "notices", "events", "weekly", "monthly", "schedChanges", "overrides", "specials", "bulletins",
    "newsletters", "staff", "careers", "photos", "live", "svcNotes", "locations", "bulletinSkip"];
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (!known.includes(k) && !same(A[k], B[k])) out.push("Changed " + k);
  }
  return out;
}

// The commit message: a one-line title GitHub shows in History, then the full list.
export function commitMessage(name, changes, added) {
  const MAX = 40;
  let title;
  if (!changes.length) title = name + ": Saved website content (no content changes found)";
  else {
    title = name + ": " + short(changes[0], 130);
    if (changes.length > 1) title += " (and " + (changes.length - 1) + " more)";
  }
  let body = "";
  if (changes.length > 1) {
    body += "\n\nChanges:\n" + changes.slice(0, MAX).map((c) => "- " + c).join("\n");
    if (changes.length > MAX) body += "\n- …and " + (changes.length - MAX) + " more";
  }
  if (added.length) body += "\n\nFiles added:\n" + added.map((f) => "- " + f).join("\n");
  return title + body + "\n\nSaved-By: " + name;
}
