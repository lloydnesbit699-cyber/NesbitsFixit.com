/* Crumbs Vault site tour — a guided walk around the whole website.
   Follows the shape of Veli'Thra's welcome tour (steps array, one
   plain sentence each, the step's target wearing a bright highlight,
   Back / Next / Skip / close): the extension's code itself can't be
   reused here — it leans on extension machinery (edit mode, the
   selection engine, chrome.storage) — so this is a standalone
   version written for a plain static site. Dependency-free.

   The tour runs on the home page only. Steps that have a page of
   their own carry a Visit link; following one mid-tour stores the
   next step in sessionStorage, and the page you land on shows a
   pill to come back and resume. */

(function () {
  'use strict';

  var RESUME_KEY = 'cv-tour-resume';

  /* One or two plain sentences per stop: what the thing is, and
     what to do there. Teaching, not selling. */
  var STEPS = [
    {
      title: 'Welcome to Crumbs Vault',
      text: 'A small studio in Moultrie, Georgia. This is the front door to everything we build — a game, a browser extension, and a workshop full of creations. This tour takes about a minute.',
      target: '#tour-welcome'
    },
    {
      title: 'Crumbs World',
      text: 'Crumbs World is our game — a pixel-art vault dungeon to explore, with creatures to meet and a dragon or two. Enter the world to see the front door, or hit Play to jump straight in.',
      target: '#tour-crumbs',
      visit: { href: '/crumbs-world/', label: 'Visit Crumbs World' }
    },
    {
      title: "Veli'Thra qo'choH",
      text: "Veli'Thra is a browser extension that lets you move, resize, recolor, and rename the controls on any website — in your own browser, on your own machine. Nothing is uploaded, and the website itself never changes.",
      target: '#tour-velithra',
      visit: { href: '/showcase/velithra/', label: 'Try the demo' }
    },
    {
      title: 'Pricing',
      text: "Veli'Thra is free for one website, forever. The paid plans add more websites — Basic covers 3, Pro and Lifetime are unlimited. The paid plans open soon.",
      target: '#tour-pricing'
    },
    {
      title: 'The Showcase',
      text: "The Showcase is everything we're building, on display — the Living River, the Dragon Bench, Aetherion, and the Veli'Thra demo. New exhibits land as they're built.",
      target: '#tour-showcase',
      visit: { href: '/showcase/', label: 'Visit the Showcase' }
    },
    {
      title: 'New Creations',
      text: "New Creations is the newest shelf — the first things our forge made, beside the dragons. The little dino there was generated from a single picture.",
      target: null,
      visit: { href: '/3d-viewers/new-creations.html', label: 'See New Creations' }
    },
    {
      title: 'The 3D viewers',
      text: 'The 3D viewers are where the models live — the Dragon Bench, Aetherion, and more. Drag to turn them around, pinch to zoom in.',
      target: null,
      visit: { href: '/3d-viewers/dragon-bench.html', label: 'Visit the Dragon Bench' }
    },
    {
      title: "Nesbit's Fix-It",
      text: "Nesbit's Fix-It is the repair business that started it all — home maintenance and tech repair in Moultrie. It has its own home now, at its own address.",
      target: '#tour-fixit',
      visit: { href: 'https://nesbitsfixit.com/', label: 'Visit nesbitsfixit.com', external: true }
    },
    {
      title: 'The fine print',
      text: "Down here is the fine print — the terms, the privacy policy, and the support email if you need a hand. That's the whole site. Go have a look around.",
      target: '#tour-footer'
    }
  ];

  var idx = -1;
  var card = null;
  var resumePill = null;

  function isHome() {
    var p = window.location.pathname;
    return p === '/' || p === '/index.html';
  }

  function readResume() {
    try {
      var raw = window.sessionStorage.getItem(RESUME_KEY);
      if (raw === null) return -1;
      var n = parseInt(raw, 10);
      if (isNaN(n) || n < 0 || n >= STEPS.length) return -1;
      return n;
    } catch (err) {
      return -1;
    }
  }

  function storeResume(n) {
    try { window.sessionStorage.setItem(RESUME_KEY, String(n)); } catch (err) { /* private mode: the tour still works */ }
  }

  function clearResume() {
    try { window.sessionStorage.removeItem(RESUME_KEY); } catch (err) { /* ignore */ }
  }

  function el(tag, id, text) {
    var n = document.createElement(tag);
    if (id) n.id = id;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function buildCard() {
    if (card) return card;
    card = el('div', 'cv-tour-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Website tour');

    var top = el('div', 'cv-tour-top');
    top.appendChild(el('span', 'cv-tour-label', 'Step 1 of ' + STEPS.length));
    var close = el('button', 'cv-tour-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'End tour');
    close.addEventListener('click', endTour);
    top.appendChild(close);
    card.appendChild(top);

    card.appendChild(el('h2', 'cv-tour-title', ''));
    var text = el('p', 'cv-tour-text', '');
    text.setAttribute('aria-live', 'polite');
    card.appendChild(text);

    var visitWrap = el('div', 'cv-tour-visit');
    var visitLink = el('a', 'cv-tour-visit-link', '');
    visitWrap.appendChild(visitLink);
    card.appendChild(visitWrap);

    var btns = el('div', 'cv-tour-btns');
    var back = el('button', 'cv-tour-back', '‹ Back');
    back.type = 'button';
    back.addEventListener('click', function () { if (idx > 0) showStep(idx - 1); });
    var next = el('button', 'cv-tour-next', 'Next ›');
    next.type = 'button';
    next.addEventListener('click', function () {
      if (idx >= STEPS.length - 1) endTour();
      else showStep(idx + 1);
    });
    var skip = el('button', 'cv-tour-skip', 'Skip tour');
    skip.type = 'button';
    skip.addEventListener('click', endTour);
    btns.appendChild(back);
    btns.appendChild(next);
    btns.appendChild(skip);
    card.appendChild(btns);

    document.body.appendChild(card);
    return card;
  }

  function clearHl() {
    var nodes = document.querySelectorAll('.cv-tour-hl');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('cv-tour-hl');
  }

  function showStep(i) {
    idx = i;
    var st = STEPS[i];
    clearHl();
    var t = null;
    if (st.target) {
      t = document.querySelector(st.target);
      if (t) {
        t.classList.add('cv-tour-hl');
        try { t.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (err) { /* off-DOM */ }
      }
      /* A missing target degrades to an unanchored step — the tour
         never crashes on a page that changed under it. */
    }
    buildCard();
    document.getElementById('cv-tour-label').textContent =
      'Step ' + (i + 1) + ' of ' + STEPS.length;
    document.getElementById('cv-tour-title').textContent = st.title;
    document.getElementById('cv-tour-text').textContent = st.text;
    document.getElementById('cv-tour-back').disabled = (i === 0);
    var next = document.getElementById('cv-tour-next');
    next.textContent = (i === STEPS.length - 1) ? 'Done' : 'Next ›';
    var visitWrap = document.getElementById('cv-tour-visit');
    var visitLink = document.getElementById('cv-tour-visit-link');
    if (st.visit) {
      visitLink.textContent = st.visit.label + ' →';
      visitLink.href = st.visit.href;
      if (st.visit.external) {
        visitLink.target = '_blank';
        visitLink.rel = 'noopener';
      } else {
        visitLink.removeAttribute('target');
        visitLink.removeAttribute('rel');
      }
      visitWrap.style.display = 'block';
    } else {
      visitWrap.style.display = 'none';
    }
    card.style.display = 'block';
  }

  function startTour(i) {
    hideResumePill();
    showStep(i);
  }

  function endTour() {
    if (idx < 0) return;
    idx = -1;
    clearHl();
    clearResume();
    if (card) card.style.display = 'none';
  }

  function hideResumePill() {
    if (resumePill) resumePill.style.display = 'none';
  }

  function showResumePill() {
    var at = readResume();
    if (at < 0) return;
    if (resumePill) { resumePill.style.display = 'block'; return; }
    if (isHome()) {
      resumePill = el('button', 'cv-tour-resume', 'Resume the tour');
      resumePill.type = 'button';
      resumePill.addEventListener('click', function () { startTour(readResume()); });
    } else {
      resumePill = el('a', 'cv-tour-resume', 'Back to the tour →');
      resumePill.href = '/';
    }
    document.body.appendChild(resumePill);
    resumePill.style.display = 'block';
  }

  /* Following a Visit link mid-tour stores the next step, so the
     page you land on can bring you back. External links open in a
     new tab and leave the tour running here. */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('#cv-tour-visit-link') : null;
    if (!a || idx < 0) return;
    if (a.target === '_blank') return;
    storeResume(Math.min(idx + 1, STEPS.length - 1));
  });

  document.addEventListener('keydown', function (e) {
    if (idx < 0) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') endTour();
    else if (e.key === 'ArrowRight' && idx < STEPS.length - 1) showStep(idx + 1);
    else if (e.key === 'ArrowLeft' && idx > 0) showStep(idx - 1);
  });

  function init() {
    var start = document.getElementById('cv-tour-start');
    if (start) start.addEventListener('click', function () { startTour(0); });
    showResumePill();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
