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
      awards: books.filter(b => b.awards).length
    };
  }

  root.BCStats = { compute, yearOf, decadeKey, STATUS_ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
