/*
 * DM Rewind — file sources
 * Turns whatever the user opened (a folder, a .zip, loose files, or a drag-and-drop)
 * into a flat list of entries: { path, size, text(), blob() }.
 */
(function () {
  "use strict";
  const DMR = (window.DMR = window.DMR || {});

  const MIME = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", m4a: "audio/mp4", aac: "audio/aac",
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", pdf: "application/pdf",
    json: "application/json", html: "text/html",
  };
  function mimeOf(path) {
    const ext = (path.split(".").pop() || "").toLowerCase();
    return MIME[ext] || "application/octet-stream";
  }

  function fromFile(file, path) {
    return {
      path: (path || file.webkitRelativePath || file.name).replace(/\\/g, "/"),
      size: file.size,
      text: () => file.text(),
      blob: () => Promise.resolve(file.type ? file : new Blob([file], { type: mimeOf(file.name) })),
    };
  }

  function fromFileList(list) {
    return Array.from(list).map((f) => fromFile(f));
  }

  async function fromZip(file) {
    if (!window.zip) throw new Error("The zip reader didn't load. Unzip the export and open the folder instead.");
    window.zip.configure({ useWebWorkers: false });
    const reader = new window.zip.ZipReader(new window.zip.BlobReader(file));
    let entries;
    try {
      entries = await reader.getEntries();
    } catch (e) {
      throw new Error("Couldn't open " + file.name + " as a zip file (" + (e.message || e) + ").");
    }
    return entries
      .filter((e) => !e.directory)
      .map((e) => ({
        path: e.filename.replace(/\\/g, "/"),
        size: e.uncompressedSize,
        text: () => e.getData(new window.zip.TextWriter("utf-8")),
        blob: () => e.getData(new window.zip.BlobWriter(mimeOf(e.filename))),
      }));
  }

  /** Expand files picked in a file dialog: zips are opened, everything else is used as-is. */
  async function fromPicked(list) {
    const files = Array.from(list);
    const out = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) out.push(...(await fromZip(f)));
      else out.push(fromFile(f));
    }
    return out;
  }

  /** Read a drag-and-drop, following dropped folders recursively. */
  async function fromDrop(dataTransfer) {
    const items = Array.from(dataTransfer.items || []);
    const roots = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    if (!roots.length) return fromPicked(dataTransfer.files);

    const files = [];
    const readDir = (dir) =>
      new Promise((resolve, reject) => {
        const reader = dir.createReader();
        const all = [];
        const next = () =>
          reader.readEntries((batch) => {
            if (!batch.length) return resolve(all);
            all.push(...batch);
            next();
          }, reject);
        next();
      });
    const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const f = await fileOf(entry);
        files.push({ f, path: prefix + entry.name });
      } else if (entry.isDirectory) {
        for (const child of await readDir(entry)) await walk(child, prefix + entry.name + "/");
      }
    };
    for (const r of roots) await walk(r, "");

    const out = [];
    for (const { f, path } of files) {
      if (/\.zip$/i.test(f.name) && files.length === 1) out.push(...(await fromZip(f)));
      else out.push(fromFile(f, path));
    }
    return out;
  }

  DMR.sources = { fromFileList, fromZip, fromPicked, fromDrop, mimeOf };
})();
