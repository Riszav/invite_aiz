(function () {
  // ?preview=1 inside the admin editor: render the unsaved data from the parent window
  const PREVIEW = new URLSearchParams(location.search).has('preview');
  let parentData = null;
  try { parentData = PREVIEW && window.parent !== window ? window.parent.__PREVIEW_DATA : null; } catch (e) { /* cross-origin */ }
  const DATA = parentData || window.PAGE_DATA;
  const page = document.getElementById('page');
  const MONTHS = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'];
  const WEEKDAYS = ['ЖЕКШЕМБИ', 'ДҮЙШӨМБҮ', 'ШЕЙШЕМБИ', 'ШАРШЕМБИ', 'БЕЙШЕМБИ', 'ЖУМА', 'ИШЕМБИ'];
  const TZ_OFFSET = { 'Asia/Almaty': '+05:00', 'Asia/Bishkek': '+06:00' };
  const PAGE_SLUG = window.PAGE_SLUG || 'kyz-uzatuu';
  const CAL_WEEKDAYS = ['Дш', 'Шш', 'Шр', 'Бш', 'Жм', 'Иш', 'Жк'];

  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') Object.assign(n.style, v);
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => c != null && n.append(c));
    return n;
  };

  const api = async (path, body) => {
    const res = await fetch(path, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    } : undefined);
    if (!res.ok) throw new Error(res.status);
    return res.json();
  };

  // ---------------- animation wrapper ----------------
  const animated = [];
  function wrapAnim(node, anim) {
    if (!anim) return node;
    const w = el('div', { class: 'anim', style: { width: '100%', height: '100%' } }, node);
    if (anim.type === 'spin') {
      w.classList.add('spin');
      w.style.animationDuration = anim.duration + 's';
    } else {
      w.classList.add(anim.type);
      w.style.animationDuration = anim.duration + 's';
      animated.push(w);
    }
    return w;
  }

  // ---------------- component renderers ----------------
  const R = {};

  R.text = c => el(c.data.tag === 'p' ? 'p' : 'div', {
    class: 'text-content',
    style: {
      fontSize: c.style.fontSize, fontFamily: c.style.fontFamily, color: c.style.color,
      textAlign: c.style.textAlign, fontWeight: c.style.fontWeight, lineHeight: c.style.lineHeight
    }
  }, c.data.content);

  // jagged "torn paper" edge on top and/or bottom of a photo, drawn as an SVG mask.
  // Deterministic per seed so the edge looks the same on every visit.
  function tornMask(w, h, edge) {
    let seed = (edge.seed || 1) * 9301 + (edge.variant || '').length * 49297;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const depth = edge.height || 35;
    const coarse = edge.variant === 'torn1';  // big mountain-like peaks vs finer rip
    const step = coarse ? 14 : 7;
    const line = (y0, dir) => {
      const pts = [];
      for (let x = 0; x <= w + step; x += step) {
        const big = coarse && rnd() < 0.18 ? rnd() * depth : 0;
        const d = Math.min(depth, rnd() * depth * 0.55 + big);
        pts.push(`${Math.min(x, w).toFixed(1)},${(y0 + dir * d).toFixed(1)}`);
      }
      return pts;
    };
    const top = edge.top ? line(0, 1) : [`0,0`, `${w},0`];
    const bottom = edge.bottom ? line(h, -1).reverse() : [`${w},${h}`, `0,${h}`];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polygon fill="#000" points="${top.join(' ')} ${bottom.join(' ')}"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  R.image = c => {
    const s = c.style;
    const torn = c.data.tornEdge && (c.data.tornEdge.top || c.data.tornEdge.bottom)
      ? tornMask(c.size.width, c.size.height, c.data.tornEdge) : null;
    const wrapStyle = { borderRadius: s.borderRadius || '0px' };
    if (torn) Object.assign(wrapStyle, { maskImage: torn, webkitMaskImage: torn, maskSize: '100% 100%', webkitMaskSize: '100% 100%' });
    return el('div', { class: 'img-wrap', style: wrapStyle },
      el('img', {
        src: c.data.src, alt: c.data.alt || '', loading: 'lazy', draggable: 'false',
        style: {
          objectFit: s.objectFit || 'cover', borderRadius: s.borderRadius || '0px',
          maskImage: s.maskImage || 'none', webkitMaskImage: s.WebkitMaskImage || 'none'
        }
      }));
  };

  R.shape = c => {
    const s = c.style;
    return el('div', {
      class: 'shape', style: {
        background: s.backgroundColor,
        borderRadius: c.data.shapeType === 'circle' ? '50%' : s.borderRadius,
        opacity: s.opacity ?? 1, filter: s.filter || 'none'
      }
    });
  };

  R.button = c => {
    const d = c.data;
    const a = el('a', {
      class: 'btn-link', href: d.url, target: d.openInNewTab ? '_blank' : '_self', rel: 'noopener',
      style: {
        background: d.backgroundColor, color: d.textColor, borderRadius: d.borderRadius + 'px',
        fontSize: d.fontSize + 'px', fontWeight: d.fontWeight, fontFamily: d.fontFamily
      }
    }, d.text);
    a.insertAdjacentHTML('beforeend', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>');
    return a;
  };

  // month grid with a hand-drawn heart on the event day and a start-time bar
  R.calendar = c => {
    const d = c.data;
    const ev = (d.event_dates || [])[0] || {};
    const [y, m, day] = (ev.date || '').split('-').map(Number);
    if (!y) return null;
    const font = `${d.daysFontFamily || d.titleFontFamily}, Georgia, serif`;
    const marker = d.eventMarkerColor || '#ba4545';
    const head = el('div', { class: 'mcal-head', style: { color: d.titleColor } }, [
      el('span', { style: { fontWeight: 600 } }, MONTHS[m - 1]), el('span', { style: { fontWeight: 500 } }, String(y))
    ]);
    const week = el('div', { class: 'mcal-grid mcal-week' }, CAL_WEEKDAYS.map(w =>
      el('div', { style: { fontSize: d.weekdaysFontSize + 'px', color: d.weekdaysColor } }, w)));
    const days = el('div', { class: 'mcal-grid mcal-days' });
    const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;  // Monday first
    const total = new Date(y, m, 0).getDate();
    for (let i = 0; i < lead; i++) days.append(el('div'));
    for (let n = 1; n <= total; n++) {
      const cell = el('div', { style: { fontSize: d.daysFontSize + 'px', color: d.daysColor } });
      if (n === day) {
        const size = Math.round((d.eventMarkerSize || 40) * 1.55);
        const wrap = el('div', { class: 'mcal-heart' });
        wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" stroke="${marker}" stroke-linecap="round" stroke-linejoin="round">
          <path pathLength="1" stroke-width="3" d="M50 88 C40 80 8 62 8 35 C8 18 20 9 33 11 C42 12 47 19 50 27 C53 19 58 12 67 11 C80 9 92 18 92 35 C92 62 60 80 50 88 Z"/>
          <path pathLength="1" stroke-width="1.6" opacity=".6" d="M47 83 C30 72 13 57 13 37 C13 25 21 16 32 16"/>
          <path pathLength="1" stroke-width="1.6" opacity=".6" d="M56 80 C70 71 86 57 87 38"/></svg>`;
        cell.append(wrap, el('span', { style: { fontWeight: 600 } }, String(n)));
      } else {
        cell.append(el('span', {}, String(n)));
      }
      days.append(cell);
    }
    const bar = el('div', { class: 'mcal-bar', style: { background: marker + '14', borderLeftColor: marker } }, [
      el('div', { style: { color: d.titleColor } }, 'Башталышы'),
      el('div', { style: { color: marker } }, ev.time || '')
    ]);
    return el('div', {
      class: 'mcal', style: { fontFamily: font, background: d.backgroundColor, borderRadius: d.borderRadius + 'px', padding: (d.padding ?? 20) + 'px' }
    }, [head, week, days, ev.time ? bar : null]);
  };

  R['calendar-pro'] = c => {
    const d = c.data;
    const dt = new Date(d.event_date);
    const day = dt.getDate();
    const hh = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
    const near = off => new Date(dt.getFullYear(), dt.getMonth(), day + off).getDate();
    const num = (n, size, op) => el('div', { style: { position: 'relative' } },
      el('div', { style: { fontSize: size + 'px', opacity: op } }, String(n)));
    const heart = el('div', { style: { position: 'relative' } }, el('div', { class: 'cal-heart' }));
    heart.firstChild.innerHTML = `<svg width="90" height="90" viewBox="0 0 100 100"><path d="M50,85 C50,85 15,60 15,40 C15,25 25,15 35,15 C42,15 48,20 50,25 C52,20 58,15 65,15 C75,15 85,25 85,40 C85,60 50,85 50,85 Z" fill="none" stroke="${d.mainColor}" stroke-width="2" stroke-linejoin="round"/></svg><div>${day}</div>`;
    const wd = dt.getDay();
    const week = el('div', { class: 'cal-week' });
    const sizes = [9.5, 11, 12.5, 20, 12.5, 11, 9.5], ops = [.55, .7, .85, 1, .85, .7, .55];
    for (let i = -3; i <= 3; i++) {
      week.append(el('div', {
        class: i === 0 ? 'active' : '',
        style: { fontSize: sizes[i + 3] + 'px', opacity: ops[i + 3] }
      }, WEEKDAYS[(wd + i + 7) % 7]));
    }
    return el('div', { class: 'cal', style: { fontFamily: d.fontFamily, color: d.mainColor } }, [
      el('div', { class: 'cal-month' }, MONTHS[dt.getMonth()]),
      el('div', { class: 'cal-days' }, [num(near(-2), 32, .25), num(near(-1), 38, .4), heart, num(near(1), 38, .4), num(near(2), 32, .25)]),
      el('div', { class: 'cal-time' }, [el('span', {}, 'саат'), el('span', {}, hh)]),
      el('div', { class: 'cal-year' }, String(dt.getFullYear())),
      week
    ]);
  };

  R.timer = c => {
    const d = c.data;
    const target = new Date(d.event_date + (TZ_OFFSET[d.timezone] || '+06:00')).getTime();
    const labels = ['Күн', 'Саат', 'Мүнөт', 'Секунд'];
    const nums = labels.map(() => el('span', {
      class: 'timer-num', style: { fontFamily: d.numbersFontFamily, fontSize: d.numbersFontSize + 'px', color: d.numbersColor }
    }));
    const row = el('div', { class: 'timer-row', style: { gap: d.spacing + 'px' } }, labels.map((l, i) =>
      el('div', { class: 'timer-unit' }, [nums[i], d.showLabels ? el('div', {
        class: 'timer-lbl', style: { fontFamily: d.labelsFontFamily, fontSize: d.labelsFontSize + 'px', color: d.labelsColor }
      }, l) : null])));
    const tick = () => {
      let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
      const v = [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60];
      v.forEach((x, i) => nums[i].textContent = String(x).padStart(2, '0'));
    };
    tick(); setInterval(tick, 1000);
    return el('div', { class: 'timer', style: { background: d.backgroundColor, borderRadius: d.borderRadius + 'px' } }, [
      el('div', { class: 'timer-title', style: { fontFamily: d.titleFontFamily, fontSize: d.titleFontSize + 'px', color: d.titleColor } }, d.event_title),
      row
    ]);
  };

  R.form2 = c => {
    const d = c.data;
    let choice = d.form_buttons[0].button_value;
    const opts = d.form_buttons.map((b, i) => {
      const lab = el('label', { class: 'form2-opt' + (i === 0 ? ' checked' : '') }, [
        el('div', { class: 'form2-radio' }), el('span', {}, b.button_text)
      ]);
      lab.addEventListener('click', () => {
        choice = b.button_value;
        opts.forEach(o => o.classList.remove('checked'));
        lab.classList.add('checked');
      });
      return lab;
    });
    const submit = el('button', { class: 'form2-submit', type: 'button' }, d.submit_button_text);
    submit.addEventListener('click', () => {
      const field = d.form_fields[0];
      const input = el('input', { type: 'text', placeholder: field.placeholder, maxlength: '80' });
      const send = el('button', { class: 'primary', type: 'button' }, d.modal_button_text);
      const box = el('div', {}, [el('h3', {}, d.modal_title), input, send]);
      send.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        send.disabled = true;
        try {
          const label = d.form_buttons.find(b => b.button_value === choice).button_text;
          await api('/api/rsvp', { page: PAGE_SLUG, form_id: d.form_id, name, answer: choice, answer_text: label });
          box.replaceChildren(el('div', { class: 'modal-msg' }, 'Рахмат! Жообуңуз кабыл алынды.'));
          setTimeout(closeModal, 1800);
        } catch (e) {
          send.disabled = false;
          alert('Ката кетти, кайра аракет кылыңыз.');
        }
      });
      openModal(box);
      setTimeout(() => input.focus(), 50);
    });
    return el('div', { class: 'form2' }, [el('div', { class: 'form2-opts' }, opts), submit]);
  };

  // wishes list (carousel + "read all")
  const wishLists = [];
  R['wishes-list'] = c => {
    const d = c.data;
    const root = el('div', { class: 'wl-root', style: { fontFamily: d.font_family } });
    const ctx = { root, d, timer: null };
    wishLists.push(ctx);
    renderWishes(ctx, []);
    return root;
  };

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  }

  function wishCard(w, d) {
    const date = new Date(w.created_at).toLocaleDateString('ru-RU');
    return el('div', { class: 'wl-card', style: { background: d.card_bg_color } }, [
      el('span', { class: 'wl-quote' }, '“'),
      el('p', { class: 'wl-text', style: { color: d.title_color } }, w.text),
      el('div', { class: 'wl-footer' }, [
        el('div', { class: 'wl-avatar', style: { background: d.button_color } }, initials(w.name)),
        el('div', {}, [el('div', { class: 'wl-name', style: { color: d.title_color } }, w.name), el('div', { class: 'wl-date' }, date)])
      ])
    ]);
  }

  function renderWishes(ctx, wishes) {
    const { root, d } = ctx;
    clearInterval(ctx.timer);
    if (!wishes.length) {
      root.replaceChildren(el('div', { class: 'wl-state' }, [
        el('div', { class: 'wl-empty-icon' }, '✦'),
        el('p', { class: 'wl-state-text' }, 'Азырынча каалоолор жок')
      ]));
      return;
    }
    const cards = wishes.slice(0, 10).map(w => wishCard(w, d));
    const slider = el('div', { class: 'wl-slider' }, cards);
    const dots = cards.map((_, i) => el('button', { class: 'wl-dot', type: 'button', onclick: () => go(i) }));
    let idx = 0;
    const go = i => {
      idx = i;
      const card = cards[i];
      slider.scrollTo({ left: card.offsetLeft - slider.offsetWidth / 2 + card.offsetWidth / 2, behavior: 'smooth' });
      cards.forEach((c, j) => c.classList.toggle('active', j === i));
      dots.forEach((c, j) => c.classList.toggle('active', j === i));
    };
    const all = el('button', { class: 'wl-all', type: 'button', style: { background: d.button_color } }, d.button_text);
    all.addEventListener('click', () => {
      openModal(el('div', {}, [el('h3', {}, 'Каалоо-тилектер'),
        ...wishes.map(w => el('div', { style: { marginBottom: '14px' } }, wishCard(w, d)))]));
    });
    root.replaceChildren(slider, el('div', { class: 'wl-dots' }, dots), all);
    requestAnimationFrame(() => go(0));
    if (cards.length > 1) ctx.timer = setInterval(() => go((idx + 1) % cards.length), d.auto_scroll_interval || 3000);
  }

  async function loadWishes() {
    try {
      const wishes = await api('/api/wishes?page=' + encodeURIComponent(PAGE_SLUG));
      wishLists.forEach(ctx => renderWishes(ctx, wishes));
    } catch (e) { /* static hosting without API: keep empty state */ }
  }

  // fixed bottom buttons (portaled outside the block)
  const fixed = { audio: null, wishes: null };
  R['audio-fixed'] = c => { fixed.audio = c.data; return null; };
  R['fixed-wishes'] = c => { fixed.wishes = c.data; return null; };

  function buildFixedBar() {
    const bar = document.getElementById('fixed-bar');
    const audio = document.getElementById('bg-audio');
    if (fixed.audio) {
      const a = fixed.audio;
      audio.src = a.audio_url;
      const ico = el('span', { class: 'ico' });
      const setIcon = playing => ico.innerHTML = playing
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
      setIcon(false);
      const btn = el('button', {
        class: 'fixed-btn', type: 'button',
        style: { background: a.button_color, color: a.text_color, fontFamily: a.font_family, fontSize: a.font_size + 'px', height: a.button_height + 'px' }
      }, [ico, a.button_text]);
      btn.addEventListener('click', () => audio.paused ? audio.play().catch(() => {}) : audio.pause());
      audio.addEventListener('play', () => { setIcon(true); btn.classList.add('playing'); });
      audio.addEventListener('pause', () => { setIcon(false); btn.classList.remove('playing'); });
      bar.append(btn);
    }
    if (fixed.wishes) {
      const w = fixed.wishes;
      const btn = el('button', {
        class: 'fixed-btn wish', type: 'button',
        style: { background: w.button_color, color: w.text_color, fontFamily: w.font_family, fontSize: w.font_size + 'px', height: w.button_height + 'px', marginLeft: 'auto' }
      });
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8l-4 4V4a1 1 0 0 1 1-1zm3 4v2h10V7H7zm0 4v2h7v-2H7z"/></svg>';
      btn.append(w.button_text);
      btn.addEventListener('click', openWishForm);
      bar.append(btn);
    }
  }

  function openWishForm() {
    const name = el('input', { type: 'text', placeholder: 'Атыңыз', maxlength: '80' });
    const text = el('textarea', { placeholder: 'Каалооңузду жазыңыз...', maxlength: '1000' });
    const send = el('button', { class: 'primary', type: 'button' }, 'ЖӨНӨТҮҮ');
    const box = el('div', {}, [el('h3', {}, 'Каалоо-тилек калтыруу'), name, text, send]);
    send.addEventListener('click', async () => {
      if (!name.value.trim()) return name.focus();
      if (!text.value.trim()) return text.focus();
      send.disabled = true;
      try {
        await api('/api/wishes', { page: PAGE_SLUG, name: name.value.trim(), text: text.value.trim() });
        box.replaceChildren(el('div', { class: 'modal-msg' }, 'Рахмат! Каалооңуз жөнөтүлдү.'));
        loadWishes();
        setTimeout(closeModal, 1800);
      } catch (e) {
        send.disabled = false;
        alert('Ката кетти, кайра аракет кылыңыз.');
      }
    });
    openModal(box);
  }

  // ---------------- modal ----------------
  const modal = document.getElementById('modal');
  const modalCard = document.getElementById('modal-card');
  function openModal(content) {
    modalCard.replaceChildren(el('button', { class: 'modal-close', type: 'button', onclick: closeModal }, '×'), content);
    modal.hidden = false;
  }
  function closeModal() { modal.hidden = true; }
  modal.querySelector('[data-close]').addEventListener('click', closeModal);

  // ---------------- page build ----------------
  const INTERACTIVE = new Set(['button', 'form2', 'wishes-list']);
  DATA.blocks.forEach(b => {
    const s = b.style;
    const block = el('div', {
      class: 'sh-block', style: {
        background: s.backgroundColor, height: s.height, minHeight: s.minHeight,
        backgroundImage: s.backgroundImage ? `url("${s.backgroundImage}")` : '',
        backgroundSize: s.backgroundSize || '', backgroundPosition: s.backgroundPosition || '',
        backgroundRepeat: s.backgroundRepeat || '', backgroundAttachment: s.backgroundAttachment || ''
      }
    });
    b.components.forEach(c => {
      const render = R[c.type];
      if (!render) return;
      const inner = render(c);
      if (!inner) return;
      const rot = (c.style.transform || '').match(/rotate\([^)]*\)/);
      const blurOrShadow = (c.style.filter || '').includes('blur');
      const z = c.type === 'form2' ? 9999 : c.type === 'button' ? 9998 : c.position.z;
      const node = el('div', {
        class: 'sh-component' + (blurOrShadow ? ' visible-overflow' : '') + (INTERACTIVE.has(c.type) ? ' interactive' : ''),
        'data-type': c.type,
        'data-id': c.id,
        style: {
          left: c.position.x + '%', top: c.position.y + '%', zIndex: z,
          width: c.size.width + 'px', height: c.size.height === 'auto' ? 'auto' : c.size.height + 'px',
          transform: 'translate(-50%, -50%)' + (rot ? ' ' + rot[0] : '')
        }
      }, el('div', { class: 'sh-component__content' }, wrapAnim(inner, c.data.__animation)));
      block.append(node);
    });
    page.append(block);
  });

  // run entrance animations when elements scroll into view
  let started = false;
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting && started) { e.target.classList.add('run'); io.unobserve(e.target); }
    });
  }, { threshold: 0.05 });
  function startAnimations() {
    started = true;
    animated.forEach(a => { io.unobserve(a); io.observe(a); });
  }

  buildFixedBar();
  loadWishes();

  // ---------------- envelope ----------------
  const env = document.getElementById('envelope');
  const E = DATA.envelope || {};
  [['env-invitation', E.invitation], ['env-title', E.title], ['env-bottom', E.bottomText], ['env-button', E.button]]
    .forEach(([id, text]) => { if (text) document.getElementById(id).textContent = text; });
  if (DATA.title) document.title = DATA.title;
  if (PREVIEW) {
    // no envelope, no autoplay, no entrance animations: show the page as it ends up
    env.classList.add('gone');
    document.body.classList.add('preview');
    document.getElementById('fixed-bar').classList.add('show');
    window.__previewFocus = id => {
      const node = document.querySelector(`[data-id="${id}"]`);
      if (!node) return;
      const r = node.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + r.top + r.height / 2 - window.innerHeight / 2, behavior: 'smooth' });
      node.classList.remove('preview-flash');
      void node.offsetWidth;
      node.classList.add('preview-flash');
    };
    return;
  }
  if (!DATA.envelope) {
    env.classList.add('gone');
    document.getElementById('fixed-bar').classList.add('show');
    startAnimations();
    return;
  }
  document.body.classList.add('locked');
  document.getElementById('envelope-btn').addEventListener('click', () => {
    if (env.classList.contains('open')) return;
    env.classList.add('open');
    const audio = document.getElementById('bg-audio');
    if (audio.src) audio.play().catch(() => {});
    document.body.classList.remove('locked');
    document.getElementById('fixed-bar').classList.add('show');
    startAnimations();
    setTimeout(() => env.classList.add('gone'), 5000);
  });
})();
