/*
 * DM Rewind — export parser
 * Reads Instagram "Download/Export your information" message files in JSON or HTML
 * format and turns them into one normalized, time-sorted list of messages per chat.
 *
 * Everything here runs locally in the browser. No network requests are made.
 */
(function () {
  "use strict";

  const DMR = (window.DMR = window.DMR || {});

  /* ------------------------------------------------------------------ */
  /* Text helpers                                                        */
  /* ------------------------------------------------------------------ */

  const utf8 = new TextDecoder("utf-8", { fatal: true });

  /**
   * Instagram's JSON export writes UTF-8 bytes as if they were Latin-1 code points
   * (so "😂" arrives as "ð\u009f\u0098\u0082"). Re-interpret those strings.
   * Strings that are already correct (any char > 0xFF, or not valid UTF-8 bytes) are left alone.
   */
  function fixText(s) {
    if (typeof s !== "string" || s.length === 0) return s;
    let high = false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 0xff) return s;
      if (c > 0x7f) high = true;
    }
    if (!high) return s;
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    try {
      return utf8.decode(bytes);
    } catch (e) {
      return s;
    }
  }

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  /** Local-time day key, e.g. "2023-07-22". */
  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /** Local-time month key, e.g. "2023-07". */
  function monthKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1);
  }

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8,
    october: 9, november: 10, december: 11,
  };

  function to24(h, ampm) {
    h = +h;
    if (!ampm) return h;
    ampm = ampm.toLowerCase().replace(/\./g, "");
    if (ampm === "pm" && h < 12) return h + 12;
    if (ampm === "am" && h === 12) return 0;
    return h;
  }

  /**
   * Parse the timestamp strings used in HTML exports. Seen formats include:
   *   "Jul 22, 2023 10:15 pm"   "Jul 22, 2023, 10:15:03 PM"   "22 Jul 2023, 22:15"
   *   "2023-07-22 22:15:00"     "July 22, 2023 at 10:15 PM"
   * Returns epoch ms (local time) or NaN.
   */
  function parseDate(str) {
    if (!str) return NaN;
    const s = str.replace(/ | /g, " ").replace(/\s+/g, " ").trim();
    let m;
    // Month D, YYYY[,| at] h:mm[:ss] [am|pm]
    m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4}),?(?: at)? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp]\.?[Mm]\.?)?$/);
    if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
      return new Date(+m[3], MONTHS[m[1].toLowerCase()], +m[2], to24(m[4], m[7]), +m[5], +(m[6] || 0)).getTime();
    }
    // D Month YYYY[,] h:mm[:ss] [am|pm]
    m = s.match(/^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4}),?(?: at)? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp]\.?[Mm]\.?)?$/);
    if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
      return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1], to24(m[4], m[7]), +m[5], +(m[6] || 0)).getTime();
    }
    // YYYY-MM-DD[ T]HH:mm[:ss]
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
    const t = Date.parse(s);
    return isNaN(t) ? NaN : t;
  }

  /* ------------------------------------------------------------------ */
  /* File discovery                                                      */
  /* ------------------------------------------------------------------ */

  const MSG_FILE = /(^|\/)message_(\d+)\.(json|html?)$/i;
  const CATEGORIES = {
    inbox: "inbox",
    message_requests: "requests",
    archived_threads: "archived",
    filtered_threads: "filtered",
  };

  function splitPath(p) {
    return p.replace(/\\/g, "/").split("/").filter(Boolean);
  }

  /** Normalize a media path from an export so it can be matched against real file paths. */
  function normUri(u) {
    if (!u) return "";
    let s = u.trim();
    try {
      s = decodeURIComponent(s);
    } catch (e) {}
    s = s.replace(/\\/g, "/").replace(/^file:\/+/i, "");
    s = s.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "");
    return s.toLowerCase();
  }

  /**
   * Media index: matches the paths written inside message files to the actual files
   * the user opened (whose paths may carry an extra top-level folder name).
   */
  function MediaIndex(entries) {
    this.byName = new Map();
    for (const e of entries) {
      const parts = splitPath(e.path);
      const base = (parts[parts.length - 1] || "").toLowerCase();
      if (!base || MSG_FILE.test(e.path)) continue;
      let list = this.byName.get(base);
      if (!list) this.byName.set(base, (list = []));
      list.push(e);
    }
    this.size = entries.length;
  }
  MediaIndex.prototype.resolve = function (uri, fromPath) {
    if (!uri || /^(https?:|data:|blob:)/i.test(uri)) return null;
    const n = normUri(uri);
    const parts = n.split("/");
    const base = parts[parts.length - 1];
    const list = this.byName.get(base);
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    // Several files share a name: pick the one with the longest matching path suffix,
    // preferring files in the same chat folder as the message file.
    let best = list[0], bestScore = -1;
    const fromDir = fromPath ? splitPath(fromPath).slice(0, -1).join("/").toLowerCase() : "";
    for (const e of list) {
      const p = splitPath(e.path).join("/").toLowerCase();
      let score = 0;
      const ep = p.split("/");
      for (let i = 1; i <= Math.min(ep.length, parts.length); i++) {
        if (ep[ep.length - i] === parts[parts.length - i]) score++;
        else break;
      }
      if (fromDir && p.startsWith(fromDir)) score += 0.5;
      if (score > bestScore) (bestScore = score), (best = e);
    }
    return best;
  };

  /* ------------------------------------------------------------------ */
  /* JSON format                                                         */
  /* ------------------------------------------------------------------ */

  function parseJsonFile(text, path) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("Couldn't read " + path + " as JSON (" + e.message + ").");
    }
    if (!data || !Array.isArray(data.messages)) {
      throw new Error(path + " doesn't look like an Instagram message file.");
    }
    const participants = (data.participants || []).map((p) => fixText(p.name || p)).filter(Boolean);
    const msgs = [];
    for (const raw of data.messages) {
      const ts = +raw.timestamp_ms || (raw.timestamp ? raw.timestamp * 1000 : NaN);
      if (!isFinite(ts)) continue;
      const m = {
        ts,
        sender: fixText(raw.sender_name || "") || "Unknown",
        text: fixText(raw.content || ""),
        media: [],
        share: null,
        reactions: null,
        call: null,
        unsent: !!raw.is_unsent,
        src: path,
      };
      const addMedia = (arr, type) => {
        if (!Array.isArray(arr)) return;
        for (const a of arr) if (a && a.uri) m.media.push({ type, uri: a.uri });
      };
      addMedia(raw.photos, "photo");
      addMedia(raw.videos, "video");
      addMedia(raw.audio_files, "audio");
      addMedia(raw.gifs, "gif");
      addMedia(raw.files, "file");
      if (raw.sticker && raw.sticker.uri) m.media.push({ type: "sticker", uri: raw.sticker.uri });
      if (raw.share) {
        const sh = raw.share;
        m.share = {
          link: sh.link || "",
          text: fixText(sh.share_text || ""),
          owner: fixText(sh.original_content_owner || ""),
        };
        if (!m.share.link && !m.share.text && !m.share.owner) m.share = null;
      }
      if (Array.isArray(raw.reactions) && raw.reactions.length) {
        m.reactions = raw.reactions.map((r) => ({ r: fixText(r.reaction || ""), actor: fixText(r.actor || "") }));
      }
      if (raw.call_duration !== undefined && raw.call_duration !== null) m.call = +raw.call_duration || 0;
      msgs.push(m);
    }
    return {
      format: "json",
      title: fixText(data.title || ""),
      participants,
      threadPath: data.thread_path || data.thread_type || "",
      msgs,
    };
  }

  /* ------------------------------------------------------------------ */
  /* HTML format                                                         */
  /* ------------------------------------------------------------------ */

  function leafText(el) {
    // Collect text from the innermost blocks so line breaks between divs survive.
    const out = [];
    const walk = (node) => {
      let hasBlockChild = false;
      for (const c of node.children) {
        if (/^(DIV|P|H\d|SECTION|LI|UL|TABLE|TR|TD)$/.test(c.tagName)) {
          hasBlockChild = true;
          break;
        }
      }
      if (!hasBlockChild) {
        const t = node.textContent.replace(/[ \t\r\f\v]+/g, " ").trim();
        if (t) out.push(t);
        return;
      }
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          const t = c.textContent.trim();
          if (t) out.push(t);
        } else if (c.nodeType === 1) walk(c);
      }
    };
    walk(el);
    return out.join("\n");
  }

  function looksLikeDate(t) {
    return t && t.length < 48 && /\d{4}/.test(t) && /\d{1,2}:\d{2}/.test(t) && !isNaN(parseDate(t));
  }

  function findBlocks(doc) {
    let blocks = Array.from(doc.querySelectorAll("div.pam, div._a6-g, div.uiBoxWhite"));
    // Drop wrappers that contain other blocks.
    blocks = blocks.filter((b) => !blocks.some((o) => o !== b && b.contains(o)));
    if (blocks.length) return blocks;
    // Unknown class names: a message block is an element whose last child is a timestamp.
    const found = [];
    for (const el of doc.body ? doc.body.querySelectorAll("div") : []) {
      const kids = el.children;
      if (kids.length < 2) continue;
      if (looksLikeDate(kids[kids.length - 1].textContent.trim())) found.push(el);
    }
    return found.filter((b) => !found.some((o) => o !== b && b.contains(o)));
  }

  function parseHtmlFile(text, path) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const title = ((doc.querySelector("title") || {}).textContent || "").trim();
    const blocks = findBlocks(doc);
    const msgs = [];
    const senders = new Set();
    for (const b of blocks) {
      const kids = Array.from(b.children);
      if (kids.length < 2) continue;
      const ts = parseDate(kids[kids.length - 1].textContent);
      if (isNaN(ts)) continue;
      const sender = kids[0].textContent.replace(/\s+/g, " ").trim() || "Unknown";
      senders.add(sender);
      const m = { ts, sender, text: "", media: [], share: null, reactions: null, call: null, unsent: false, src: path };
      const body = kids.slice(1, -1);
      const texts = [];
      for (const part of body) {
        const c = part.cloneNode(true);
        // Reactions are rendered as a list under the message.
        for (const li of c.querySelectorAll("li")) {
          const t = li.textContent.replace(/\s+/g, " ").trim();
          if (t) {
            const mm = t.match(/^(\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️\p{Emoji_Modifier}]*)\s*(.*)$/u);
            (m.reactions = m.reactions || []).push(mm ? { r: mm[1], actor: mm[2] } : { r: t, actor: "" });
          }
        }
        for (const ul of c.querySelectorAll("ul")) ul.remove();
        for (const img of c.querySelectorAll("img")) {
          const src = img.getAttribute("src");
          if (src) m.media.push({ type: /sticker/i.test(src) ? "sticker" : /\.gif$/i.test(src) ? "gif" : "photo", uri: src });
          img.remove();
        }
        for (const v of c.querySelectorAll("video")) {
          const src = v.getAttribute("src") || (v.querySelector("source") || { getAttribute: () => null }).getAttribute("src");
          if (src) m.media.push({ type: "video", uri: src });
          v.remove();
        }
        for (const a of c.querySelectorAll("audio")) {
          const src = a.getAttribute("src") || (a.querySelector("source") || { getAttribute: () => null }).getAttribute("src");
          if (src) m.media.push({ type: "audio", uri: src });
          a.remove();
        }
        for (const a of c.querySelectorAll("a[href]")) {
          const href = a.getAttribute("href");
          if (!/^https?:/i.test(href) && /\.(jpe?g|png|webp|gif|heic|mp4|mov|m4a|aac|mp3|ogg|wav|pdf)$/i.test(href)) {
            const type = /\.(mp4|mov)$/i.test(href) ? "video" : /\.(m4a|aac|mp3|ogg|wav)$/i.test(href) ? "audio" : /\.pdf$/i.test(href) ? "file" : "photo";
            if (!m.media.some((x) => x.uri === href)) m.media.push({ type, uri: href });
            a.remove();
          } else if (/^https?:/i.test(href) && !m.share) {
            m.share = { link: href, text: "", owner: "" };
          }
        }
        const t = leafText(c);
        if (t) texts.push(t);
      }
      m.text = texts.join("\n").trim();
      if (m.share && m.text.includes(m.share.link)) m.share = null; // link already visible in text
      const call = m.text.match(/(?:call|video chat) (?:ended|lasted)?.*?(\d+):(\d{2})(?::(\d{2}))?/i);
      if (call && /call/i.test(m.text) && m.text.length < 80) {
        m.call = call[3] ? +call[1] * 3600 + +call[2] * 60 + +call[3] : +call[1] * 60 + +call[2];
      }
      msgs.push(m);
    }
    // Participants line, when present: "Participants: A, B and C"
    let participants = [];
    const head = (doc.body ? doc.body.textContent : "").slice(0, 3000);
    const pm = head.match(/Participants:\s*([^\n]+?)(?:\s{2,}|\n|$)/);
    if (pm) participants = pm[1].split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
    if (!participants.length) participants = Array.from(senders);
    return { format: "html", title, participants, threadPath: "", msgs };
  }

  /* ------------------------------------------------------------------ */
  /* Owner (account holder) detection                                     */
  /* ------------------------------------------------------------------ */

  function findProfileName(text) {
    try {
      const data = JSON.parse(text);
      const stack = [data];
      while (stack.length) {
        const v = stack.pop();
        if (!v || typeof v !== "object") continue;
        if (v.string_map_data && v.string_map_data.Name && v.string_map_data.Name.value) {
          return fixText(v.string_map_data.Name.value);
        }
        for (const k in v) stack.push(v[k]);
      }
    } catch (e) {}
    return "";
  }

  function guessOwner(threads) {
    const seen = new Map();
    for (const t of threads) {
      const names = new Set(t.participants.concat(t.senders));
      for (const n of names) seen.set(n, (seen.get(n) || 0) + 1);
    }
    let best = "", bestN = 0;
    for (const [n, c] of seen) if (c > bestN) (best = n), (bestN = c);
    // Only trust it when the name shows up in more chats than any other.
    const tied = Array.from(seen.values()).filter((c) => c === bestN).length > 1;
    return tied ? "" : best;
  }

  /* ------------------------------------------------------------------ */
  /* Thread assembly                                                     */
  /* ------------------------------------------------------------------ */

  function buildThread(t) {
    // Each message file is newest-first, and message_1 is the newest file.
    // Reverse into oldest-first order, then stable-sort by time so equal timestamps
    // (HTML exports only have minute precision) keep their original order.
    const files = t.files.slice().sort((a, b) => b.n - a.n);
    let msgs = [];
    for (const f of files) msgs = msgs.concat(f.parsed.msgs.slice().reverse());
    msgs.sort((a, b) => a.ts - b.ts);

    // Drop exact duplicates (e.g. the same file opened twice).
    const out = [];
    let prev = null;
    for (const m of msgs) {
      if (prev && prev.ts === m.ts && prev.sender === m.sender && prev.text === m.text && prev.media.length === m.media.length) continue;
      out.push(m);
      prev = m;
    }

    const dayFirst = new Map();
    const dayCount = new Map();
    const monthCount = new Map();
    const senders = new Map();
    out.forEach((m, i) => {
      m.i = i;
      m.day = dayKey(m.ts);
      if (!dayFirst.has(m.day)) dayFirst.set(m.day, i);
      dayCount.set(m.day, (dayCount.get(m.day) || 0) + 1);
      const mk = m.day.slice(0, 7);
      monthCount.set(mk, (monthCount.get(mk) || 0) + 1);
      senders.set(m.sender, (senders.get(m.sender) || 0) + 1);
    });

    const first = files[0].parsed;
    const participants = Array.from(new Set(files.flatMap((f) => f.parsed.participants)));
    return {
      id: t.key,
      key: t.key,
      title: files.map((f) => f.parsed.title).find(Boolean) || "",
      category: t.category,
      format: first.format,
      participants,
      senders: Array.from(senders.keys()),
      senderCounts: senders,
      msgs: out,
      count: out.length,
      first: out.length ? out[0].ts : 0,
      last: out.length ? out[out.length - 1].ts : 0,
      dayFirst,
      dayCount,
      monthCount,
    };
  }

  function finishThreads(threads, owner) {
    for (const t of threads) {
      const others = t.participants.filter((p) => p !== owner);
      if (!t.title) t.title = others.join(", ") || t.participants.join(", ") || "Untitled chat";
      t.isGroup = t.participants.length > 2;
    }
    threads.sort((a, b) => b.last - a.last);
    return threads;
  }

  /**
   * Load an export.
   * @param {Array<{path:string, size?:number, text:()=>Promise<string>, blob:()=>Promise<Blob>}>} entries
   * @param {(done:number,total:number,label:string)=>void} onProgress
   */
  async function loadExport(entries, onProgress) {
    onProgress = onProgress || function () {};
    const msgFiles = entries.filter((e) => MSG_FILE.test(e.path.replace(/\\/g, "/")));
    if (!msgFiles.length) {
      const err = new Error(
        "No message files found. Pick the whole export folder (or its .zip), or the message_1.json / message_1.html files inside a chat folder."
      );
      err.code = "NO_MESSAGES";
      throw err;
    }

    // If a chat has both JSON and HTML files (two exports opened together), use JSON.
    const groups = new Map();
    const errors = [];
    let done = 0;
    for (const e of msgFiles) {
      const parts = splitPath(e.path);
      const fname = parts[parts.length - 1];
      const mm = fname.match(MSG_FILE);
      const folder = parts.length > 1 ? parts[parts.length - 2] : "";
      const catDir = parts.length > 2 ? parts[parts.length - 3].toLowerCase() : "";
      const category = CATEGORIES[catDir] || "inbox";
      const format = /json$/i.test(mm[3]) ? "json" : "html";
      onProgress(done, msgFiles.length, folder || fname);
      let parsed;
      try {
        const text = await e.text();
        parsed = format === "json" ? parseJsonFile(text, e.path) : parseHtmlFile(text, e.path);
      } catch (err) {
        errors.push(err.message || String(err));
        done++;
        continue;
      }
      // Loose files with no folder: group by title instead.
      const key = (folder ? category + "/" + folder : "file/" + (parsed.title || fname)).toLowerCase();
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, category, json: [], html: [] }));
      g[format].push({ n: +mm[2], parsed, path: e.path });
      done++;
      if (done % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    onProgress(done, msgFiles.length, "Sorting messages");

    const threads = [];
    for (const g of groups.values()) {
      const files = g.json.length ? g.json : g.html;
      const t = buildThread({ key: g.key, category: g.category, files });
      if (t.count) threads.push(t);
    }

    let owner = "";
    const profile = entries.find((e) => /personal_information\.json$/i.test(e.path));
    if (profile) {
      try {
        owner = findProfileName(await profile.text());
      } catch (e) {}
      // The profile name must actually appear in the chats to be useful.
      if (owner && !threads.some((t) => t.participants.includes(owner) || t.senderCounts.has(owner))) owner = "";
    }
    if (!owner) owner = guessOwner(threads);
    if (!owner) {
      // In a one-to-one chat the title is the other person's name, so the remaining participant is you.
      const votes = new Map();
      for (const t of threads) {
        const names = Array.from(new Set(t.participants.concat(t.senders)));
        if (names.length === 2 && t.title && names.includes(t.title)) {
          const me = names.find((n) => n !== t.title);
          votes.set(me, (votes.get(me) || 0) + 1);
        }
      }
      const ranked = Array.from(votes).sort((x, y) => y[1] - x[1]);
      if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) owner = ranked[0][0];
    }

    finishThreads(threads, owner);
    return {
      threads,
      owner,
      errors,
      media: new MediaIndex(entries),
      formats: Array.from(new Set(threads.map((t) => t.format))),
    };
  }

  DMR.parser = {
    fixText,
    parseDate,
    parseJsonFile,
    parseHtmlFile,
    loadExport,
    buildThread,
    finishThreads,
    guessOwner,
    MediaIndex,
    dayKey,
    monthKey,
    normUri,
  };
})();
