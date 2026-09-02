/* Served in place of the real jsPDF CDN script (see tests/fixtures/helpers.js
   -> mockJsPDF, which intercepts that exact request via page.route()), same
   pattern as fake-supabase.js. A minimal stand-in for the handful of jsPDF
   instance methods js/report.js actually calls - not a PDF renderer. Records
   every .text() call (across every page created via .addPage()) so tests can
   assert real report content without needing to parse an actual PDF binary,
   and records the .save() filename. */
(function () {
  function makeDoc() {
    const state = { pages: [[]], currentPage: 0, savedAs: null };
    const currentLines = () => state.pages[state.currentPage];

    const doc = {
      setFont() { return doc; },
      setFontSize() { return doc; },
      setTextColor() { return doc; },
      setDrawColor() { return doc; },
      setFillColor() { return doc; },
      setLineWidth() { return doc; },
      text(strOrArr) {
        const arr = Array.isArray(strOrArr) ? strOrArr : [strOrArr];
        arr.forEach((s) => currentLines().push(String(s)));
        return doc;
      },
      rect() { return doc; },
      line() { return doc; },
      // Rough mm-width -> character-count heuristic, good enough to
      // exercise multi-line wrapping/pagination logic in tests without
      // needing real font-metrics.
      splitTextToSize(text, maxWidth) {
        const str = String(text);
        if (!str) return [''];
        const perLine = Math.max(10, Math.floor(maxWidth / 1.8));
        const words = str.split(' ');
        const lines = [];
        let cur = '';
        words.forEach((w) => {
          if ((cur + ' ' + w).trim().length > perLine) {
            if (cur) lines.push(cur.trim());
            cur = w;
          } else {
            cur = (cur + ' ' + w).trim();
          }
        });
        if (cur) lines.push(cur);
        return lines.length ? lines : [''];
      },
      addPage() {
        state.pages.push([]);
        state.currentPage = state.pages.length - 1;
        return doc;
      },
      setPage(n) {
        state.currentPage = n - 1;
        return doc;
      },
      internal: {
        getNumberOfPages: () => state.pages.length,
        pageSize: { getWidth: () => 210, getHeight: () => 297 },
      },
      save(filename) {
        state.savedAs = filename;
        window.__lastPdf = {
          text: state.pages.flat(),
          pages: state.pages.map((p) => p.slice()),
          pageCount: state.pages.length,
          savedAs: filename,
        };
      },
    };
    return doc;
  }

  window.jspdf = { jsPDF: function (_opts) { return makeDoc(); } };
})();
