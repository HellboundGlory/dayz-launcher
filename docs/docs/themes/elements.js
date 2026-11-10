// Element filter for the reference page.
const search = document.getElementById("el-search");
const entries = [...document.querySelectorAll("section.el[data-el]")];
const groups = [...document.querySelectorAll("section.el-group")];
const noMatch = document.querySelector(".el-search-empty");

search.addEventListener("input", () => {
  const query = search.value.trim().toLowerCase();
  let shown = 0;
  for (const entry of entries) {
    const hit = !query || entry.dataset.el.includes(query);
    entry.hidden = !hit;
    if (hit) shown += 1;
  }
  for (const group of groups) {
    group.hidden = Boolean(query) && !group.querySelector("section.el[data-el]:not([hidden])");
  }
  noMatch.hidden = shown > 0;
});
