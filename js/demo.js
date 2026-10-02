/*
 * DM Rewind — demo data
 * Builds a small, made-up export in Instagram's JSON format (including its odd text
 * encoding) so the app can be tried without a real export. It goes through the same
 * parser as real files.
 */
(function () {
  "use strict";
  const DMR = (window.DMR = window.DMR || {});

  function rng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Mimic Instagram's encoding: UTF-8 bytes written as Latin-1 code points.
  function igEncode(s) {
    return unescape(encodeURIComponent(s));
  }

  const LINES = [
    "hey", "heyyy 👋", "kya kar raha hai", "nothing much, just got back", "lol", "😂😂😂", "same",
    "did you finish the assignment?", "not yet bro, deadline is tomorrow right?", "yes 11:59 pm",
    "send me the notes pls", "check drive, I uploaded them", "you're a lifesaver 🙏", "canteen?",
    "omw", "5 min", "where are you", "library 2nd floor", "bring my charger", "ok ok",
    "did you see the result", "yesss finally 🎉", "congrats!!", "party when", "this weekend?",
    "can't, going home", "haha classic", "good night", "gn 🌙", "good morning ☀️", "wake up",
    "class cancelled today", "best news all week", "what's the plan for the hackathon",
    "need one more frontend person", "I'm in", "let's meet at 6", "done", "sorry, was asleep",
    "call me when free", "can't talk, in lab", "this reel is literally you", "💀", "noo",
    "remember this? 😭", "that trip was the best", "we should go again in December",
    "booking tickets today", "how much?", "around 1400 each", "fine, book it", "✅ booked",
    "bro the wifi is dead again", "use hotspot", "mess food today 😐", "maggi at night then",
    "happy birthday!! 🎂🥳", "thank youuu ❤️", "miss you guys", "see you on monday",
    "placement test on friday", "all the best 🤞", "how did it go", "cleared round 1!",
    "let's gooo 🔥", "need help with DSA", "which topic", "graphs, BFS/DFS", "I'll send a playlist",
  ];
  const REACTS = ["❤️", "😂", "😮", "👍", "🔥", "😢"];

  function makeThread(r, opts) {
    const msgs = [];
    const start = new Date(opts.from).getTime();
    const end = new Date(opts.to).getTime();
    let t = start;
    let idx = 0;
    while (t < end && msgs.length < opts.max) {
      // Bursty conversations: a session of messages, then a gap of hours or days.
      const session = 3 + Math.floor(r() * 25);
      for (let k = 0; k < session && t < end; k++) {
        const sender = opts.people[Math.floor(r() * opts.people.length)];
        const m = { sender_name: igEncode(sender), timestamp_ms: Math.floor(t) };
        const roll = r();
        if (roll < 0.04) {
          m.photos = [{ uri: "your_instagram_activity/messages/inbox/" + opts.folder + "/photos/" + (900000 + idx) + ".jpg", creation_timestamp: Math.floor(t / 1000) }];
        } else if (roll < 0.07) {
          m.share = { link: "https://www.instagram.com/reel/DEMO" + idx.toString(36) + "/", share_text: igEncode("When the professor says 'this won't come in the exam' 😭"), original_content_owner: "campus.memes" };
          m.content = igEncode(sender + " sent an attachment.");
        } else if (roll < 0.08) {
          m.call_duration = Math.floor(r() * 2400);
          m.content = igEncode("Audio call ended");
        } else if (roll < 0.095) {
          m.audio_files = [{ uri: "your_instagram_activity/messages/inbox/" + opts.folder + "/audio/" + (700000 + idx) + ".mp4" }];
        } else {
          m.content = igEncode(LINES[Math.floor(r() * LINES.length)]);
        }
        if (r() < 0.06) {
          const other = opts.people.filter((p) => p !== sender);
          m.reactions = [{ reaction: igEncode(REACTS[Math.floor(r() * REACTS.length)]), actor: igEncode(other[Math.floor(r() * other.length)]) }];
        }
        msgs.push(m);
        idx++;
        t += 15000 + r() * 240000;
      }
      // Gaps: mostly hours, sometimes days, occasionally weeks.
      const g = r();
      t += g < 0.6 ? 3600e3 * (1 + r() * 10) : g < 0.93 ? 86400e3 * (1 + r() * 4) : 86400e3 * (7 + r() * 30);
    }
    // Shift so the newest message lands on the chat's end date, then drop anything before its start.
    const shift = msgs.length ? end - msgs[msgs.length - 1].timestamp_ms : 0;
    for (const m of msgs) m.timestamp_ms += shift;
    while (msgs.length && msgs[0].timestamp_ms < start) msgs.shift();
    msgs.reverse(); // Instagram writes newest first
    // Split into message_1 (newest) ... message_N like real exports.
    const files = [];
    for (let i = 0; i < msgs.length; i += opts.perFile) {
      files.push({
        participants: opts.people.map((p) => ({ name: igEncode(p) })),
        messages: msgs.slice(i, i + opts.perFile),
        title: igEncode(opts.title),
        is_still_participant: true,
        thread_path: opts.category + "/" + opts.folder,
        magic_words: [],
      });
    }
    return files.map((f, i) => ({
      path: "demo-export/your_instagram_activity/messages/" + opts.category + "/" + opts.folder + "/message_" + (i + 1) + ".json",
      json: JSON.stringify(f),
    }));
  }

  function buildDemoEntries() {
    const r = rng(20261002);
    const me = "Me";
    const files = [
      ...makeThread(r, { title: "Riya Kapoor", folder: "riyakapoor_1029384756", category: "inbox", people: ["Riya Kapoor", me], from: "2021-03-14T10:00:00", to: "2026-09-28T23:00:00", max: 12000, perFile: 5000 }),
      ...makeThread(r, { title: "Block 5 Hostel 🏠", folder: "block5hostel_5566778899", category: "inbox", people: ["Kabir Singh", "Ananya Rao", "Dev Patel", "Sana Sheikh", me], from: "2023-08-01T09:00:00", to: "2026-09-30T22:00:00", max: 4000, perFile: 10000 }),
      ...makeThread(r, { title: "Arjun Mehta", folder: "arjunmehta_1122334455", category: "inbox", people: ["Arjun Mehta", me], from: "2024-06-10T12:00:00", to: "2026-08-20T20:00:00", max: 900, perFile: 10000 }),
      ...makeThread(r, { title: "career.updates.daily", folder: "careerupdatesdaily_9988776655", category: "message_requests", people: ["career.updates.daily", me], from: "2026-05-01T12:00:00", to: "2026-05-03T20:00:00", max: 6, perFile: 10000 }),
    ];
    const entries = files.map((f) => ({
      path: f.path,
      size: f.json.length,
      text: () => Promise.resolve(f.json),
      blob: () => Promise.resolve(new Blob([f.json], { type: "application/json" })),
    }));
    const profile = JSON.stringify({ profile_user: [{ string_map_data: { Name: { value: me }, Username: { value: "me.demo" } } }] });
    entries.push({
      path: "demo-export/personal_information/personal_information/personal_information.json",
      size: profile.length,
      text: () => Promise.resolve(profile),
      blob: () => Promise.resolve(new Blob([profile])),
    });
    return entries;
  }

  DMR.demo = { buildDemoEntries, igEncode };
})();
