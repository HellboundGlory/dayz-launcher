// Scroll-reveal for elements marked `.reveal` — shared across every page.
// Respects prefers-reduced-motion by doing nothing (the CSS fallback there
// already shows everything at full opacity).
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 },
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
} else {
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible"));
}

// Screenshot carousel — only present on the homepage. Auto-advances,
// pauses on hover, and never auto-advances under prefers-reduced-motion
// (manual dot clicks still work either way).
const carousel = document.getElementById("carousel");
if (carousel) {
  const slides = carousel.querySelectorAll(".carousel-slide");
  const dots = carousel.querySelectorAll(".carousel-dot");
  const caption = document.getElementById("carousel-caption");
  const prevBtn = carousel.querySelector(".carousel-arrow-prev");
  const nextBtn = carousel.querySelector(".carousel-arrow-next");
  let index = 0;
  let timer = null;

  function show(i) {
    index = (i + slides.length) % slides.length;
    slides.forEach((s, n) => s.classList.toggle("is-active", n === index));
    dots.forEach((d, n) => d.classList.toggle("is-active", n === index));
    if (caption) caption.textContent = slides[index].dataset.caption ?? "";
  }

  function next() {
    show(index + 1);
  }

  function prev() {
    show(index - 1);
  }

  function start() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    stop();
    timer = setInterval(next, 6000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  dots.forEach((dot, n) => {
    dot.addEventListener("click", () => {
      show(n);
      start();
    });
  });
  nextBtn?.addEventListener("click", () => {
    next();
    start();
  });
  prevBtn?.addEventListener("click", () => {
    prev();
    start();
  });
  carousel.addEventListener("mouseenter", stop);
  carousel.addEventListener("mouseleave", start);

  start();
}
