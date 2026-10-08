/* Preserve a logical control only across a render of its existing view. */
(function (root) {
  'use strict';
  const document = root.document;
  let navigation = 0;
  // Removing focused DOM sends focus to body without a focusin event. Real
  // navigation invalidates any target waiting for a pending save to finish.
  document?.addEventListener('focusin', () => { navigation++; }, true);
  document?.addEventListener('pointerdown', () => { navigation++; }, true);
  document?.addEventListener('keydown', event => {
    if (event.key === 'Tab' || event.key === 'Escape') navigation++;
  }, true);
  const stableData = ['do', 'id', 'delta', 'unit', 'sound', 'seconds', 'category', 'entry'];
  function identity(element) {
    if (element.id) return candidate => candidate.id === element.id;
    if (element.dataset.do) {
      const values = stableData.map(key => [key, element.dataset[key]]);
      return candidate => candidate.tagName === element.tagName && values.every(([key, value]) => candidate.dataset[key] === value);
    }
    const formId = element.closest('form')?.id;
    if (formId && (element.name || element.type === 'submit')) {
      const name = element.name, type = element.type, tag = element.tagName;
      return candidate => candidate.tagName === tag && candidate.name === name && candidate.type === type && candidate.closest('form')?.id === formId;
    }
    return null;
  }
  function create() {
    let saved = null;
    function capture(container, selector, fallback = null) {
      const active = document.activeElement;
      if (!container?.isConnected) { saved = null; return null; }
      if (container.contains(active) && (!selector || active.matches(selector))) {
        const matches = identity(active);
        saved = matches ? { container, matches, fallback, navigation, start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
      } else if (saved?.container !== container || saved.navigation !== navigation) saved = null;
      return saved;
    }
    function restore(token, { pending = false, preventScroll = true } = {}) {
      if (!token || token !== saved) return;
      if (!token.container.isConnected || token.navigation !== navigation || token.container.closest('[inert]')) { saved = null; return; }
      const matches = [...token.container.querySelectorAll('button,input,select,textarea,a[href],[tabindex],summary')].filter(token.matches);
      const usable = target => {
        const closed = target?.closest('details:not([open])');
        return target && !target.disabled && !target.closest('[hidden],[inert]') && target.getClientRects().length && (!closed || closed.querySelector(':scope > summary')?.contains(target));
      };
      let target = matches.length === 1 ? matches[0] : null;
      // Some actions intentionally close their own details menu. Its visible
      // summary is then the logical return point, subject to the same guard.
      if (!usable(target) && token.fallback) {
        const alternatives = token.container.querySelectorAll(token.fallback);
        if (alternatives.length === 1) { target = alternatives[0]; preventScroll = false; }
      }
      if (!usable(target)) {
        if (!pending) saved = null;
        return;
      }
      saved = null;
      target.focus({ preventScroll });
      if (token.start != null && target.setSelectionRange) {
        try { target.setSelectionRange(token.start, token.end, token.direction); } catch { /* Numeric inputs have no text selection. */ }
      }
    }
    return Object.freeze({ capture, restore, clear: () => { saved = null; } });
  }
  root.RenderFocus = Object.freeze({ create });
})(globalThis);
