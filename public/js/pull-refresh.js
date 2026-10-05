/* ---------- Pull-to-refresh ---------- */
/* Mobile gesture: drag down from the top of the page to refresh. Include this
   script on any page. Pages can override the action by assigning
   window.__pullRefresh (e.g. re-sync data without a full reload); the default
   is a plain location.reload(). Desktop is unaffected (no touch events). */
(function () {
  'use strict';

  var THRESHOLD = 70;   /* px of downward drag needed to trigger refresh */
  var MAX = 110;        /* how far the indicator can travel */

  var startY = 0;
  var active = false;   /* touch started while at the top of the page */
  var pulling = false;  /* actually dragging down past the top */

  /* Keep the browser's own pull-to-refresh out of the way so only ours runs. */
  try { document.documentElement.style.overscrollBehaviorY = 'contain'; } catch (e) {}

  /* Small spinner indicator, centered at the top edge. */
  var el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:fixed', 'top:12px', 'left:50%', 'margin-left:-20px',
    'width:40px', 'height:40px', 'border-radius:50%',
    'background:rgba(10,15,31,.85)', 'border:1px solid rgba(139,92,246,.4)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'z-index:99999', 'opacity:0', 'transform:translateY(-70px)',
    'transition:transform .15s ease, opacity .15s ease',
    'pointer-events:none'
  ].join(';');
  var sp = document.createElement('div');
  sp.style.cssText = 'width:14px;height:14px;border-radius:50%;border:2px solid rgba(139,92,246,.25);border-top-color:#8b5cf6;';
  el.appendChild(sp);

  function spin(on) {
    try { sp.style.animation = on ? 'nb-spin .7s linear infinite' : ''; } catch (e) {}
  }
  function setPull(d) {
    el.style.opacity = d > 6 ? String(Math.min(1, d / THRESHOLD)) : '0';
    el.style.transform = 'translateY(' + (Math.min(d, MAX) - 70) + 'px)';
    spin(d > THRESHOLD);
  }
  function runRefresh() {
    spin(true);
    el.style.opacity = '1';
    el.style.transform = 'translateY(0px)';
    /* Give the spinner a beat so the gesture reads as intentional. */
    setTimeout(function () {
      el.style.opacity = '0';
      try {
        if (window.__pullRefresh) window.__pullRefresh();
        else location.reload();
      } catch (e) {}
    }, 280);
  }
  function reset() {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-70px)';
    spin(false);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(el);
    var css = document.createElement('style');
    css.textContent = '@keyframes nb-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(css);
  });

  document.addEventListener('touchstart', function (e) {
    if (window.scrollY <= 0) { active = true; startY = e.touches[0].clientY; }
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!active) return;
    var dy = e.touches[0].clientY - startY;
    if (dy <= 0) { pulling = false; reset(); return; }
    pulling = true;
    if (e.cancelable) e.preventDefault();   /* suppress native pull-to-refresh */
    setPull(dy);
  }, { passive: false });

  function finish(e) {
    if (!active) return;
    active = false;
    if (!pulling) return;
    pulling = false;
    var dy = (e && e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY - startY : 0;
    if (dy > THRESHOLD) runRefresh();
    else reset();
  }
  document.addEventListener('touchend', finish);
  document.addEventListener('touchcancel', finish);
})();
