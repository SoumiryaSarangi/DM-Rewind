/*
 * DM Rewind — app
 * UI for browsing a parsed export: chat list, windowed timeline, month rail,
 * go-to-date calendar, and search by words, date range, sender and type.
 */
(function () {
  "use strict";
  const DMR = window.DMR;
  const P = DMR.parser;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) {
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {}
    },
  };
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nf = new Intl.NumberFormat();
  const num = (n) => nf.format(n);
  const plural = (n, one, many) => num(n) + " " + (n === 1 ? one : many);

  const fmtDayLong = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fmtDay = (ts) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const fmtMonth = (y, m) => new Date(y, m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  // Camera date-back style ('19 6 14). Decorative: the long date next to it is the readable text.
  const fmtImprint = (ts) => {
    const d = new Date(ts);
    return "'" + String(d.getFullYear() % 100).padStart(2, "0") + " " + (d.getMonth() + 1) + " " + d.getDate();
  };
  const keyToTs = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d || 1).getTime();
  };
  const fmtKey = (key) => fmtDay(keyToTs(key));
  function fmtListDate(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtTime(ts);
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  function fmtDuration(s) {
    if (!s) return "missed";
    if (s < 60) return s + " sec";
    const m = Math.round(s / 60);
    if (m < 60) return m + " min";
    return Math.floor(m / 60) + " h " + (m % 60) + " min";
  }
  function hue(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function initials(name) {
    const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      // Emoji- or symbol-only names: use the first character the viewer would see.
      const first = typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter().segment(name.trim())][0] : null;
      return first ? first.segment : "#";
    }
    const lead = (w) => String.fromCodePoint(w.codePointAt(0));
    return (lead(parts[0]) + (parts.length > 1 ? lead(parts[parts.length - 1]) : "")).toUpperCase();
  }
  /** First index with msgs[i].ts >= ts. */
  function lowerBound(msgs, ts) {
    let lo = 0, hi = msgs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (msgs[mid].ts < ts) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  let toastTimer = 0;
  function toast(text, ms) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), ms || 4200);
  }

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  const state = {
    threads: [],
    owner: "",
    me: "",
    media: null,
    t: null, // current thread
    start: 0,
    end: 0,
    hlRe: null,
    urls: new Map(),
    calView: null,
    sortBy: "recent",
    filter: "",
    embeds: store.get("dmr.embeds") !== "off", // show a preview button on shared reels/posts (loads from instagram.com on click)
    playing: null, // { t, i }: the one shared reel or post that is open right now
  };

  const WIN_BEFORE = 120;
  const WIN_AFTER = 220;
  const CHUNK = 200;
  const MAX_WIN = 700;

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */

  function showLoading(on, text) {
    $("loading").hidden = !on;
    if (text) $("loadingText").textContent = text;
    if (on) {
      $("loadingBar").style.width = "0%";
      $("loadingSub").textContent = "";
    }
  }

  async function openFrom(getEntries) {
    showLoading(true, "Reading your export…");
    try {
      const entries = await getEntries();
      if (!entries || !entries.length) {
        showLoading(false);
        return;
      }
      const res = await P.loadExport(entries, (done, total, label) => {
        $("loadingText").textContent = "Reading chats (" + num(done) + " of " + num(total) + " files)";
        $("loadingBar").style.width = Math.round((done / total) * 100) + "%";
        $("loadingSub").textContent = label;
      });
      showLoading(false);
      setData(res);
    } catch (err) {
      showLoading(false);
      console.error(err);
      toast(err.message || String(err), 9000);
    }
  }

  function setData(res) {
    for (const u of state.urls.values()) URL.revokeObjectURL(u);
    state.urls.clear();
    state.threads = res.threads;
    state.owner = res.owner;
    state.media = res.media;
    const saved = store.get("dmr.me");
    const known = (n) => res.threads.some((t) => t.senderCounts.has(n) || t.participants.includes(n));
    state.me = saved && known(saved) ? saved : res.owner;

    $("landing").hidden = true;
    $("app").hidden = false;
    applyScreenTheme("app");
    const msgs = res.threads.reduce((a, t) => a + t.count, 0);
    $("loadSummary").textContent =
      plural(res.threads.length, "chat", "chats") + ", " + plural(msgs, "message", "messages") +
      " (" + res.formats.map((f) => f.toUpperCase()).join(" + ") + ")";
    renderChatList();
    if (res.errors.length) {
      console.warn("Skipped files:", res.errors);
      toast("Skipped " + plural(res.errors.length, "file", "files") + " that couldn't be read. Details are in the browser console.", 7000);
    } else if (!state.me) {
      toast("Couldn't tell which name is yours. Pick it from the ⋯ menu in a chat.", 7000);
    }
    if (window.innerWidth > 860 && res.threads.length) openThread(res.threads[0]);
  }

  function resetToLanding() {
    closeAll();
    state.threads = [];
    state.t = null;
    state.playing = null;
    $("timeline").innerHTML = "";
    $("app").hidden = true;
    $("app").classList.remove("in-chat");
    $("landing").hidden = false;
    applyScreenTheme("landing");
  }

  /* ------------------------------------------------------------------ */
  /* Chat list                                                           */
  /* ------------------------------------------------------------------ */

  const CAT_LABEL = { requests: "Request", archived: "Archived", filtered: "Hidden" };

  function sortedThreads() {
    const f = state.filter.toLowerCase();
    let list = state.threads.filter((t) => !f || t.title.toLowerCase().includes(f) || t.participants.some((p) => p.toLowerCase().includes(f)));
    if (state.sortBy === "count") list = list.slice().sort((a, b) => b.count - a.count);
    else if (state.sortBy === "name") list = list.slice().sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }

  function renderChatList() {
    const list = sortedThreads();
    const ul = $("chatList");
    if (!list.length) {
      ul.innerHTML = '<li class="edge">No chats match "' + esc(state.filter) + '".</li>';
      return;
    }
    ul.innerHTML = list
      .map((t) => {
        const h = hue(t.title);
        const sel = state.t === t;
        const tag = CAT_LABEL[t.category] ? '<span class="tag">' + CAT_LABEL[t.category] + "</span>" : "";
        return (
          '<li class="chat-item" role="option" tabindex="0" aria-selected="' + sel + '" data-key="' + esc(t.key) + '">' +
          '<span class="avatar" style="background:hsl(' + h + ' 42% 46%)" aria-hidden="true">' + esc(initials(t.title)) + "</span>" +
          '<span><div class="name" title="' + esc(t.title) + '">' + esc(t.title) + "</div>" +
          '<div class="sub">' + tag + plural(t.count, "message", "messages") + " since " + new Date(t.first).getFullYear() + "</div></span>" +
          '<span class="when">' + esc(fmtListDate(t.last)) + "</span></li>"
        );
      })
      .join("");
  }

  function threadByKey(key) {
    return state.threads.find((t) => t.key === key);
  }

  /* ------------------------------------------------------------------ */
  /* Opening a chat                                                      */
  /* ------------------------------------------------------------------ */

  function dayLevels(t) {
    // Quartile thresholds for the calendar heat levels.
    const counts = Array.from(t.dayCount.values()).sort((a, b) => a - b);
    const q = (p) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] || 1;
    return [q(0.25), q(0.5), q(0.8)];
  }

  function openThread(t, opts) {
    opts = opts || {};
    if (state.t !== t) {
      state.t = t;
      if (!t.levels) t.levels = dayLevels(t);
      if (!opts.keepHighlight) state.hlRe = null;
      $("chatTitle").textContent = t.title;
      $("chatTitle").title = t.title;
      const people = t.isGroup ? ", " + t.participants.length + " people" : "";
      $("chatMeta").textContent = plural(t.count, "message", "messages") + " from " + fmtDay(t.first) + " to " + fmtDay(t.last) + people;
      $("emptyChat").hidden = true;
      $("datePill").hidden = false;
      document.title = t.title + " — DM Rewind";
      buildRail(t);
      renderMeMenu();
      for (const li of $("chatList").children) li.setAttribute("aria-selected", li.dataset.key === t.key);
      updateSenderOptions();
    }
    $("app").classList.add("in-chat");
    if (opts.index !== undefined) jumpToIndex(opts.index);
    else jumpToIndex(t.count - 1, { flash: false, bottom: true });
  }

  /* ------------------------------------------------------------------ */
  /* Message rendering                                                   */
  /* ------------------------------------------------------------------ */

  const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;
  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;

  function hl(s) {
    if (!state.hlRe || !s) return esc(s);
    let out = "", last = 0;
    s.replace(state.hlRe, (m, ...rest) => {
      const idx = rest[rest.length - 2];
      out += esc(s.slice(last, idx)) + "<mark>" + esc(m) + "</mark>";
      last = idx + m.length;
      return m;
    });
    return out + esc(s.slice(last));
  }

  function richText(raw) {
    let out = "", last = 0;
    raw.replace(URL_RE, (u, idx) => {
      out += hl(raw.slice(last, idx));
      out += '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + hl(u) + "</a>";
      last = idx + u.length;
      return u;
    });
    return out + hl(raw.slice(last));
  }

  const MEDIA_LABEL = { photo: "Photo", gif: "GIF", sticker: "Sticker", video: "Video", audio: "Voice message", file: "File" };

  function mediaHTML(m) {
    let out = "";
    for (const md of m.media) {
      const entry = state.media ? state.media.resolve(md.uri, m.src) : null;
      const label = MEDIA_LABEL[md.type] || "Attachment";
      if (!entry) {
        out += '<span class="media missing">' + label + " (not in this export)</span>";
        continue;
      }
      const path = esc(entry.path);
      if (md.type === "video") out += '<video class="vid lazy" controls preload="none" data-path="' + path + '"></video>';
      else if (md.type === "audio") out += '<audio class="lazy" controls preload="none" data-path="' + path + '"></audio>';
      else if (md.type === "file") out += '<a class="media missing lazy-link" data-path="' + path + '" href="#">' + esc(entry.path.split("/").pop()) + "</a>";
      else out += '<button type="button" class="media lazy ' + md.type + '" data-path="' + path + '" aria-label="Open ' + label.toLowerCase() + '">' + label + "</button>";
    }
    return out ? '<div class="media-row">' + out + "</div>" : "";
  }

  /* ---------- Shared reels and posts ---------- */

  // The export only keeps the link, caption and account name of a shared reel or post.
  // To preview one, Instagram's own embed page is loaded in an iframe, only after you click Show preview.
  // That page is a still image with a "Watch on Instagram" link, so the video itself is watched on Instagram.
  const EMBED_RE = /instagram\.com\/(?:[^\/?#]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)/i;

  function embedInfo(link) {
    const m = EMBED_RE.exec(link || "");
    if (!m || m[2].toLowerCase() === "audio") return null;
    const k = m[1].toLowerCase();
    return { kind: k === "p" ? "p" : k === "tv" ? "tv" : "reel", code: m[2] };
  }

  const EMBED_HEADER = 54;
  const EMBED_FOOTER = 130;
  const PLAY_ICON ='<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';

  function shareHTML(m, t) {
    const sh = m.share;
    const link = sh.link ? esc(sh.link) : "";
    const owner = sh.owner ? '<div class="owner">@' + hl(sh.owner) + "</div>" : "";
    const stext = sh.text ? '<div class="stext">' + hl(sh.text) + "</div>" : "";
    const url = sh.link ? '<span class="url">' + esc(sh.link.replace(/^https?:\/\/(www\.)?/, "")) + "</span>" : "";
    const info = state.embeds ? embedInfo(sh.link) : null;

    if (!info) {
      return sh.link
        ? '<a class="share" href="' + link + '" target="_blank" rel="noopener noreferrer">' + owner + stext + url + "</a>"
        : '<div class="share">' + owner + stext + url + "</div>";
    }

    const what = info.kind === "p" ? "post" : "reel";
    const open = '<a class="embed-open" href="' + link + '" target="_blank" rel="noopener noreferrer">Watch on Instagram</a>';
    if (state.playing && state.playing.t === t && state.playing.i === m.i) {
      // Instagram's embed is a still preview with a "Watch on Instagram" link, wrapped in a header and a footer.
      // The crop hides both so only the preview shows; "Show full embed" brings them back.
      const full = !!state.playing.full;
      const src = "https://www.instagram.com/" + (info.kind === "p" ? "p" : info.kind) + "/" + esc(info.code) + "/embed/";
      return (
        '<div class="share has-embed playing ' + info.kind + (full ? " full" : "") + '">' +
        '<div class="embed-head">' + (sh.owner ? '<span class="owner">@' + esc(sh.owner) + "</span>" : "<span></span>") +
        '<button type="button" class="embed-close">Close</button></div>' +
        '<div class="embed-crop"><iframe class="embed-frame" src="' + src + '" title="Instagram ' + what + (sh.owner ? " by @" + esc(sh.owner) : "") + '"' +
        ' loading="lazy" referrerpolicy="strict-origin-when-cross-origin"' +
        ' sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div>' +
        '<div class="embed-bar">' + open + '<button type="button" class="embed-full">' + (full ? "Crop to preview" : "Show full embed") + "</button></div>" +
        '<span class="embed-note">Blank or unavailable? The ' + what + " may be private or removed.</span></div>"
      );
    }
    return (
      '<div class="share has-embed ' + info.kind + '">' + owner + stext + url +
      '<div class="embed-bar"><button type="button" class="embed-play">' + PLAY_ICON + "Show " + what + " preview</button>" + open + "</div>" +
      '<span class="embed-note">Showing the preview loads it from instagram.com. Watching happens on Instagram.</span></div>'
    );
  }

  /** Re-draw one message's share card in place (used when you press Show preview or Close). */
  function refreshShare(i) {
    const t = state.t;
    const msgEl = tl().querySelector('.msg[data-i="' + i + '"]');
    const card = msgEl && msgEl.querySelector(".share");
    if (!card || !t || !t.msgs[i] || !t.msgs[i].share) return null;
    card.outerHTML = shareHTML(t.msgs[i], t);
    return msgEl.querySelector(".share");
  }

  function playShare(msgEl) {
    const i = +msgEl.dataset.i;
    const prev = state.playing;
    state.playing = { t: state.t, i };
    if (prev && prev.t === state.t && prev.i !== i) refreshShare(prev.i); // only one open at a time
    const card = refreshShare(i);
    if (card) {
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
      const close = card.querySelector(".embed-close");
      if (close) close.focus({ preventScroll: true });
    }
  }

  function stopShare(msgEl) {
    const i = +msgEl.dataset.i;
    if (state.playing && state.playing.i === i) state.playing = null;
    const card = refreshShare(i);
    const play = card && card.querySelector(".embed-play");
    if (play) play.focus({ preventScroll: true });
  }

  function setEmbeds(on) {
    state.embeds = on;
    store.set("dmr.embeds", on ? null : "off");
    if (!on) state.playing = null;
    const item = $("embedsToggle");
    if (item) item.setAttribute("aria-checked", String(on));
    if (state.t) rerenderAnchored(state.start, state.end);
  }

  function msgHTML(m, prev, t) {
    const mine = !!state.me && m.sender === state.me;
    const cont = prev && prev.sender === m.sender && prev.day === m.day && m.ts - prev.ts < 5 * 60e3;
    let h = '<div class="msg' + (mine ? " me" : "") + (cont ? " cont" : "") + '" data-i="' + m.i + '">';
    if (!cont && (t.isGroup || !state.me) && !mine) h += '<div class="who">' + esc(m.sender) + "</div>";

    let text = m.text || "";
    if (m.share && /sent an attachment\.?$/i.test(text)) text = "";
    let bubble = "";
    let cls = "bubble";
    if (m.unsent) {
      bubble = "Message unsent";
      cls += " system";
    } else if (m.call !== null) {
      bubble = (/video/i.test(text) ? "Video call" : "Call") + ", " + fmtDuration(m.call);
      cls += " system";
    } else {
      if (text) bubble += richText(text);
      if (m.share) bubble += shareHTML(m, t);
      if (text && !m.share && !m.media.length && text.length <= 12 && EMOJI_ONLY.test(text)) cls += " emoji-only";
    }
    const media = m.unsent ? "" : mediaHTML(m);
    h += media;
    if (bubble) h += '<div class="' + cls + '">' + bubble + "</div>";
    else if (!media) h += '<div class="bubble system">Empty message</div>';

    let meta = '<time datetime="' + new Date(m.ts).toISOString() + '">' + esc(fmtTime(m.ts)) + "</time>";
    if (m.reactions && m.reactions.length) {
      const who = m.reactions.map((r) => r.r + " " + r.actor).join(", ");
      meta += '<span class="reacts" title="' + esc(who) + '">' + esc(m.reactions.map((r) => r.r).join("")) + "</span>";
    }
    h += '<div class="meta">' + meta + "</div></div>";
    return h;
  }

  function buildHTML() {
    const t = state.t;
    const parts = [];
    if (state.start === 0) parts.push('<p class="edge">Start of your messages with ' + esc(t.title) + "</p>");
    let prev = state.start > 0 ? t.msgs[state.start - 1] : null;
    for (let i = state.start; i < state.end; i++) {
      const m = t.msgs[i];
      if (!prev || prev.day !== m.day) {
        parts.push('<div class="day" data-day="' + m.day + '"><span><b class="imprint" aria-hidden="true">' + fmtImprint(m.ts) + "</b>" + esc(fmtDayLong(m.ts)) + "</span></div>");
        prev = null;
      }
      parts.push(msgHTML(m, prev, t));
      prev = m;
    }
    if (state.end === t.count) parts.push('<p class="edge">Latest message in this export</p>');
    return parts.join("");
  }

  /* ------------------------------------------------------------------ */
  /* Media                                                               */
  /* ------------------------------------------------------------------ */

  let io = null;
  function entryByPath(path) {
    if (!state.media) return null;
    const base = path.split("/").pop().toLowerCase();
    return (state.media.byName.get(base) || []).find((e) => e.path === path) || null;
  }
  async function urlFor(path) {
    if (state.urls.has(path)) return state.urls.get(path);
    const entry = entryByPath(path);
    if (!entry) return null;
    const blob = await entry.blob();
    const u = URL.createObjectURL(blob);
    state.urls.set(path, u);
    return u;
  }
  async function loadMedia(el) {
    const path = el.dataset.path;
    try {
      const u = await urlFor(path);
      if (!u) throw new Error("missing");
      if (el.tagName === "VIDEO" || el.tagName === "AUDIO") el.src = u;
      else if (el.tagName === "A") {
        el.href = u;
        el.download = path.split("/").pop();
      } else {
        const img = new Image();
        img.alt = el.getAttribute("aria-label") || "";
        img.decoding = "async";
        img.src = u;
        el.textContent = "";
        el.appendChild(img);
      }
    } catch (e) {
      el.classList.add("missing");
      el.textContent = "Couldn't open this file";
    }
  }
  function observeMedia() {
    if (!io) {
      io = new IntersectionObserver(
        (items) => {
          for (const it of items) {
            if (it.isIntersecting) {
              io.unobserve(it.target);
              loadMedia(it.target);
            }
          }
        },
        { root: $("timeline"), rootMargin: "800px 0px" }
      );
    }
    io.disconnect();
    for (const el of $("timeline").querySelectorAll(".lazy, .lazy-link")) {
      if (el.dataset.path && state.urls.has(el.dataset.path)) loadMedia(el);
      else io.observe(el);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Windowed timeline                                                   */
  /* ------------------------------------------------------------------ */

  const tl = () => $("timeline");

  function msgEls() {
    return tl().querySelectorAll(".msg");
  }

  /** The first message whose bottom edge is below the top of the viewport. */
  function topVisible(probe) {
    const el = tl();
    const els = msgEls();
    if (!els.length) return null;
    const top = el.scrollTop + (probe || 0);
    let lo = 0, hi = els.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const e = els[mid];
      if (e.offsetTop + e.offsetHeight <= top) lo = mid + 1;
      else hi = mid;
    }
    const e = els[lo];
    return { el: e, i: +e.dataset.i, off: e.offsetTop - el.scrollTop };
  }

  function renderRange(s, e) {
    state.start = s;
    state.end = e;
    tl().innerHTML = buildHTML();
    observeMedia();
  }

  function jumpToIndex(i, opts) {
    opts = opts || {};
    const t = state.t;
    if (!t || !t.count) return;
    i = Math.max(0, Math.min(t.count - 1, i));
    renderRange(Math.max(0, i - WIN_BEFORE), Math.min(t.count, i + WIN_AFTER));
    const el = tl().querySelector('.msg[data-i="' + i + '"]');
    if (opts.bottom) {
      tl().scrollTop = tl().scrollHeight;
    } else if (el) {
      const prevEl = el.previousElementSibling;
      const target = prevEl && prevEl.classList.contains("day") ? prevEl : el;
      tl().scrollTop = Math.max(0, target.offsetTop - 48);
    }
    if (el && opts.flash !== false) {
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 2300);
    }
    updatePosition();
  }

  function rerenderAnchored(s, e) {
    const a = topVisible();
    renderRange(s, e);
    if (!a) return;
    const el = tl().querySelector('.msg[data-i="' + a.i + '"]');
    if (el) tl().scrollTop = el.offsetTop - a.off;
  }

  let scrollRaf = 0;
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const t = state.t;
      if (!t) return;
      const el = tl();
      if (el.scrollTop < 900 && state.start > 0) {
        const s = Math.max(0, state.start - CHUNK);
        rerenderAnchored(s, Math.min(state.end, s + MAX_WIN));
      } else if (el.scrollHeight - el.scrollTop - el.clientHeight < 900 && state.end < t.count) {
        const e = Math.min(t.count, state.end + CHUNK);
        rerenderAnchored(Math.max(state.start, e - MAX_WIN), e);
      }
      updatePosition();
    });
  }

  function currentMsg() {
    // Probe just below the floating date pill so the pill names the day you're reading.
    const a = topVisible(60);
    return a ? state.t.msgs[a.i] : null;
  }

  function updatePosition() {
    const m = currentMsg();
    if (!m) return;
    $("datePill").textContent =
      window.innerWidth <= 860
        ? new Date(m.ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
        : fmtDayLong(m.ts);
    const sep = tl().querySelector('.day[data-day="' + m.day + '"]');
    const gap = sep ? sep.offsetTop - tl().scrollTop : -1;
    $("datePill").classList.toggle("dim", gap >= 0 && gap < 90);
    const here = $("rail").querySelector(".here");
    const slot = $("rail").querySelector('.slot[data-k="' + m.day.slice(0, 7) + '"]');
    // While you drag the rail, the marker follows your pointer; it settles onto the month on release.
    if (here && slot && !$("rail").classList.contains("dragging")) settleMarker(here, slot.offsetTop + slot.offsetHeight / 2);
  }

  /* ------------------------------------------------------------------ */
  /* Jumping                                                             */
  /* ------------------------------------------------------------------ */

  function jumpToDate(key, silent) {
    const t = state.t;
    if (!t) return;
    const ts = keyToTs(key);
    let i = lowerBound(t.msgs, ts);
    if (i >= t.count) {
      jumpToIndex(t.count - 1);
      if (!silent) toast("No messages on or after " + fmtKey(key) + ". This is the latest one, from " + fmtDay(t.last) + ".");
      return;
    }
    const next = t.msgs[i];
    if (next.day !== key) {
      const prev = i > 0 ? t.msgs[i - 1] : null;
      let chosen = next;
      if (prev && ts - keyToTs(prev.day) < next.ts - ts) chosen = prev;
      i = t.dayFirst.get(chosen.day);
      if (!silent) toast("No messages on " + fmtKey(key) + ". Showing " + fmtKey(chosen.day) + ", the closest day with messages.");
    }
    jumpToIndex(i);
  }

  function jumpToMonth(y, m) {
    const t = state.t;
    const ts = new Date(y, m, 1).getTime();
    const i = lowerBound(t.msgs, ts);
    const mk = y + "-" + String(m + 1).padStart(2, "0");
    if (i < t.count && t.msgs[i].day.slice(0, 7) !== mk) {
      toast("No messages in " + fmtMonth(y, m) + ". Showing " + fmtDay(t.msgs[i].ts) + ".");
    }
    jumpToIndex(i);
  }

  /* ------------------------------------------------------------------ */
  /* Month rail                                                          */
  /* ------------------------------------------------------------------ */

  function monthsOf(t) {
    const a = new Date(t.first), b = new Date(t.last);
    const out = [];
    let y = a.getFullYear(), m = a.getMonth();
    while (y < b.getFullYear() || (y === b.getFullYear() && m <= b.getMonth())) {
      const k = y + "-" + String(m + 1).padStart(2, "0");
      out.push({ y, m, k, c: t.monthCount.get(k) || 0 });
      if (++m > 11) (m = 0), y++;
    }
    return out;
  }

  function buildRail(t) {
    const months = monthsOf(t);
    t.months = months;
    const max = Math.max(1, ...months.map((x) => x.c));
    const html = months
      .map((x, idx) => {
        const showYear = x.m === 0 || (idx === 0 && (months.length < 4 || months.slice(1, 4).every((n) => n.m !== 0)));
        const w = x.c ? Math.max(0.06, Math.sqrt(x.c / max)) : 0;
        return (
          '<div class="slot' + (x.c ? "" : " empty") + '" data-k="' + x.k + '" data-idx="' + idx + '">' +
          (showYear ? '<span class="yr">' + x.y + "</span>" : "") +
          '<span class="bar" style="width:calc((100% - 36px) * ' + w.toFixed(3) + ')"></span></div>'
        );
      })
      .join("");
    $("rail").innerHTML = html + '<div class="here"></div>';
  }

  /* The rail marker is a critically damped spring (no overshoot): it follows the pointer 1:1 while
     you drag, and on release it carries your velocity into the settle. Only transform changes. */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const MARKER_RESPONSE = 0.32; // seconds
  function markerOf(here) {
    return here._m || (here._m = { y: 0, v: 0, target: 0, raf: 0, t: 0, placed: false });
  }
  function drawMarker(here, m) {
    here.style.transform = "translateY(" + m.y.toFixed(2) + "px)";
  }
  function trackMarker(here, y) {
    const m = markerOf(here);
    cancelAnimationFrame(m.raf);
    m.raf = 0;
    const now = performance.now();
    const dt = (now - m.t) / 1000;
    if (m.placed && dt > 0 && dt < 0.1) m.v = Math.max(-4000, Math.min(4000, 0.6 * m.v + 0.4 * ((y - m.y) / dt)));
    m.y = y;
    m.t = now;
    m.placed = true;
    drawMarker(here, m);
  }
  function settleMarker(here, target) {
    const m = markerOf(here);
    m.target = target;
    if (!m.placed || reduceMotion.matches) {
      cancelAnimationFrame(m.raf);
      m.raf = 0;
      m.y = target;
      m.v = 0;
      m.placed = true;
      drawMarker(here, m);
      return;
    }
    if (m.raf) return; // already settling: the running loop picks up the new target and keeps its velocity
    const now = performance.now();
    if (now - m.t > 80) m.v = 0; // the finger paused before letting go
    m.t = now;
    // Keep the release velocity only if it heads toward the month, and no more than the spring can absorb
    // without overshooting (v <= omega * distance); otherwise the marker would swing the wrong way first.
    const omega = (2 * Math.PI) / MARKER_RESPONSE;
    const dist = target - m.y;
    m.v = m.v * dist > 0 ? Math.sign(dist) * Math.min(Math.abs(m.v), omega * Math.abs(dist)) : 0;
    const k = omega * omega;
    const c = 2 * Math.sqrt(k);
    const step = (ts) => {
      const dt = Math.min(0.032, (ts - m.t) / 1000);
      m.t = ts;
      const n = Math.max(1, Math.ceil(dt / 0.004));
      for (let i = 0; i < n; i++) {
        m.v += (-k * (m.y - m.target) - c * m.v) * (dt / n);
        m.y += m.v * (dt / n);
      }
      if (Math.abs(m.y - m.target) < 0.1 && Math.abs(m.v) < 2) {
        m.y = m.target;
        m.v = 0;
        m.raf = 0;
        drawMarker(here, m);
        return;
      }
      drawMarker(here, m);
      m.raf = requestAnimationFrame(step);
    };
    m.raf = requestAnimationFrame(step);
  }

  function railSlotAt(clientY) {
    const rail = $("rail");
    const slots = rail.querySelectorAll(".slot");
    if (!slots.length) return null;
    const first = slots[0].getBoundingClientRect();
    const last = slots[slots.length - 1].getBoundingClientRect();
    const y = Math.max(first.top, Math.min(last.bottom - 0.5, clientY));
    const idx = Math.min(slots.length - 1, Math.floor(((y - first.top) / (last.bottom - first.top)) * slots.length));
    return { el: slots[idx], m: state.t.months[idx] };
  }

  function showRailTip(hit, clientY) {
    const tip = $("railTip");
    const wrap = $("rail").parentElement.getBoundingClientRect();
    tip.textContent = fmtMonth(hit.m.y, hit.m.m) + ": " + (hit.m.c ? plural(hit.m.c, "message", "messages") : "no messages");
    tip.style.top = clientY - wrap.top + "px";
    tip.hidden = false;
    for (const s of $("rail").querySelectorAll(".slot.hover")) s.classList.remove("hover");
    hit.el.classList.add("hover");
  }
  function hideRailTip() {
    $("railTip").hidden = true;
    for (const s of $("rail").querySelectorAll(".slot.hover")) s.classList.remove("hover");
  }

  function wireRail() {
    const rail = $("rail");
    let dragging = false;
    let lastHit = null;
    let jumped = null; // month key we last jumped to during this press
    let pending = null;
    let raf = 0;
    const markerY = (clientY) => {
      const slots = rail.querySelectorAll(".slot");
      if (!slots.length) return 0;
      const last = slots[slots.length - 1];
      return Math.max(slots[0].offsetTop, Math.min(last.offsetTop + last.offsetHeight, clientY - rail.getBoundingClientRect().top));
    };
    const jumpNow = (hit) => {
      pending = null;
      if (hit && hit.m.k !== jumped) {
        jumped = hit.m.k;
        jumpToMonth(hit.m.y, hit.m.m);
      }
    };
    // A fast drag crosses many months per frame; render the newest one once per frame.
    const queue = (hit) => {
      pending = hit;
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), pending && jumpNow(pending)));
    };
    const finish = (hit) => {
      dragging = false;
      cancelAnimationFrame(raf);
      raf = 0;
      rail.classList.remove("dragging");
      if (hit) jumpNow(hit);
      jumped = null;
      pending = null;
      updatePosition(); // settles the marker onto the month, carrying the release velocity
    };
    rail.addEventListener("pointerdown", (e) => {
      if (!state.t) return;
      dragging = true;
      jumped = null;
      rail.classList.add("dragging");
      rail.setPointerCapture(e.pointerId);
      lastHit = railSlotAt(e.clientY);
      const here = rail.querySelector(".here");
      if (here) trackMarker(here, markerY(e.clientY));
      if (lastHit) {
        showRailTip(lastHit, e.clientY);
        jumpNow(lastHit); // respond on press, not on release
      }
    });
    rail.addEventListener("pointermove", (e) => {
      if (!state.t) return;
      const hit = railSlotAt(e.clientY);
      if (!hit) return;
      showRailTip(hit, e.clientY);
      if (!dragging) return;
      const here = rail.querySelector(".here");
      if (here) trackMarker(here, markerY(e.clientY));
      lastHit = hit;
      if (hit.m.k !== jumped) queue(hit);
    });
    rail.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      finish(railSlotAt(e.clientY) || lastHit);
      if (e.pointerType !== "mouse") hideRailTip();
    });
    rail.addEventListener("pointercancel", () => {
      if (dragging) finish(null);
      hideRailTip();
    });
    rail.addEventListener("pointerleave", () => {
      if (!dragging) hideRailTip();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Go-to-date calendar                                                 */
  /* ------------------------------------------------------------------ */

  function openCal(anchorEl) {
    const t = state.t;
    if (!t) return;
    closeMenu();
    const pop = $("calPop");
    const m = currentMsg() || t.msgs[t.count - 1];
    const d = new Date(m.ts);
    state.calView = { y: d.getFullYear(), m: d.getMonth() };

    const input = $("dateInput");
    input.min = P.dayKey(t.first);
    input.max = P.dayKey(t.last);
    input.value = m.day;

    const years = [];
    for (let y = new Date(t.first).getFullYear(); y <= new Date(t.last).getFullYear(); y++) years.push(y);
    $("calYear").innerHTML = years.map((y) => '<option value="' + y + '">' + y + "</option>").join("");
    $("calMonth").innerHTML = Array.from({ length: 12 }, (_, i) =>
      '<option value="' + i + '">' + new Date(2000, i, 1).toLocaleDateString(undefined, { month: "long" }) + "</option>"
    ).join("");
    renderCal();

    pop.hidden = false;
    const r = (anchorEl || $("jumpBtn")).getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w));
    pop.style.left = left + "px";
    pop.style.top = Math.min(r.bottom + 8, window.innerHeight - pop.offsetHeight - 12) + "px";
    pop.style.transformOrigin = Math.round(r.left + r.width / 2 - left) + "px " + Math.round(r.bottom - parseFloat(pop.style.top)) + "px";
    $("jumpBtn").setAttribute("aria-expanded", "true");
    setTimeout(() => $("calGrid").querySelector("button[data-day='" + m.day + "']")?.focus() || input.focus(), 0);
  }

  function closeCal() {
    $("calPop").hidden = true;
    $("jumpBtn").setAttribute("aria-expanded", "false");
  }

  function renderCal() {
    const t = state.t;
    const { y, m } = state.calView;
    $("calYear").value = y;
    $("calMonth").value = m;
    const first = new Date(y, m, 1);
    const days = new Date(y, m + 1, 0).getDate();
    const lead = first.getDay();
    const firstKey = P.dayKey(t.first), lastKey = P.dayKey(t.last);
    const todayKey = P.dayKey(Date.now());
    const [a, b, c] = t.levels;
    let html = "";
    for (let i = 0; i < 7; i++) {
      html += '<div class="dow" aria-hidden="true">' + new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }) + "</div>";
    }
    for (let i = 0; i < lead; i++) html += "<span></span>";
    for (let d = 1; d <= days; d++) {
      const key = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      const n = t.dayCount.get(key) || 0;
      const lvl = !n ? "" : n <= a ? "l1" : n <= b ? "l2" : n <= c ? "l3" : "l4";
      const out = key < firstKey || key > lastKey ? " out" : "";
      const today = key === todayKey ? " today" : "";
      const label = fmtKey(key) + ": " + (n ? plural(n, "message", "messages") : "no messages");
      html += '<button type="button" class="' + lvl + out + today + '" data-day="' + key + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + d + "</button>";
    }
    $("calGrid").innerHTML = html;
    const firstD = new Date(t.first), lastD = new Date(t.last);
    $("calPrev").disabled = y < firstD.getFullYear() || (y === firstD.getFullYear() && m <= firstD.getMonth());
    $("calNext").disabled = y > lastD.getFullYear() || (y === lastD.getFullYear() && m >= lastD.getMonth());
  }

  function shiftCal(delta) {
    let { y, m } = state.calView;
    m += delta;
    if (m < 0) (m = 11), y--;
    if (m > 11) (m = 0), y++;
    state.calView = { y, m };
    renderCal();
  }

  /* ------------------------------------------------------------------ */
  /* Search                                                              */
  /* ------------------------------------------------------------------ */

  function openSearch(focus) {
    closeCal();
    closeMenu();
    $("searchPanel").hidden = false;
    $("app").classList.add("with-panel");
    updateSenderOptions();
    updatePosition();
    if (focus !== false) setTimeout(() => $("q").focus(), 0);
  }
  function closeSearch() {
    $("searchPanel").hidden = true;
    $("app").classList.remove("with-panel");
    updatePosition();
  }

  function scope() {
    return document.querySelector('input[name="scope"]:checked').value;
  }

  function updateSenderOptions() {
    const sel = $("qSender");
    const cur = sel.value;
    const counts = new Map();
    const threads = scope() === "all" || !state.t ? state.threads : [state.t];
    for (const t of threads) for (const [n, c] of t.senderCounts) counts.set(n, (counts.get(n) || 0) + c);
    const names = Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a)).slice(0, 300);
    sel.innerHTML = '<option value="">Anyone</option>' + names.map((n) => '<option value="' + esc(n) + '">' + esc(n) + (n === state.me ? " (you)" : "") + "</option>").join("");
    if (names.includes(cur)) sel.value = cur;
  }

  function searchText(m) {
    if (m.lc === undefined) {
      let s = m.text || "";
      if (m.share) s += "\n" + (m.share.text || "") + "\n" + (m.share.owner || "") + "\n" + (m.share.link || "");
      m.lc = s.toLowerCase();
    }
    return m.lc;
  }

  function typeMatch(m, type) {
    switch (type) {
      case "text": return !!m.text && !m.media.length && !m.share && m.call === null && !m.unsent;
      case "photo": return m.media.some((x) => x.type === "photo" || x.type === "gif" || x.type === "sticker");
      case "video": return m.media.some((x) => x.type === "video");
      case "audio": return m.media.some((x) => x.type === "audio");
      case "link": return !!m.share || /https?:\/\//i.test(m.text);
      case "call": return m.call !== null;
      case "reaction": return !!(m.reactions && m.reactions.length);
      default: return true;
    }
  }

  function parseQuery(q) {
    const terms = [];
    q.replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => {
      const s = (phrase || word).toLowerCase().trim();
      if (s) terms.push(s);
    });
    return terms;
  }

  const MAX_RESULTS = 500;
  let searchTimer = 0;

  function runSearch() {
    const q = $("q").value.trim();
    const from = $("qFrom").value, to = $("qTo").value;
    const sender = $("qSender").value, type = $("qType").value;
    if (!q && !from && !to && !sender && !type) {
      $("searchStatus").textContent = "Type words, set a date range, or pick a type to see matching messages.";
      $("results").innerHTML = "";
      setHighlight([]);
      return;
    }
    if (from && to && from > to) {
      $("searchStatus").textContent = "The From date is after the To date. Swap them to search that range.";
      $("results").innerHTML = "";
      return;
    }
    const terms = parseQuery(q);
    const fromTs = from ? keyToTs(from) : -Infinity;
    const toTs = to ? keyToTs(to) + 86400e3 : Infinity;
    const all = scope() === "all";
    const threads = all ? state.threads : state.t ? [state.t] : [];
    const found = [];
    let total = 0;
    for (const t of threads) {
      const msgs = t.msgs;
      const s = from ? lowerBound(msgs, fromTs) : 0;
      const e = to ? lowerBound(msgs, toTs) : msgs.length;
      for (let i = e - 1; i >= s; i--) {
        const m = msgs[i];
        if (sender && m.sender !== sender) continue;
        if (type && !typeMatch(m, type)) continue;
        if (terms.length) {
          const lc = searchText(m);
          let ok = true;
          for (const term of terms) if (!lc.includes(term)) { ok = false; break; }
          if (!ok) continue;
        }
        total++;
        if (found.length < MAX_RESULTS * 4) found.push({ t, m });
      }
    }
    found.sort((a, b) => b.m.ts - a.m.ts);
    setHighlight(terms);
    const where = all ? "across all chats" : "in this chat";
    const status = total
      ? plural(total, "message", "messages") + " " + where + (total > MAX_RESULTS ? ". Showing the newest " + num(MAX_RESULTS) + "; narrow the dates to see older ones." : ".")
      : "No messages match " + where + ". Try fewer words or a wider date range.";
    renderResults(found.slice(0, MAX_RESULTS), status, all);
  }

  function setHighlight(terms) {
    const re = terms.length ? new RegExp(terms.map(escRe).join("|"), "gi") : null;
    const changed = String(re) !== String(state.hlRe);
    state.hlRe = re;
    if (changed && state.t) rerenderAnchored(state.start, state.end);
  }

  function snippet(m) {
    let s = (m.text || "").replace(/\s+/g, " ");
    if (m.share && (!s || /sent an attachment/i.test(s))) s = [m.share.owner && "@" + m.share.owner, m.share.text, m.share.link].filter(Boolean).join(" ");
    if (m.call !== null) s = "Call, " + fmtDuration(m.call);
    if (!s && m.media.length) s = m.media.map((x) => MEDIA_LABEL[x.type] || "Attachment").join(", ");
    if (m.unsent) s = "Message unsent";
    if (state.hlRe && s.length > 140) {
      state.hlRe.lastIndex = 0;
      const hit = state.hlRe.exec(s);
      state.hlRe.lastIndex = 0;
      if (hit && hit.index > 50) s = "…" + s.slice(hit.index - 40);
    }
    return s.slice(0, 220);
  }

  function renderResults(list, status, showThread) {
    $("searchStatus").textContent = status;
    let html = "";
    let year = null;
    list.forEach(({ t, m }, idx) => {
      const y = new Date(m.ts).getFullYear();
      if (y !== year) {
        year = y;
        html += '<li class="r-year" aria-hidden="true">' + y + "</li>";
      }
      const who = showThread ? t.title + (t.isGroup || m.sender !== t.title ? ": " + m.sender : "") : m.sender;
      html +=
        '<li><button type="button" data-r="' + idx + '"><div class="r-top"><span class="r-who">' + esc(who) +
        "</span><span>" + esc(fmtDay(m.ts) + ", " + fmtTime(m.ts)) + '</span></div><div class="r-text">' + hl(snippet(m)) + "</div></button></li>";
    });
    $("results").innerHTML = html;
    $("results").__list = list;
  }

  function openResult(idx) {
    const r = $("results").__list[idx];
    if (!r) return;
    if (state.t !== r.t) openThread(r.t, { index: r.m.i, keepHighlight: true });
    else jumpToIndex(r.m.i);
    if (window.innerWidth <= 860) closeSearch();
  }

  function onThisDay() {
    const t = state.t;
    if (!t) return;
    const now = new Date();
    const md = "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    const thisYear = String(now.getFullYear());
    const list = [];
    for (let i = t.count - 1; i >= 0; i--) {
      const m = t.msgs[i];
      if (m.day.endsWith(md) && !m.day.startsWith(thisYear)) list.push({ t, m });
    }
    openSearch(false);
    setHighlight([]);
    const label = now.toLocaleDateString(undefined, { day: "numeric", month: "long" });
    renderResults(
      list.slice(0, MAX_RESULTS),
      list.length ? plural(list.length, "message", "messages") + " from " + label + " in earlier years." : "No messages from " + label + " in earlier years in this chat.",
      false
    );
  }

  /* ------------------------------------------------------------------ */
  /* Menu, "me" choice, theme                                            */
  /* ------------------------------------------------------------------ */

  function renderMeMenu() {
    const t = state.t;
    if (!t) return;
    const names = Array.from(new Set(t.participants.concat(t.senders)));
    $("meChoices").innerHTML =
      names.map((n) => '<button role="menuitemradio" type="button" data-me="' + esc(n) + '" aria-checked="' + (n === state.me) + '">' + esc(n) + "</button>").join("") +
      '<button role="menuitemradio" type="button" data-me="" aria-checked="' + (!names.includes(state.me)) + '">None of these</button>';
  }

  function setMe(name) {
    state.me = name;
    store.set("dmr.me", name || null);
    renderMeMenu();
    if (state.t) rerenderAnchored(state.start, state.end);
    updateSenderOptions();
  }

  function toggleMenu(force) {
    const menu = $("moreMenu");
    const open = force !== undefined ? force : menu.hidden;
    menu.hidden = !open;
    $("moreBtn").setAttribute("aria-expanded", String(open));
    if (open) {
      closeCal();
      setTimeout(() => menu.querySelector("button")?.focus(), 0);
    }
  }
  const closeMenu = () => toggleMenu(false);

  function effectiveTheme() {
    const forced = document.documentElement.dataset.theme;
    if (forced) return forced;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  // Defaults: the landing page is light and the chat view is dark. Pressing the toggle saves your own choice,
  // which then wins on both screens.
  function savedTheme() {
    const t = store.get("dmr.theme");
    return t === "light" || t === "dark" ? t : null;
  }
  function applyScreenTheme(screen) {
    applyTheme(savedTheme() || (screen === "app" ? "dark" : "light"));
  }
  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  function closeAll() {
    closeCal();
    closeMenu();
    closeSearch();
    $("lightbox").hidden = true;
  }

  /* ------------------------------------------------------------------ */
  /* Landing decoration                                                  */
  /* ------------------------------------------------------------------ */

  function drawHeroRail() {
    const el = $("heroRail");
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let html = "";
    const now = new Date();
    for (let i = 0; i < 40; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - 39 + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const w = Math.round(12 + Math.pow(r(), 0.7) * 88 * (0.5 + 0.5 * Math.sin(i / 5)));
      html += '<div class="m' + (i === 23 ? " hot" : "") + '"><span class="y">' + (m === 0 ? y : "") + '</span><span class="b" style="width:' + Math.max(4, w) + '%"></span></div>';
      if (i === 23) $("heroImprint").textContent = fmtImprint(new Date(y, m, 14));
    }
    el.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function wire() {
    applyScreenTheme("landing");
    $("themeBtn").addEventListener("click", () => {
      const next = effectiveTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      store.set("dmr.theme", next);
    });

    // Landing: pickers
    $("pickFolder").addEventListener("click", () => $("inFolder").click());
    $("pickZip").addEventListener("click", () => $("inZip").click());
    $("pickFiles").addEventListener("click", () => $("inFiles").click());
    for (const id of ["inFolder", "inZip", "inFiles"]) {
      $(id).addEventListener("change", (e) => {
        const files = e.target.files;
        if (!files || !files.length) return;
        const list = Array.from(files);
        e.target.value = "";
        openFrom(() => (id === "inFolder" ? Promise.resolve(DMR.sources.fromFileList(list)) : DMR.sources.fromPicked(list)));
      });
    }
    $("loadDemo").addEventListener("click", () => openFrom(() => Promise.resolve(DMR.demo.buildDemoEntries())));
    $("openAnother").addEventListener("click", resetToLanding);

    // Drag and drop anywhere on the landing page
    const dz = $("dropzone");
    const landing = $("landing");
    landing.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("over");
    });
    landing.addEventListener("dragleave", (e) => {
      if (!landing.contains(e.relatedTarget)) dz.classList.remove("over");
    });
    landing.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("over");
      const dt = e.dataTransfer;
      // Entries must be read synchronously from the event.
      const pending = DMR.sources.fromDrop(dt);
      openFrom(() => pending);
    });

    // Chat list
    $("chatFilter").addEventListener("input", (e) => {
      state.filter = e.target.value.trim();
      renderChatList();
    });
    $("sortChats").addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      renderChatList();
    });
    const pick = (li) => {
      const t = li && threadByKey(li.dataset.key);
      if (t) openThread(t);
    };
    $("chatList").addEventListener("click", (e) => pick(e.target.closest(".chat-item")));
    $("chatList").addEventListener("keydown", (e) => {
      const li = e.target.closest(".chat-item");
      if (!li) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick(li);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling;
        if (next) next.focus();
      }
    });
    $("backBtn").addEventListener("click", () => $("app").classList.remove("in-chat"));
    $("globalSearchBtn").addEventListener("click", () => {
      document.querySelector('input[name="scope"][value="all"]').checked = true;
      openSearch();
    });

    // Timeline
    tl().addEventListener("scroll", onScroll, { passive: true });
    tl().addEventListener("click", (e) => {
      const play = e.target.closest(".embed-play");
      if (play) return playShare(play.closest(".msg"));
      const stop = e.target.closest(".embed-close");
      if (stop) return stopShare(stop.closest(".msg"));
      const full = e.target.closest(".embed-full");
      if (full) {
        const msgEl = full.closest(".msg");
        if (state.playing && state.playing.i === +msgEl.dataset.i) {
          state.playing.full = !state.playing.full;
          refreshShare(+msgEl.dataset.i);
        }
        return;
      }
      const btn = e.target.closest(".media");
      if (btn && !btn.classList.contains("missing")) {
        const img = btn.querySelector("img");
        if (img) {
          const lb = $("lightbox");
          lb.querySelector("img").src = img.src;
          lb.hidden = false;
          lb.querySelector("[data-close]").focus();
        }
      }
    });
    window.addEventListener("resize", () => updatePosition());
    // Instagram's embed page reports its own height. Fit the frame to it so it never needs an inner scrollbar.
    window.addEventListener("message", (e) => {
      if (e.origin !== "https://www.instagram.com" || typeof e.data !== "string") return;
      let d;
      try { d = JSON.parse(e.data); } catch (err) { return; }
      if (!d || d.type !== "MEASURE" || !d.details || !(d.details.height > 0)) return;
      for (const f of tl().querySelectorAll("iframe.embed-frame")) {
        if (f.contentWindow !== e.source) continue;
        const h = Math.ceil(d.details.height);
        f.style.height = h + "px";
        // Measured on Instagram's embed page: 54px header above the preview, 130px of likes/comment bar below it.
        f.parentNode.style.height = Math.max(120, h - EMBED_HEADER - EMBED_FOOTER) + "px";
        f.closest(".share").classList.add("loaded");
      }
    });
    wireRail();
    $("datePill").addEventListener("click", () => openCal($("datePill")));

    // Header actions
    $("jumpBtn").addEventListener("click", () => ($("calPop").hidden ? openCal() : closeCal()));
    $("searchBtn").addEventListener("click", () => {
      if (!$("searchPanel").hidden) return closeSearch();
      document.querySelector('input[name="scope"][value="chat"]').checked = true;
      openSearch();
    });
    $("moreBtn").addEventListener("click", () => toggleMenu());
    $("moreMenu").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !state.t) return;
      if (b.dataset.me !== undefined) return setMe(b.dataset.me);
      const act = b.dataset.act;
      if (act === "embeds") return setEmbeds(b.getAttribute("aria-checked") !== "true"); // stays open so the tick is visible
      closeMenu();
      if (act === "first") jumpToIndex(0);
      else if (act === "latest") jumpToIndex(state.t.count - 1, { bottom: true });
      else if (act === "onthisday") onThisDay();
      else if (act === "random") {
        const keys = Array.from(state.t.dayFirst.keys());
        const k = keys[Math.floor(Math.random() * keys.length)];
        jumpToDate(k, true);
        toast(fmtDayLong(keyToTs(k)));
      }
    });

    // Calendar
    $("dateForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("dateInput").value;
      if (!v) return;
      closeCal();
      jumpToDate(v);
    });
    $("dateInput").addEventListener("change", (e) => {
      const v = e.target.value;
      if (!v) return;
      const [y, m] = v.split("-").map(Number);
      state.calView = { y, m: m - 1 };
      renderCal();
    });
    $("calPrev").addEventListener("click", () => shiftCal(-1));
    $("calNext").addEventListener("click", () => shiftCal(1));
    $("calMonth").addEventListener("change", (e) => {
      state.calView.m = +e.target.value;
      renderCal();
    });
    $("calYear").addEventListener("change", (e) => {
      state.calView.y = +e.target.value;
      renderCal();
    });
    $("calGrid").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-day]");
      if (!b) return;
      closeCal();
      jumpToDate(b.dataset.day);
    });
    $("calGrid").addEventListener("keydown", (e) => {
      const b = e.target.closest("button[data-day]");
      if (!b) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      const d = new Date(keyToTs(b.dataset.day));
      d.setDate(d.getDate() + step);
      const key = P.dayKey(d.getTime());
      if (d.getMonth() !== state.calView.m) {
        state.calView = { y: d.getFullYear(), m: d.getMonth() };
        renderCal();
      }
      $("calGrid").querySelector('button[data-day="' + key + '"]')?.focus();
    });

    // Search
    $("searchForm").addEventListener("submit", (e) => {
      e.preventDefault();
      runSearch();
    });
    $("searchForm").addEventListener("input", (e) => {
      if (e.target.name === "scope") updateSenderOptions();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 220);
    });
    $("results").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-r]");
      if (b) openResult(+b.dataset.r);
    });

    // Close buttons, outside clicks, keyboard
    document.addEventListener("click", (e) => {
      const close = e.target.closest("[data-close]");
      if (close) {
        const box = close.closest("#searchPanel, #lightbox");
        if (box && box.id === "searchPanel") {
          closeSearch();
          setHighlight([]);
        } else if (box) box.hidden = true;
        return;
      }
      if (!$("calPop").hidden && !e.target.closest("#calPop, #jumpBtn, #datePill")) closeCal();
      if (!$("moreMenu").hidden && !e.target.closest(".more")) closeMenu();
      if (!$("lightbox").hidden && e.target === $("lightbox")) $("lightbox").hidden = true;
    });
    // Panels opened or closed from the keyboard skip their motion.
    const instantly = (id, fn) => {
      const el = $(id);
      el.classList.add("instant");
      fn();
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("instant")));
    };
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === "Escape") {
        if (!$("lightbox").hidden) $("lightbox").hidden = true;
        else if (!$("calPop").hidden) (instantly("calPop", closeCal), $("jumpBtn").focus());
        else if (!$("moreMenu").hidden) (closeMenu(), $("moreBtn").focus());
        else if (!$("searchPanel").hidden) (instantly("searchPanel", closeSearch), setHighlight([]));
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || $("app").hidden || !state.t) return;
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector('input[name="scope"][value="chat"]').checked = true;
        instantly("searchPanel", () => openSearch());
      } else if (e.key === "g") {
        e.preventDefault();
        instantly("calPop", () => openCal());
      } else if (e.key === "Home" && e.target === tl()) {
        e.preventDefault();
        jumpToIndex(0, { flash: false });
      } else if (e.key === "End" && e.target === tl()) {
        e.preventDefault();
        jumpToIndex(state.t.count - 1, { flash: false, bottom: true });
      }
    });

    drawHeroRail();
  }

  $("embedsToggle").setAttribute("aria-checked", String(state.embeds));
  wire();

  // Exposed for debugging and tests.
  DMR.app = { state, openThread, jumpToDate, jumpToIndex, runSearch, setData, openFrom, embedInfo, setEmbeds };
})();
