// Reports sideways scrolling, elements sticking out of their parent, overlapping text, and text with too little contrast
// against what is actually behind it. Usage: swift tools/layout-check.swift PAGE.html WIDTH [light|dark]
import WebKit
import AppKit
let W = Double(CommandLine.arguments[2]) ?? 800
let js = """
(() => { const out = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth);
  for (const el of document.querySelectorAll('body *')) {
    if (el.ownerSVGElement) continue; // inside a drawing: the <svg> box itself is checked, its viewport clips the rest
    const cs = getComputedStyle(el); if (cs.display === 'none') continue;
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && el.clientWidth) out.push('clipped: ' + el.tagName + '.' + el.className + ' ' + el.scrollWidth + '>' + el.clientWidth);
    const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
    if (r.width && (r.right > p.right + 1 || r.left < p.left - 1) && getComputedStyle(el.parentElement).overflow === 'visible') out.push('sticks out: ' + el.tagName + '.' + el.className + ' "' + (el.textContent||'').trim().slice(0,40) + '" by ' + Math.round(Math.max(r.right - p.right, p.left - r.left)) + 'px');
  }
  // text overlapping other text (siblings drawn on top of each other)
  // Decorative elements (aria-hidden) may sit behind content on purpose; only real text is compared.
  const leaves = [...document.querySelectorAll('h1,h2,h3,p,td,span,i,b,div.msg,div.loc,div.fix,div.rule')].filter(e => !e.closest('[aria-hidden="true"]') && !e.ownerSVGElement).map(e => [e, e.getBoundingClientRect()]).filter(([e,r]) => r.width && r.height);
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const [a, ra] = leaves[i], [b, rb] = leaves[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 2 && oy > 2) out.push('overlap: ' + a.tagName + '.' + a.className + ' "' + a.textContent.trim().slice(0,30) + '" x ' + b.tagName + '.' + b.className + ' "' + b.textContent.trim().slice(0,30) + '"');
  }
  // Grid rows: items side by side in a grid should line up (same top, same height).
  for (const g of document.querySelectorAll('body *')) {
    if (getComputedStyle(g).display !== 'grid') continue;
    const rows = {};
    for (const c of g.children) { const r = c.getBoundingClientRect(); if (r.height) (rows[Math.round(r.top)] = rows[Math.round(r.top)] || []).push(Math.round(r.height)); }
    for (const hs of Object.values(rows)) if (Math.max(...hs) - Math.min(...hs) > 1) out.push('uneven grid row: ' + g.className + ' heights ' + hs.join('/'));
  }
  // Contrast: each element with its own text vs the first opaque background up the tree (WCAG, 3:1 floor).
  const rgb = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r,g,b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b); };
  for (const el of document.querySelectorAll('body *')) {
    if (el.ownerSVGElement || el.closest('[data-specimen]')) continue; // specimens show a failing colour pair on purpose
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    let bg = null, e = el;
    while (e) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && (c.length < 4 || c[3] > 0.9)) { bg = c; break; } e = e.parentElement; }
    bg = bg || [255,255,255]; const fg = rgb(getComputedStyle(el).color);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a,b) => b - a); const ratio = (hi + .05) / (lo + .05);
    if (ratio < 3) out.push('low contrast ' + ratio.toFixed(2) + ': ' + el.tagName + '.' + el.className + ' "' + el.textContent.trim().slice(0,30) + '"');
  }
  return [...new Set(out)].slice(0, 40).join('\\n') || 'clean';
})()
"""
class D: NSObject, WKNavigationDelegate {
  let w = WKWebView(frame: NSRect(x: 0, y: 0, width: W, height: 900))
  func run() { if CommandLine.arguments.count > 3 { w.appearance = NSAppearance(named: CommandLine.arguments[3] == "dark" ? .darkAqua : .aqua) }
    w.navigationDelegate = self; w.loadFileURL(URL(fileURLWithPath: CommandLine.arguments[1]), allowingReadAccessTo: URL(fileURLWithPath: "/")) }
  func webView(_ v: WKWebView, didFinish n: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + (CommandLine.arguments.count > 4 ? 3 : 0.4)) { v.evaluateJavaScript(js) { r, e in print(r ?? e ?? "?"); exit(0) } } }
}
let app = NSApplication.shared; let d = D(); d.run(); app.run()
