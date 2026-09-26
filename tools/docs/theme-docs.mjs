// Builds docs/docs/themes/elements.html from src/theme/registry.json and the
// author-written notes in element-notes.json. Plain Node ESM: `npm run docs:themes`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "docs/docs/themes/elements.html");

const WHERE = {
  app: "the shell, any view, or Settings",
  browser: "the server browser view",
  mods: "the Mods view",
  settings: "Settings",
  server: "anywhere a server is the subject: a server row, the server info modal, a selection container, or the server actions popup",
  "server-panel": "the server info modal, a selection container, or the server actions popup, not a row",
  mod: "a mod row, or a modSelection container in the Mods view",
  "mod-panel": "a modSelection container, not a row",
  serverMod: "a server's mod row",
  modServer: "a mod's server row",
  workshopMod: "a mod filter result row, or a modFilterPreview container in the mod filter modal",
  modFilter: "the mod filter modal",
  update: "the update modal",
  modal: "any themeable modal",
  selection: "a selection container, not a row or modal",
  popup: "any themeable popup",
};

const REQUIRED = {
  views: "every composition of the shell with the server browser, and of the shell with Mods",
  "views+settings": "as `views`, plus the composition of the shell with Settings",
  "view:browser": "the shell + server browser composition",
  "view:mods": "the shell + Mods composition",
  settings: "the shell + Settings composition",
  withJoin: "every subject context that places `server.join`",
  modal: "every themeable modal",
  "popup:region": "popups placed in a region",
  "popup:inline": "popups placed inline",
};

const MULTIPLICITY = {
  many: "any number of times",
  perComposition: "once per composition",
  perContext: "once per subject context",
};

const SECTION_LABELS = {
  surfaces: "Surfaces",
  lists: "Lists",
  modals: "Modals",
  popups: "Popups",
  icons: "Icons",
  notPlaceable: "Not placeable",
};

const nonPlaceable = { id: "not-placeable", note: "notPlaceable" };

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `code` and **bold**, the whole inline subset the notes use. */
function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .split("`")
    .map((part, index) => (index % 2 === 1 ? `<code>${part}</code>` : part))
    .join("");
}

function tableCells(row) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(lines, start) {
  const rows = [];
  let index = start;
  while (index < lines.length && /^\s*\|/.test(lines[index])) rows.push(lines[index++]);
  const head = tableCells(rows[0]);
  const body = rows.slice(2).map(tableCells);
  const thead = `<thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return { html: `<div class="table-wrap"><table>${thead}${tbody}</table></div>`, next: index };
}

/** Bullets with at most one nested level, then paragraphs and tables. */
function renderList(items) {
  let html = "<ul>";
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const nested = index + 1 < items.length && items[index + 1].depth > item.depth;
    html += `<li>${inline(item.text)}`;
    if (nested) {
      html += "<ul>";
      while (index + 1 < items.length && items[index + 1].depth > item.depth) {
        index += 1;
        html += `<li>${inline(items[index].text)}</li>`;
      }
      html += "</ul>";
    }
    html += "</li>";
  }
  return `${html}</ul>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
    } else if (/^\s*\|/.test(line)) {
      const table = renderTable(lines, index);
      blocks.push(table.html);
      index = table.next;
    } else if (/^\s*- /.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*- /.test(lines[index])) {
        const depth = /^(\s*)- /.exec(lines[index])[1].length > 0 ? 1 : 0;
        const text = lines[index].replace(/^\s*- /, "");
        index += 1;
        const continuation = [];
        while (index < lines.length && lines[index].trim() !== "" && !/^\s*(- |\|)/.test(lines[index])) {
          continuation.push(lines[index].trim());
          index += 1;
        }
        items.push({ depth, text: [text, ...continuation].join(" ") });
      }
      blocks.push(renderList(items));
    } else {
      const paragraph = [];
      while (index < lines.length && lines[index].trim() !== "" && !/^\s*(\||- )/.test(lines[index])) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
    }
  }
  return blocks.join("\n");
}

function formatValue(value) {
  if (typeof value === "number") return String(value);
  if (value === true) return "on";
  if (value === false) return "off";
  return `\`${value}\``;
}

const OPTION_TYPE = {
  boolean: "on or off",
  icon: 'icon name, a package image path, or "none"',
  text: "text",
  length: "length",
  token: "token name",
  region: "region id",
};

