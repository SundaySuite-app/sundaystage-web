#!/usr/bin/env node
/**
 * Full session-lifecycle smoke against a running server:
 *   BASE=http://localhost:3000 node scripts/smoke.mjs
 *   BASE=https://stage.sundaysuite.app node scripts/smoke.mjs
 * Needs a real Supabase behind the server (frames go through the RPC).
 */
const BASE = process.env.BASE ?? "http://localhost:3000";

let failed = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`✓ ${name}`);
  else {
    failed++;
    console.error(`✗ ${name} ${extra}`);
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

const frame = (n) => ({ v: 1, kind: "message", message: `smoke ${n}` });

// 1. Create
const created = await api("/api/sessions", {
  method: "POST",
  body: JSON.stringify({ origin: "web", title: "Røyktest" }),
});
check("create session 201", created.status === 201, `got ${created.status}`);
const { id, code, secret } = created.body ?? {};
check("create returns id/code/secret", Boolean(id && /^\d{6}$/.test(code ?? "") && secret));

// 2. Join by code (no frame yet)
const joined = await api(`/api/sessions/by-code/${code}`);
check("join by code 200", joined.status === 200, `got ${joined.status}`);
check("join: frame is null, seq 0", joined.body?.frame === null && joined.body?.seq === 0);

// 3. Frames with monotonic client_seq
const auth = { Authorization: `Bearer ${secret}` };
for (let i = 1; i <= 3; i++) {
  const r = await api(`/api/sessions/${id}/frame`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ frame: frame(i), client_seq: i }),
  });
  check(`frame ${i} accepted with seq ${i}`, r.status === 200 && r.body?.seq === i, JSON.stringify(r));
}

// 4. Stale client_seq → 409
const stale = await api(`/api/sessions/${id}/frame`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ frame: frame(99), client_seq: 2 }),
});
check("stale client_seq → 409", stale.status === 409, `got ${stale.status}`);

// 5. Bad secret → 401; junk frame → 400
const badAuth = await api(`/api/sessions/${id}/frame`, {
  method: "POST",
  headers: { Authorization: "Bearer feil" },
  body: JSON.stringify({ frame: frame(1) }),
});
check("wrong secret → 401", badAuth.status === 401, `got ${badAuth.status}`);
const junk = await api(`/api/sessions/${id}/frame`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ frame: { v: 1, kind: "evil" } }),
});
check("invalid frame → 400", junk.status === 400, `got ${junk.status}`);

// 6. State poll matches
const state = await api(`/api/sessions/${id}/state`);
check(
  "state poll: seq 3, latest frame",
  state.body?.seq === 3 && state.body?.frame?.message === "smoke 3",
  JSON.stringify(state.body),
);

// 7. Setlist roundtrip
const put = await api(`/api/sessions/${id}/setlist`, {
  method: "PUT",
  headers: auth,
  body: JSON.stringify({ setlist: { slides: [{ lines: ["a"] }] } }),
});
check("setlist saved", put.status === 200, `got ${put.status}`);

// 8. Command broadcast endpoint
const cmd = await api(`/api/sessions/${id}/command`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ cmd: "next", cmd_seq: 1 }),
});
check("command accepted", cmd.status === 200, `got ${cmd.status}`);

