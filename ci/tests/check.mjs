export const CHECK = () => { window.__chk = () => {
  const e = []; const vw = innerWidth;
  if (document.documentElement.scrollWidth > vw + 1) e.push('гориз. прокрутка');
  // видимые элементы не вылезают за край экрана (кроме соседних дней ленты и горизонтальных прокруток)
  const skip = (el) => el.closest('[data-pager] .page:not(.cur), .hscroll, .seg3, .days, .iconpick, [style*="overflow-x"], .pill, .days-on, .toast, .ibar, .edgeshade, .ptr, video, .vframe') ;
  const bad = [];
  for (const el of document.querySelectorAll('#app *')) {
    if (el.children.length > 0 && !el.matches('button, a, .nm, .sub, h1, h2, h3, p, span, li')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if ((r.right > vw + 1 || r.left < -1) && !skip(el)) bad.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '…' + Math.round(r.right));
  }
  if (bad.length) e.push('за краем экрана: ' + bad.slice(0, 3).join('; '));
  // текст, который обрезан без многоточия
  const clipped = [];
  for (const el of document.querySelectorAll('#app .nm, #app .sub, #app h1, #app h2, #app h3, #app button, #app p')) {
    const cs = getComputedStyle(el); if (cs.display === 'none') continue;
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis' && !el.closest('[data-pager] .page:not(.cur), .seg3, .days')) clipped.push((el.className || el.tagName) + ': ' + el.textContent.trim().slice(0, 30));
  }
  if (clipped.length) e.push('обрезан текст: ' + clipped.slice(0, 3).join('; '));
  if (document.getElementById('app').style.transform) e.push('экран сдвинут');
  return e;
}; };
