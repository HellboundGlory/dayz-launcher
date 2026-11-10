// Copy buttons and the sidebar scroll-spy, shared by every theme docs page.
for (const btn of document.querySelectorAll(".code .copy")) {
  btn.addEventListener("click", async () => {
    const text = btn.closest(".code").querySelector("pre").innerText;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Select and copy";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1600);
  });
}

if (matchMedia("(max-width: 900px)").matches) {
  document.querySelector(".docs-nav details").open = false;
}

const links = [...document.querySelectorAll('.docs-nav a[href^="#"]')];
const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
const spy = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const a of links) a.removeAttribute("aria-current");
      byId.get(entry.target.id)?.setAttribute("aria-current", "true");
    }
  },
  { rootMargin: "-80px 0px -70% 0px" },
);
for (const id of byId.keys()) {
  const heading = document.getElementById(id);
  if (heading) spy.observe(heading);
}
