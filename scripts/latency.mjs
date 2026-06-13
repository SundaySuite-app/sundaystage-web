#!/usr/bin/env node
/**
 * End-to-end latency probe: POST /frame → Supabase broadcast → subscriber.
 *   BASE=http://localhost:3000 node scripts/latency.mjs
 * Reads NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY from env or .env.local.
 * Asserts p95 < 1000 ms over 20 iterations.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ITERATIONS = Number(process.env.N ?? 20);

function envFromDotfile(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const url = envFromDotfile("NEXT_PUBLIC_SUPABASE_URL");
const anon = envFromDotfile("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !anon) {
  console.error("mangler NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY");
  process.exit(1);
}

// 1. Create a session.
const created = await (
  await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin: "web", title: "latency-probe" }),
  })
).json();
const { id, secret } = created;

// 2. Subscribe like a display would.
const supabase = createClient(url, anon);
const waiting = new Map(); // seq -> resolve(receivedAt)
const channel = supabase.channel(`stage:session:${id}`, { config: { broadcast: { self: true } } });
channel.on("broadcast", { event: "frame" }, (msg) => {
  const seq = msg.payload?.seq;
  const resolve = waiting.get(seq);
  if (resolve) resolve(performance.now());
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("subscribe timeout")), 10_000);
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timer);
      resolve();
    }
  });
});

// 3. Measure POST→broadcast for N frames.
const samples = [];
for (let i = 1; i <= ITERATIONS; i++) {
  const received = new Promise((resolve) => waiting.set(i, resolve));
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/sessions/${id}/frame`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ frame: { v: 1, kind: "message", message: `probe ${i}` }, client_seq: i }),
  });
  if (!res.ok) {
    console.error(`frame ${i} feilet: ${res.status}`);
    process.exit(1);
  }
  const t1 = await Promise.race([
    received,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`broadcast ${i} timeout`)), 5000)),
  ]).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
  samples.push(t1 - t0);
  await new Promise((r) => setTimeout(r, 120));
}

// 4. End session + report.
await fetch(`${BASE}/api/sessions/${id}/end`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});
await supabase.removeChannel(channel);

samples.sort((a, b) => a - b);
const p = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
const stats = {
  n: samples.length,
  p50: Math.round(p(0.5)),
  p95: Math.round(p(0.95)),
  max: Math.round(samples[samples.length - 1]),
};
console.log(`POST→broadcast: p50 ${stats.p50} ms · p95 ${stats.p95} ms · max ${stats.max} ms (n=${stats.n})`);

if (stats.p95 >= 1000) {
  console.error("✗ p95 over budsjettet på 1000 ms");
  process.exit(1);
}
console.log("✓ latensbudsjett holdt (p95 < 1 s)");
process.exit(0);
