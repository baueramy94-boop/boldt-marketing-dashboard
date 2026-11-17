/* Title Case for chart and report section titles (h1 to h4) on the dashboards and tracker, including ones drawn later.
   Only lowercase-first words change, so names like LinkedIn, MQL or a company name stay as written.
   Skipped: blog article text, review page article, ad campaign names, editable fields, story and research item titles. */
(function () {
  var SMALL = new Set("a an the and but or nor for so yet as at by in of on per to vs vs. via with from into than".split(" "));
  var SKIP = ".blog-art,.art,.camp,[contenteditable],.rnd-story,.rnd-item,.qa-i,.no-tc";
  var INNER_SKIP = "button,select,input,textarea,.badge,.chip,.note,.sm,.no-tc";
  function word(w, first) {
    return w.split("-").map(function (part, i) {
      var m = part.match(/^([^A-Za-z]*)([a-z])(.*)$/);
      if (!m) return part;                                   // starts with a capital, a digit or punctuation: leave it
      if (!(first && i === 0) && SMALL.has((m[2] + m[3]).toLowerCase().replace(/[^a-z.]/g, ""))) return part;
      return m[1] + m[2].toUpperCase() + m[3];
    }).join("-");
  }
  function fix(el) {
    if (el.closest(SKIP)) return;
    var first = true;
    (function walk(n) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) {
          var parts = c.textContent.split(/(\s+)/), out = parts.map(function (t) {
            if (!t || /^\s+$/.test(t)) return t;
            var r = word(t, first); first = /[:(]$/.test(t) || /^[·|\/]$/.test(t); return r;
          }).join("");
          if (out !== c.textContent) c.textContent = out;
        } else if (c.nodeType === 1 && !c.matches(INNER_SKIP)) walk(c);
      });
    })(el);
  }
  function run() { document.querySelectorAll("h1,h2,h3,h4").forEach(fix); }
  var queued = false;
  function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; run(); }); }
  run();
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
})();