/** `(type, default X)`, in the notes' markdown subset so values render as code. */
function optionText(option) {
  const parts =
    option.type === "enum"
      ? [`one of ${option.values.map(formatValue).join(", ")}`]
      : [OPTION_TYPE[option.type] ?? option.type];
  if (option.type === "boolean") parts.push(`default ${option.default ? "on" : "off"}`);
  else if (option.default !== undefined) parts.push(`default ${formatValue(option.default)}`);
  else if (option.type === "region") parts.push("required");
  return `(${parts.join(", ")})`;
}

function whereText(code) {
  if (code.startsWith("popup:")) return `the ${code.slice("popup:".length)} popup`;
  if (code.startsWith("modal:")) return `the \`${code.slice("modal:".length)}\` modal`;
  return WHERE[code] ?? code;
}

function requiredText(code) {
  if (code.startsWith("list:")) return `every row of \`list.${code.slice("list:".length).replace("/row", "")}\``;
  if (code.startsWith("modal:")) return `the \`${code.slice("modal:".length)}\` modal`;
  if (code.startsWith("popup:")) return `the ${code.slice("popup:".length)} popup`;
  return REQUIRED[code] ?? code;
}

function multiplicityText(element) {
  if (element.multiplicityScope === "region") return "once per target region";
  return MULTIPLICITY[element.multiplicity] ?? element.multiplicity;
}

