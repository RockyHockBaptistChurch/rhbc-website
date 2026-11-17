// Checks the plain-English change list used in staff save messages (_worker/changes.js).
// Run from the repository root: node _source/tests/tchanges.mjs
// 1) Describes the last 40 saves in the history (must not crash, prints the titles).
// 2) Checks a made-up save with one of each kind of change.
import { describeChanges, commitMessage } from "../../_worker/changes.js";
import { execSync } from "child_process";
import fs from "fs";
import assert from "assert";

const show = (rev) => { try { return JSON.parse(execSync(`git show ${rev}:data/site.json`, { maxBuffer: 1e8 })); } catch { return null; } };
const revs = execSync("git log --format=%H -n 40 -- data/site.json").toString().trim().split("\n");
for (const r of revs) {
  const a = show(r + "^"), b = show(r);
  if (!a || !b) continue;
  console.log(r.slice(0, 7), commitMessage("Staff", describeChanges(a, b), []).split("\n")[0]);
}

const a = JSON.parse(fs.readFileSync("data/site.json", "utf8"));
const b = structuredClone(a);
b.events.push({ id: "t1", title: "Test Dinner", date: "2026-11-23", start: "18:00", cats: ["fellowship"], auds: ["all"] });
b.weekly[0].start = "10:00";
b.schedChanges.push({ id: "t2", date: "2026-11-25", mode: "some", ids: [b.weekly[0].id], note: "Test" });
b.specials[0].hidden = !b.specials[0].hidden;
b.bulletins.unshift({ d: "2099-01-04", t: "", a: "bulletins/2099/20990104 RHBC Bulletin.pdf", s: {} });
b.alert = { kind: "cancel", title: "Test Alert", until: "" };
const ch = describeChanges(a, b);
const want = ["Turned on site alert", "Added one-time event \"Test Dinner\"", "start time", "Canceled", "special event", "Added bulletin for Jan 4, 2099"];
for (const w of want) assert(ch.some((c) => c.includes(w)), "missing: " + w + "\n" + ch.join("\n"));
assert.deepStrictEqual(describeChanges(a, a), []);
const msg = commitMessage("Staff", ch, ["x.pdf"]);
assert(msg.startsWith("Staff: ") && msg.includes("(and " + (ch.length - 1) + " more)") && msg.trim().endsWith("Saved-By: Staff"));
console.log("\nMade-up save:\n" + msg + "\n\nPASS");