// 8b. Realtime RECEIVE over a PRIVATE channel: a real anon subscriber must still
// get a server broadcast after the realtime.messages RLS change (a too-tight
// policy → CHANNEL_ERROR → caught HERE before it blanks every display). Connects
// straight to Supabase, so it needs the public env; skipped when unset.
const RT_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const RT_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (RT_URL && RT_ANON) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(RT_URL, RT_ANON, { auth: { persistSession: false } });
  const received = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const ch = sb.channel(`stage:session:${id}`, {
      config: { broadcast: { self: false }, private: true },
    });
    ch.on("broadcast", { event: "frame" }, () => finish(true));
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await api(`/api/sessions/${id}/frame`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ frame: frame(4), client_seq: 4 }),
        });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        finish(false);
      }
    });
    setTimeout(() => finish(false), 8000);
  });
  check(
    "anon private channel receives server broadcast",
    received === true,
    "→ realtime.messages receive policy too tight OR private flag missing (displays would blank)",
  );

  // 8c. Commands channel hardening: the desktop app subscribes to
  // stage:session:<id>:commands as a PRIVATE channel. Assert an anon private
  // subscriber still receives a server-published command (a too-tight policy or
  // a missing send-side private flag → remote control silently dies).
  const cmdReceived = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const ch = sb.channel(`stage:session:${id}:commands`, {
      config: { private: true },
    });
    ch.on("broadcast", { event: "command" }, () => finish(true));
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await api(`/api/sessions/${id}/command`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ cmd: "next", cmd_seq: 2 }),
        });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        finish(false);
      }
    });
    setTimeout(() => finish(false), 8000);
  });
  check(
    "anon private commands channel receives server broadcast",
    cmdReceived === true,
    "→ desktop remote control would break (receive policy too tight OR private send flag missing)",
  );
  await sb.removeAllChannels();
} else {
  console.log("· skipping realtime receive check (set NEXT_PUBLIC_SUPABASE_URL + _ANON_KEY)");
}

// 8c. Signed commands: the server-broadcast command must carry a valid HMAC
// (what the desktop verifies before dispatching), and a FORGED client send on
// the same channel must NOT verify — the whole point of the signature.
if (RT_URL && RT_ANON) {
  const verifySig = async (payload) => {
    if (!payload?.sig) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}:${payload.cmd}:${payload.cmd_seq}`),
    );
    const expected = Buffer.from(mac).toString("base64url");
    return expected === payload.sig;
  };

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(RT_URL, RT_ANON, { auth: { persistSession: false } });
  const payloads = [];
  const ch = sb.channel(`stage:session:${id}:commands`, {
    config: { broadcast: { self: true }, private: true },
  });
  ch.on("broadcast", { event: "command" }, (msg) => payloads.push(msg.payload ?? {}));
  const subscribed = await new Promise((resolve) => {
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve(true);
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolve(false);
    });
    setTimeout(() => resolve(false), 8000);
  });
  check("commands channel subscribes (desktop receive path)", subscribed === true);
  if (subscribed) {
    // Legit path: POST → server signs → broadcast.
    await api(`/api/sessions/${id}/command`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ cmd: "next", cmd_seq: 2 }),
    });
    // Forged path: a client send straight onto the channel, no secret involved.
    await ch.send({ type: "broadcast", event: "command", payload: { cmd: "black", cmd_seq: 99 } });
    await new Promise((r) => setTimeout(r, 4000));

    const legit = payloads.find((p) => p.cmd_seq === 2);
    const forged = payloads.find((p) => p.cmd_seq === 99);
    check("server command arrives with a signature", Boolean(legit?.sig), JSON.stringify(payloads));
    check("server command signature verifies", legit ? await verifySig(legit) : false);
    check(
      "forged client command does NOT verify (desktop would drop it)",
      forged ? !(await verifySig(forged)) : true,
      "forged payload verified — remote-control auth is broken",
    );
  }
  await sb.removeAllChannels();
} else {
  console.log("· skipping signed-command check (set NEXT_PUBLIC_SUPABASE_URL + _ANON_KEY)");
}

// 9. End → join is gone, frame refused with 410
const end = await api(`/api/sessions/${id}/end`, { method: "POST", headers: auth });
check("end 200", end.status === 200);
const goneJoin = await api(`/api/sessions/by-code/${code}`);
check("ended session not joinable", goneJoin.status === 404, `got ${goneJoin.status}`);
const afterEnd = await api(`/api/sessions/${id}/frame`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ frame: frame(5), client_seq: 50 }),
});
check("frame after end → 410", afterEnd.status === 410, `got ${afterEnd.status}`);

// 10. Unknown code
const unknown = await api(`/api/sessions/by-code/000000`);
check("unknown code → 404", unknown.status === 404, `got ${unknown.status}`);

if (failed) {
  console.error(`\n${failed} smoke check(s) FAILED`);
  process.exit(1);
}
console.log("\n✓ all smoke checks passed");