function codeChip(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

function chipLine(values) {
  return values.map(codeChip).join(", ");
}

function rowsToDl(rows) {
  return `<dl>${rows.map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join("")}</dl>`;
}

function definitionRows(element, options) {
  const placed = element.where.map(whereText).map(inline);
  if (element.excludedWhere) placed.push(`not ${element.excludedWhere.map(whereText).map(inline).join(", ")}`);
  const rows = [["Placed in", `${placed.join(", ")} · ${multiplicityText(element)}`]];
  if (element.required.length) rows.push(["Required in", element.required.map(requiredText).map(inline).join("; ")]);
  if (element.parts.length || element.states.length) {
    const states = element.states.length ? ` · States: ${chipLine(element.states)}` : "";
    rows.push([element.parts.length ? "Parts" : "States", `${chipLine(element.parts)}${states}`]);
  }
  if (options.length) {
    const items = options
      .map(([name, option]) => `<li>${inline(`\`${name}\` ${optionText(option)}`)}</li>`)
      .join("");
    rows.push(["Options", `<ul class="el-options">${items}</ul>`]);
  }
  return rowsToDl(rows);
}

function elementEntry(element, id, notes) {
  const note = notes.elements?.[id];
  const badges = [`<span class="el-kind">${escapeHtml(element.kind)}</span>`];
  if (element.since !== "2.0") badges.push(`<span class="el-since">SINCE ${escapeHtml(element.since)}</span>`);
  const heading = `<h3><code>${escapeHtml(id)}</code> ${badges.join(" ")}</h3>`;
  const body = note ? `\n  <div class="md el-notes">${renderMarkdown(note)}</div>` : "";
  return `<section class="el" id="el-${escapeHtml(id.replace(/\./g, "-"))}" data-el="${escapeHtml(id)}">\n  ${heading}\n  ${definitionRows(element, Object.entries(element.options))}${body}\n</section>`;
}

function surfaceEntry(id, surface) {
  const rows = [
    ["Placed in", surface.where.map(whereText).map(inline).join(", ")],
    ["Contains", chipLine(surface.contains)],
  ];
  return `<section class="el">\n  <h3><code>${escapeHtml(id)}</code></h3>\n  ${rowsToDl(rows)}\n</section>`;
}

function listEntry(id, list) {
  const rows = [
    ["Row subject", codeChip(list.subject)],
    ["Row template", codeChip(list.template)],
    ["Sort keys", list.sortKeys.length ? chipLine(list.sortKeys) : "none: the list keeps its own order"],
    [
      "Default sort",
      list.defaultSort ? `${codeChip(list.defaultSort.key)}, ${escapeHtml(list.defaultSort.direction)}` : "none",
    ],
    ["Row states", chipLine(list.states)],
  ];
  return `<section class="el">\n  <h3><code>${escapeHtml(id)}</code></h3>\n  ${rowsToDl(rows)}\n</section>`;
}

function modalEntry(id, modal) {
  const rows = [
    ["File", codeChip(modal.file)],
    ["Subject", modal.subject ? codeChip(modal.subject) : "none: the modal is not about one row"],
    ["Required", chipLine(modal.required)],
  ];
  return `<section class="el">\n  <h3><code>${escapeHtml(id)}</code></h3>\n  ${rowsToDl(rows)}\n</section>`;
}

function popupEntry(id, popup) {
  const rows = [
    ["Opened by", codeChip(popup.openedBy)],
    [
      "Required contents",
      popup.requiredContents.length ? chipLine(popup.requiredContents) : "none: the popup holds an action menu",
    ],
  ];
  return `<section class="el">\n  <h3><code>${escapeHtml(id)}</code></h3>\n  ${rowsToDl(rows)}\n</section>`;
}

function groupPrefixes(registry, notes) {
  const prefixes = [];
  for (const id of Object.keys(registry.elements)) {
    const prefix = id.slice(0, id.indexOf("."));
    if (!prefixes.includes(prefix)) prefixes.push(prefix);
  }
  const documented = Object.keys(notes.groups).filter((prefix) => prefixes.includes(prefix));
  return [...documented, ...prefixes.filter((prefix) => !documented.includes(prefix))];
}

function groupTitle(prefix, notes) {
  const title = notes.groups[prefix]?.title;
  return title ? title[0].toUpperCase() + title.slice(1) : prefix;
}

function sidebar(prefixes, notes) {
  const groups = prefixes
    .map(
      (prefix) =>
        `<li><a href="#${prefix}"><code>${escapeHtml(prefix)}</code> ${escapeHtml(groupTitle(prefix, notes))}</a></li>`,
    )
    .join("\n            ");
  const sections = ["surfaces", "lists", "modals", "popups", "icons"]
    .map((key) => `<li><a href="#${key}">${SECTION_LABELS[key]}</a></li>`)
    .join("\n            ");
  return `<h2>Guide</h2>
          <ol>
            <li><a href="/docs/themes/">Making a theme</a></li>
          </ol>
          <h2>Reference</h2>
          <ol>
            ${groups}
            ${sections}
            <li><a href="/docs/themes/reference">Manifest, tokens and rules</a></li>
          </ol>`;
}

const PAGE_SCRIPT = [
  '      if (matchMedia("(max-width: 900px)").matches) {',
  '        document.querySelector(".docs-nav details").open = false;',
  "      }",
  "",
  '      const links = [...document.querySelectorAll(\'.docs-nav a[href^="#"]\')];',
  '      const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));',
  "      const spy = new IntersectionObserver(",
  "        (entries) => {",
  "          for (const entry of entries) {",
  "            if (!entry.isIntersecting) continue;",
  '            for (const a of links) a.removeAttribute("aria-current");',
  '            byId.get(entry.target.id)?.setAttribute("aria-current", "true");',
  "          }",
  "        },",
  '        { rootMargin: "-80px 0px -70% 0px" },',
  "      );",
  "      for (const id of byId.keys()) {",
  "        const heading = document.getElementById(id);",
  "        if (heading) spy.observe(heading);",
  "      }",
  "",
  '      const search = document.getElementById("el-search");',
  '      const entries = [...document.querySelectorAll("section.el[data-el]")];',
  '      const groups = [...document.querySelectorAll("section.el-group")];',
  '      const noMatch = document.querySelector(".el-search-empty");',
  '      search.addEventListener("input", () => {',
  "        const query = search.value.trim().toLowerCase();",
  "        let shown = 0;",
  "        for (const entry of entries) {",
  "          const hit = !query || entry.dataset.el.includes(query);",
  "          entry.hidden = !hit;",
  "          if (hit) shown += 1;",
  "        }",
  '        for (const group of groups) group.hidden = Boolean(query) && !group.querySelector("section.el[data-el]:not([hidden])");',
  "        noMatch.hidden = shown > 0;",
  "      });",
].join("\n");

export function renderElementsPage(registry, notes) {
  const prefixes = groupPrefixes(registry, notes);
  const byPrefix = new Map();
  for (const [id, element] of Object.entries(registry.elements)) {
    const prefix = id.slice(0, id.indexOf("."));
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(elementEntry(element, id, notes));
  }

  const groups = prefixes
    .map((prefix) => {
      const group = notes.groups[prefix];
      const heading = `<h2 id="${prefix}"><code>${escapeHtml(prefix)}</code> ${escapeHtml(groupTitle(prefix, notes))}</h2>`;
      const blurb = group?.blurb ? `\n  <div class="md">${renderMarkdown(group.blurb)}</div>` : "";
      const entries = byPrefix.get(prefix).map((entry) => `  ${entry}`).join("\n");
      return `<section class="el-group">\n  ${heading}${blurb}\n${entries}\n</section>`;
    })
    .join("\n\n");

  const surfaces = Object.entries(registry.surfaces)
    .map(([id, surface]) => `  ${surfaceEntry(id, surface)}`)
    .join("\n");
  const lists = Object.entries(registry.lists)
    .map(([id, list]) => `  ${listEntry(id, list)}`)
    .join("\n");
  const modals = Object.entries(registry.modals)
    .map(([id, modal]) => `  ${modalEntry(id, modal)}`)
    .join("\n");
  const popups = Object.entries(registry.popups)
    .map(([id, popup]) => `  ${popupEntry(id, popup)}`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Element reference — Tetra Launcher</title>
    <meta
      name="description"
      content="Every element a Tetra Launcher theme can place: where it goes, whether it is required, and its options, parts and states."
    />
    <link rel="icon" href="../../assets/tetra-logo.png" />
    <link rel="stylesheet" href="../../style-v2.css" />
    <link rel="stylesheet" href="../../docs.css" />
  </head>
  <body>
    <header class="site-nav">
      <div class="container">
        <a class="brand" href="/">
          <img src="../../assets/tetra-logo.png" alt="" />
          <span><span class="tetra">TETRA</span> <span class="launcher">LAUNCHER</span></span>
        </a>
        <nav class="links">
          <a href="/">Home</a>
          <a href="/download">Download</a>
          <a href="/docs/themes/" class="active">Themes</a>
          <a href="https://github.com/HellboundGlory/dayz-launcher">GitHub</a>
        </nav>
      </div>
    </header>

    <div class="docs">
      <aside class="docs-nav" aria-label="Theme docs">
        <details open>
          <summary>On this page</summary>
          ${sidebar(prefixes, notes)}
        </details>
      </aside>

      <main class="prose">
        <h1>Element reference</h1>
        <p class="lede">
          Every element a v2 theme can place, with the conditions the launcher checks
          before it accepts it.
        </p>

        <div class="md">${renderMarkdown(notes.intro)}</div>

        <div class="el-search">
          <input
            type="search"
            id="el-search"
            placeholder="Filter elements by id"
            aria-label="Filter elements by id"
            autocomplete="off"
            spellcheck="false"
          />
          <p class="el-search-empty" hidden>No elements match</p>
        </div>

${groups}

        <h2 id="surfaces">Surfaces</h2>
        <div class="md">${renderMarkdown(notes.sections.surfaces)}</div>
${surfaces}

        <h2 id="lists">Lists</h2>
        <div class="md">${renderMarkdown(notes.sections.lists)}</div>
${lists}

        <h2 id="modals">Modals</h2>
        <div class="md">${renderMarkdown(notes.sections.modals)}</div>
${modals}

        <h2 id="popups">Popups</h2>
        <div class="md">${renderMarkdown(notes.sections.popups)}</div>
${popups}

        <h2 id="icons">Icons</h2>
        <p>The names the <code>icon</code> option accepts.</p>
        <p>${chipLine(registry.icons)}</p>

        <h2 id="${nonPlaceable.id}">${SECTION_LABELS[nonPlaceable.note]}</h2>
        <div class="md">${renderMarkdown(notes.sections[nonPlaceable.note])}</div>
      </main>
    </div>

    <footer>
      <div class="container">
        <p>
          TETRA LAUNCHER — free and source-available.
          <a href="https://github.com/HellboundGlory/dayz-launcher">Source on GitHub</a>.
          Not affiliated with Bohemia Interactive.
        </p>
      </div>
    </footer>

    <script>
${PAGE_SCRIPT}
    </script>
  </body>
</html>
`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const registry = readJson(resolve(ROOT, "src/theme/registry.json"));
  const notes = readJson(resolve(ROOT, "tools/docs/element-notes.json"));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, renderElementsPage(registry, notes));
  process.stdout.write(`Wrote ${OUT}\n`);
}
