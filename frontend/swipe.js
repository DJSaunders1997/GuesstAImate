/**
 * swipe.js — Day-navigation gestures & keyboard shortcuts.
 *
 * Provides:
 *   - navigateDay(fn, fromSide)  — shared helper used by both keyboard and swipe
 *   - ArrowLeft / ArrowRight keyboard navigation
 *   - Touch swipe with live drag, rubber-band resistance, and spring-back
 *
 * Depends on: prevDay(), nextDay() from render.js (must load before this file).
 * touch-action: pan-y is set globally in styles.css so the browser hands
 * horizontal gestures to JS on real touch devices.
 */

// ── SHARED HELPER ─────────────────────────────────────────────────────────────

function navigateDay(fn, fromSide) {
  fn();
  const s = document.querySelector('.logs-section');
  if (!s) return;
  s.classList.remove('slide-from-left', 'slide-from-right');
  void s.offsetWidth; // force reflow so re-adding the class retriggers the animation
  s.classList.add(`slide-from-${fromSide}`);
  s.addEventListener('animationend', () => s.classList.remove(`slide-from-${fromSide}`), { once: true });
}

// ── KEYBOARD ──────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft')  navigateDay(prevDay, 'left');
  if (e.key === 'ArrowRight') navigateDay(nextDay, 'right');
});

// ── SWIPE (live drag) ─────────────────────────────────────────────────────────

(function () {
  const COMMIT_PX = 80;
  let startX = 0, startY = 0, axisLocked = false, isHorizontal = false;

  const section  = () => document.querySelector('.logs-section');
  const nextBtn  = () => document.getElementById('next-day');

  document.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    axisLocked = isHorizontal = false;
    const s = section();
    if (s) { s.style.transition = 'none'; s.style.willChange = 'transform, opacity'; }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!axisLocked && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      axisLocked   = true;
      isHorizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
    }
    if (!isHorizontal) return;
    e.preventDefault();
    const s = section();
    if (!s) return;
    const blocked = dx < 0 && nextBtn()?.disabled;
    const t = blocked ? dx * 0.2 : dx;
    s.style.transform = `translateX(${t}px)`;
    s.style.opacity   = String(1 - Math.min(Math.abs(t) / window.innerWidth, 1) * 0.2);
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (!isHorizontal) return;
    const dx = e.changedTouches[0].clientX - startX;
    const s  = section();
    if (!s) return;

    const committed = Math.abs(dx) >= COMMIT_PX && (dx > 0 || !nextBtn()?.disabled);
    if (committed) {
      const dir  = dx > 0 ? 1 : -1;
      s.style.transition = 'transform 0.18s ease-in, opacity 0.18s ease-in';
      s.style.transform  = `translateX(${dir * window.innerWidth * 0.6}px)`;
      s.style.opacity    = '0';
      setTimeout(() => {
        s.style.transition = 'none';
        s.style.transform  = `translateX(${-dir * 35}px)`;
        s.style.opacity    = '0';
        if (dx > 0) prevDay(); else nextDay();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          s.style.transition = 'transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.18s ease-out';
          s.style.transform  = s.style.opacity = s.style.willChange = '';
        }));
      }, 180);
    } else {
      s.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease-out';
      s.style.transform  = s.style.opacity = '';
      s.addEventListener('transitionend', () => { s.style.willChange = ''; }, { once: true });
    }
  }, { passive: true });
}());
