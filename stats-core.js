/* Book Catalog — the numbers behind the Stats screen. Pure functions, no page access. */
(function (root) {
  'use strict';
  const STATUS_ORDER = ['Read', 'TBR', 'Reading', 'DNF'];

  const yearOf = s => { const m = String(s || '').match(/^(\d{4})/); return m ? +m[1] : null; };
  const decadeKey = y => {
    y = Number(y);
    if (!y || y < 1000) return null;
    return y < 1950 ? 'Before 1950' : (Math.floor(y / 10) * 10) + 's';
  };
  function tally(list, keyFn) {
    const m = new Map();
    list.forEach(b => { const k = keyFn(b); if (k === null || k === undefined || k === '') return; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
  }
  function topWithOther(items, n) {
    if (items.length <= n + 1) return items;
    const head = items.slice(0, n), rest = items.slice(n);
    return head.concat({ key: '__other', label: `Other (${rest.length})`, value: rest.reduce((s, x) => s + x.value, 0), keys: rest.map(x => x.key) });
  }

  const normT = s => String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // "Orgulho e Preconceito (Pride and Prejudice)" -> "Pride and Prejudice": the original title names the work.
  const workTitle = t => { t = String(t || ''); const m = t.match(/\(([^)]+)\)\s*$/); return (m ? m[1] : t).trim(); };
  const workKey = b => normT(workTitle(b.title)) + '|' + normT(b.author) + '|' + String(b.seriesNo === null || b.seriesNo === undefined ? '' : b.seriesNo).trim();

  // Copy groups the person already linked (same "workId"), largest first.
  function copyGroups(books) {
    const m = new Map();
    books.forEach(b => { if (!b.workId) return; const g = m.get(b.workId) || []; g.push(b); m.set(b.workId, g); });
    return [...m.entries()].filter(([, g]) => g.length > 1).map(([key, g]) => {
      g.sort((a, b) => a.id - b.id);
      return { key, label: workTitle(g[0].title), value: g.length, books: g };
    }).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }

  // Books that look like copies of the same book (same original title, author and volume) but aren't linked yet.
  function suggestCopies(books) {
    const m = new Map();
    books.forEach(b => { if (!b.title) return; const k = workKey(b); const g = m.get(k) || []; g.push(b); m.set(k, g); });
    return [...m.values()].filter(g => g.length > 1 && !(g[0].workId && g.every(b => b.workId === g[0].workId)))
      .map(g => g.sort((a, b) => a.id - b.id)).sort((a, b) => b.length - a.length || a[0].id - b[0].id);
  }

  // Gaps in numbered series you own (e.g. you have #1, #2, #4 → #3 is missing). Only up to your highest volume.
  function missingVolumes(books) {
    const m = new Map();
    books.forEach(b => {
      if (!b.series) return;
      // "1, 2, 3" (an omnibus) counts as owning each of those volumes
      const nums = String(b.seriesNo === null || b.seriesNo === undefined ? '' : b.seriesNo).split(/[,;&]/).map(x => parseInt(x, 10)).filter(n => n > 0 && n < 1000);
      if (!nums.length) return;
      const k = normT(b.series); const g = m.get(k) || { series: b.series, author: b.author, owned: new Set(), wish: new Set(), books: [] };
      nums.forEach(n => (b.status === 'Wishlist' ? g.wish : g.owned).add(n)); g.books.push(b); m.set(k, g);
    });
    return [...m.values()].map(g => {
      const max = Math.max(0, ...g.owned);
      const missing = [];
      for (let i = 1; i < max; i++) if (!g.owned.has(i)) missing.push({ n: i, wish: g.wish.has(i) });
      return { series: g.series, author: g.author, have: g.owned.size, max, missing, books: g.books.sort((a, b) => (parseInt(a.seriesNo, 10) || 0) - (parseInt(b.seriesNo, 10) || 0)) };
    }).filter(g => g.missing.length).sort((a, b) => b.missing.length - a.missing.length || a.series.localeCompare(b.series));
  }

  function compute(books, opts = {}) {
    const nowYear = opts.nowYear || new Date().getFullYear();
    const total = books.length;
    const status = STATUS_ORDER.map(key => ({ key, value: books.filter(b => b.status === key).length }));
    const rated = books.filter(b => +b.rating > 0);
    const avgRating = rated.length ? rated.reduce((s, b) => s + (+b.rating), 0) / rated.length : 0;

    // Books read per year: the last 8 years shown one by one (empty years included), older ones grouped.
    const read = books.filter(b => b.status === 'Read');
    const yrs = read.map(b => yearOf(b.dateRead)).filter(Boolean);
    const lastYear = Math.max(nowYear, ...yrs);
    const firstShown = lastYear - 7;
    const perYear = [];
    const earlier = yrs.filter(y => y < firstShown).length;
    if (earlier) perYear.push({ key: 'earlier', label: `<${firstShown}`, value: earlier });
    for (let y = firstShown; y <= lastYear; y++) perYear.push({ key: y, label: String(y), value: yrs.filter(v => v === y).length });
    const undatedRead = read.length - yrs.length;

    const ratings = [5, 4, 3, 2, 1].map(n => ({ key: n, label: '★'.repeat(n), value: books.filter(b => +b.rating === n).length }));

    // Series you own at least 3 books of: how far through each you are.
    const seriesMap = new Map();
    books.forEach(b => { if (!b.series) return; const s = seriesMap.get(b.series) || { key: b.series, owned: 0, read: 0 }; s.owned++; if (b.status === 'Read') s.read++; seriesMap.set(b.series, s); });
    const series = [...seriesMap.values()].filter(s => s.owned >= 3)
      .sort((a, b) => b.owned - a.owned || a.key.localeCompare(b.key)).slice(0, 8);

    const decadeOrder = ['Before 1950', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
    const decTally = new Map(tally(books, b => decadeKey(b.firstYear)).map(x => [x.key, x.value]));
    const decades = decadeOrder.filter(k => decTally.has(k) || k >= '1950s').map(k => ({ key: k, label: k === 'Before 1950' ? '<1950' : "'" + k.slice(2), value: decTally.get(k) || 0 }));

    return {
      total, status, avgRating, ratedCount: rated.length,
      readPct: total ? Math.round(100 * status[0].value / total) : 0,
      perYear, undatedRead, ratings,
      genres: topWithOther(tally(books, b => b.genre), 7),
      authors: tally(books, b => b.author).slice(0, 8),
      publishers: tally(books, b => b.publisher).slice(0, 6),
      languages: tally(books, b => b.language),
      covers: tally(books, b => b.cover),
      series, decades,
      upNext: books.filter(b => b.status === 'TBR' && b.priority === 'High').sort((a, b) => a.id - b.id),
      awards: books.filter(b => b.awards).length,
      locations: tally(books, b => b.location).slice(0, 8),
      noLocation: books.filter(b => !b.location).length,
      withPhoto: books.filter(b => b.hasPhoto).length,
      missing: missingVolumes(books),
      copies: (() => { const g = copyGroups(books); return { top: g.slice(0, 5), groups: g.length, extra: g.reduce((s, x) => s + x.value - 1, 0) }; })()
    };
  }

  root.BCStats = { compute, yearOf, decadeKey, STATUS_ORDER, workTitle, workKey, copyGroups, suggestCopies, missingVolumes, normT };
})(typeof window !== 'undefined' ? window : globalThis);
