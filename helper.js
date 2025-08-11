(() => {
  if (window.__domPickerActive) { console.warn('DOM Picker уже активен'); return; }
  window.__domPickerActive = true;

  // ==== УТИЛИТА ДЛЯ ПЕРЕТАСКИВАНИЯ (всегда целиком во вьюпорте) ====
/**
 * Делает элемент перетаскиваемым с прилипаниями к краям и гарантией полной видимости.
 *
 * @param {HTMLElement} targetEl
 * @param {HTMLElement} handleEl
 * @param {Object} options
 * @param {boolean} [options.keepFixed=true]
 * @param {'both'|'x'|'y'} [options.axis='both']
 * @param {boolean} [options.snapOnDrop=true]
 * @param {number}  [options.snapThreshold=24]
 * @param {number}  [options.minLeft=0]
 * @param {number}  [options.minTop=0]
 * @param {number}  [options.minRight=0]
 * @param {number}  [options.minBottom=0]
 * @param {Function} [options.onDragStart]
 * @param {Function} [options.onDrag]
 * @param {Function} [options.onDragEnd]
 */
function makeDraggable(targetEl, handleEl, options = {}) {
  if (!targetEl) return;
  handleEl = handleEl || targetEl;

  const opts = {
    keepFixed: true,
    axis: 'both',
    snapOnDrop: true,
    snapThreshold: 5,
    minLeft: 0, minTop: 0, minRight: 0, minBottom: 0,
    onDragStart: null, onDrag: null, onDragEnd: null,
    ...options
  };

  // --- состояние драга
  let dragging = false;
  let startX = 0, startY = 0;        // координаты указателя при старте
  let baseLeft = 0, baseTop = 0;     // абсолютная позиция ЭЛЕМЕНТА при старте (origin для дельты)
  let lastAbsLeft = 0, lastAbsTop = 0; // последние рассчитанные абсолютные координаты
  let rAF = null;

  const setupPositioning = () => {
    const cs = getComputedStyle(targetEl);
    const pos = cs.position;
    const rect = targetEl.getBoundingClientRect();

    if (opts.keepFixed) {
      if (pos !== 'fixed') {
        targetEl.style.position = 'fixed';
        targetEl.style.left = rect.left + 'px';
        targetEl.style.top  = rect.top + 'px';
        targetEl.style.right = 'auto';
        targetEl.style.bottom = 'auto';
      } else {
        if (cs.left === 'auto' || cs.top === 'auto') {
          targetEl.style.left = rect.left + 'px';
          targetEl.style.top  = rect.top + 'px';
          targetEl.style.right = 'auto';
          targetEl.style.bottom = 'auto';
        }
      }
    } else {
      if (pos !== 'absolute' && pos !== 'fixed') {
        targetEl.style.position = 'absolute';
      }
      if (cs.left === 'auto' || cs.top === 'auto') {
        targetEl.style.left = rect.left + (window.scrollX || 0) + 'px';
        targetEl.style.top  = rect.top  + (window.scrollY || 0) + 'px';
        targetEl.style.right = 'auto';
        targetEl.style.bottom = 'auto';
      }
    }
  };

  const viewportWH = () => ({
    vw: Math.max(0, window.innerWidth || 0),
    vh: Math.max(0, window.innerHeight || 0),
  });

  const elementWH = () => ({
    w: Math.max(0, targetEl.offsetWidth || 0),
    h: Math.max(0, targetEl.offsetHeight || 0),
  });

  // Абсолютные координаты зажимаем в видимую область
  const clampFullyVisible = (left, top) => {
    const { vw, vh } = viewportWH();
    const { w, h } = elementWH();
    const minLeft = opts.minLeft;
    const minTop  = opts.minTop;
    const maxLeft = Math.max(minLeft, vw - w - opts.minRight);
    const maxTop  = Math.max(minTop,  vh - h - opts.minBottom);

    let L = Math.min(Math.max(left, minLeft), maxLeft);
    let T = Math.min(Math.max(top,  minTop ), maxTop);

    return { left: L, top: T, vw, vh, w, h };
  };

  // Притяжение к ближайшему краю (по абсолютным координатам)
  const applyEdgeSnap = (left, top) => {
    const { vw, vh, w, h } = clampFullyVisible(left, top);

    const dLeft   = left;
    const dRight  = vw - (left + w);
    const dTop    = top;
    const dBottom = vh - (top + h);

    const minD = Math.min(dLeft, dRight, dTop, dBottom);
    if (minD > opts.snapThreshold) return { left, top };

    if (dLeft === minD)       left = 0 + opts.minLeft;
    else if (dRight === minD) left = vw - w - opts.minRight;
    else if (dTop === minD)   top  = 0 + opts.minTop;
    else                      top  = vh - h - opts.minBottom;

    const safe = clampFullyVisible(left, top);
    return { left: safe.left, top: safe.top };
  };

  // Рендерим ДЕЛЬТУ от точки старта (исправление «улёта»)
  const renderDelta = (absLeft, absTop) => {
    lastAbsLeft = absLeft;
    lastAbsTop  = absTop;
    const dx = Math.round(absLeft - baseLeft);
    const dy = Math.round(absTop  - baseTop);
    targetEl.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  };

  const commitPosition = (absLeft, absTop) => {
    targetEl.style.transform = 'none';
    targetEl.style.left = Math.round(absLeft) + 'px';
    targetEl.style.top  = Math.round(absTop)  + 'px';
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    dragging = true;

    setupPositioning();

    // отключаем анимации на время драга
    targetEl.__prevTransition = targetEl.style.transition;
    targetEl.style.transition = 'none';
    targetEl.style.willChange = 'transform';
    handleEl.style.cursor = 'grabbing';
    document.body.classList.add('__dragging');

    // стартовые значения
    const curLeft = parseFloat(getComputedStyle(targetEl).left) || 0;
    const curTop  = parseFloat(getComputedStyle(targetEl).top)  || 0;

    // сразу нормализуем старт внутрь вьюпорта (без видимого рывка)
    const safe = clampFullyVisible(curLeft, curTop);
    commitPosition(safe.left, safe.top);

    // база для дельт
    baseLeft = safe.left;
    baseTop  = safe.top;

    // координаты указателя
    startX = e.clientX;
    startY = e.clientY;

    try { handleEl.setPointerCapture?.(e.pointerId); } catch {}
    e.preventDefault();
    opts.onDragStart && opts.onDragStart(e);

    // первый кадр — нулевая дельта
    renderDelta(baseLeft, baseTop);

    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;

    // дельты курсора
    let dx = e.clientX - startX;
    let dy = e.clientY - startY;
    if (opts.axis === 'x') dy = 0;
    if (opts.axis === 'y') dx = 0;

    // абсолютная цель
    let nextLeft = baseLeft + dx;
    let nextTop  = baseTop  + dy;

    // зажимаем в видимую область по абсолютным координатам
    const safe = clampFullyVisible(nextLeft, nextTop);
    nextLeft = safe.left;
    nextTop  = safe.top;

    // рендерим дельту (без «двойного смещения»)
    if (!rAF) {
      rAF = requestAnimationFrame(() => {
        rAF = null;
        renderDelta(nextLeft, nextTop);
        opts.onDrag && opts.onDrag(e, { left: nextLeft, top: nextTop });
      });
    }
  };

  const onPointerUp = (e) => {
    if (!dragging) return;
    dragging = false;

    if (rAF) { cancelAnimationFrame(rAF); rAF = null; }

    // последние абсолютные координаты с учётом клампа
    let finalLeft = lastAbsLeft;
    let finalTop  = lastAbsTop;

    // прилипание к краям при отпускании
    if (opts.snapOnDrop) {
      const snapped = applyEdgeSnap(finalLeft, finalTop);
      finalLeft = snapped.left;
      finalTop  = snapped.top;
    }

    // коммит и финальный спасательный кламп
    commitPosition(finalLeft, finalTop);
    requestAnimationFrame(() => {
      const cssLeft = parseFloat(getComputedStyle(targetEl).left) || 0;
      const cssTop  = parseFloat(getComputedStyle(targetEl).top)  || 0;
      const safe = clampFullyVisible(cssLeft, cssTop);
      if (safe.left !== cssLeft || safe.top !== cssTop) {
        commitPosition(safe.left, safe.top);
      }
    });

    // откатываем стили
    targetEl.style.willChange = '';
    targetEl.style.transition = targetEl.__prevTransition || '';
    delete targetEl.__prevTransition;
    handleEl.style.cursor = 'grab';
    document.body.classList.remove('__dragging');

    opts.onDragEnd && opts.onDragEnd(e, { left: finalLeft, top: finalTop });

    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    try { handleEl.releasePointerCapture?.(e.pointerId); } catch {}
  };

  const onResize = () => {
    const curLeft = parseFloat(getComputedStyle(targetEl).left) || 0;
    const curTop  = parseFloat(getComputedStyle(targetEl).top)  || 0;
    const safe = clampFullyVisible(curLeft, curTop);
    commitPosition(safe.left, safe.top);
  };

  // инициализация
  setupPositioning();
  handleEl.style.touchAction = 'none';
  handleEl.style.cursor = 'grab';

  handleEl.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('resize', onResize, { passive: true });

  return {
    destroy() {
      handleEl.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onResize, { passive: true });
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      document.body.classList.remove('__dragging');
      if (rAF) { cancelAnimationFrame(rAF); rAF = null; }
    }
  };
}


  // Очистка "хвостов" от предыдущего запуска
  document.querySelectorAll('.__dompick-modal, .__dompick-overlay').forEach(n => n.remove());
  document.querySelectorAll('.__dompick-highlight').forEach(el => el.classList.remove('__dompick-highlight'));
  document.body.classList.remove('__dompick-theme-js','__dompick-theme-cypress','__dompick-theme-transition');

  // ==== Стили ====
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    /* CSS переменные для тем */
    :root {
      --dompick-bg-primary: #111827;
      --dompick-bg-secondary: #1f2937;
      --dompick-bg-tertiary: #0f172a;
      --dompick-bg-dialog: #0b1020;
      --dompick-text-primary: #e5e7eb;
      --dompick-text-secondary: #9ca3af;
      --dompick-border-primary: #374151;
      --dompick-border-secondary: #4b5563;
      --dompick-border-dialog: #334155;
      --dompick-accent-primary: #ff0066;
      --dompick-accent-secondary: #059669;
      --dompick-accent-tertiary: #10b981;
      --dompick-shadow: rgba(0,0,0,.35);
      --dompick-shadow-dialog: rgba(0,0,0,.5);
      --dompick-backdrop: rgba(0,0,0,.45);
      --dompick-success: #16a34a;
      --dompick-transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      /* Z-index переменные для правильного порядка слоев */
      --dompick-z-overlay: 2147483645;
      --dompick-z-modal: 2147483646;
      --dompick-z-top: 2147483647;
    }

         /* Тема для JS режима */
     .__dompick-theme-js {
       --dompick-bg-primary: #1a1a2e;
       --dompick-bg-secondary: #16213e;
       --dompick-bg-tertiary: #0f0f23;
       --dompick-bg-dialog: #0a0a1a;
       --dompick-text-primary: #d1d5db;
       --dompick-text-secondary: #9ca3af;
       --dompick-border-primary: #374151;
       --dompick-border-secondary: #4b5563;
       --dompick-border-dialog: #1f2937;
       --dompick-accent-primary: #d97706;
       --dompick-accent-secondary: #b45309;
       --dompick-accent-tertiary: #f59e0b;
       --dompick-shadow: rgba(0, 0, 0, 0.3);
       --dompick-shadow-dialog: rgba(0, 0, 0, 0.4);
       --dompick-backdrop: rgba(0, 0, 0, 0.4);
       --dompick-success: #047857;
     }

     /* Тема для Cypress режима */
     .__dompick-theme-cypress {
       --dompick-bg-primary: #0f172a;
       --dompick-bg-secondary: #1e293b;
       --dompick-bg-tertiary: #020617;
       --dompick-bg-dialog: #0a0f1a;
       --dompick-text-primary: #e2e8f0;
       --dompick-text-secondary: #94a3b8;
       --dompick-border-primary: #334155;
       --dompick-border-secondary: #475569;
       --dompick-border-dialog: #1e293b;
       --dompick-accent-primary: #0891b2;
       --dompick-accent-secondary: #0e7490;
       --dompick-accent-tertiary: #06b6d4;
       --dompick-shadow: rgba(0, 0, 0, 0.3);
       --dompick-shadow-dialog: rgba(0, 0, 0, 0.4);
       --dompick-backdrop: rgba(0, 0, 0, 0.4);
       --dompick-success: #059669;
     }

    /* Основные стили с использованием CSS переменных */
    .__dompick-panel {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      background: var(--dompick-bg-primary);
      color: var(--dompick-text-primary);
      font: 12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      border: 1px solid var(--dompick-border-primary);
      border-radius: 12px;
      box-shadow: 0 10px 30px var(--dompick-shadow);
      padding: 10px 12px;
      width: 325px;
      max-width: 95vw;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: var(--dompick-transition);
    }

    .__dompick-help {
      opacity: .8;
      margin-left: 8px;
      color: var(--dompick-text-secondary);
    }

    .__dompick-btn-close {
      cursor: pointer;
      border: 1px solid var(--dompick-border-secondary);
      background: var(--dompick-bg-secondary);
      color: var(--dompick-text-primary);
      border-radius: 8px;
      padding: 4px 8px;
      transition: var(--dompick-transition);
    }

    .__dompick-btn-close:hover {
      background: var(--dompick-border-primary);
      transform: translateY(-1px);
    }

    .__dompick-btn {
      cursor: pointer;
      border: 1px solid var(--dompick-border-secondary);
      background: var(--dompick-bg-secondary);
      color: var(--dompick-text-primary);
      border-radius: 8px;
      padding: 4px 8px;
      margin-left: 4px;
      font-size: 11px;
      transition: var(--dompick-transition);
      position: relative;
      overflow: hidden;
    }

    .__dompick-btn:hover {
      background: var(--dompick-border-primary);
      transform: translateY(-1px);
    }

    .__dompick-btn::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
      transition: left 0.5s;
    }

    .__dompick-btn:hover::before {
      left: 100%;
    }

    /* Ручка перетаскивания */
    .__dompick-drag {
      cursor: move;
      border: 1px solid var(--dompick-border-secondary);
      background: var(--dompick-bg-secondary);
      color: var(--dompick-text-primary);
      border-radius: 8px;
      padding: 4px 8px;
      transition: var(--dompick-transition);
      line-height: 1;
      user-select: none;
    }
    .__dompick-drag:hover {
      background: var(--dompick-border-primary);
      transform: translateY(-1px);
    }

    .__dompick-highlight {
      outline: 2px solid var(--dompick-accent-primary);
      outline-offset: 2px;
      animation: __dompick-pulse 2s infinite;
    }

    @keyframes __dompick-pulse {
      0%, 100% { outline-color: var(--dompick-accent-primary); }
      50% { outline-color: var(--dompick-accent-secondary); }
    }

    .__dompick-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: var(--dompick-z-overlay);
      cursor: crosshair;
      background: transparent;
    }

    .__dompick-modal {
      position: fixed;
      inset: 0;
      z-index: var(--dompick-z-modal);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .__dompick-backdrop {
      position: absolute;
      inset: 0;
      background: var(--dompick-backdrop);
      backdrop-filter: blur(4px);
      transition: var(--dompick-transition);
    }

    .__dompick-dialog {
      position: relative;
      background: var(--dompick-bg-dialog);
      color: var(--dompick-text-primary);
      width: 920px;
      max-width: 95vw;
      max-height: 85vh;
      border: 1px solid var(--dompick-border-dialog);
      border-radius: 14px;
      box-shadow: 0 20px 50px var(--dompick-shadow-dialog);
      display: flex;
      flex-direction: column;
      transition: var(--dompick-transition);
      transform: scale(0.95);
      opacity: 0;
      animation: __dompick-dialog-enter 0.3s ease-out forwards;
    }

    @keyframes __dompick-dialog-enter {
      to {
        transform: scale(1);
        opacity: 1;
      }
    }

    .__dompick-head {
      display: flex;
      align-items: center;
      gap: 10px;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--dompick-border-primary);
      flex-shrink: 0;
      position: sticky;
      top: 0;
      background: var(--dompick-bg-dialog);
      z-index: 10;
      border-radius: 14px 14px 0 0;
    }

    .__dompick-title {
      font-weight: 700;
      color: var(--dompick-accent-tertiary);
      text-shadow: 0 0 8px var(--dompick-accent-primary);
    }

    .__dompick-body {
      padding: 12px 16px;
      overflow-y: auto;
      flex: 1;
    }

    .__dompick-list {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: center;
    }

    .__dompick-buttons {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .__dompick-item {
      background: var(--dompick-bg-tertiary);
      border: 1px solid var(--dompick-border-primary);
      border-radius: 10px;
      padding: 8px 10px;
      word-break: break-all;
      transition: var(--dompick-transition);
    }

    .__dompick-item:hover {
      border-color: var(--dompick-accent-primary);
      box-shadow: 0 0 0 1px var(--dompick-accent-primary);
    }

    .__dompick-copy {
      cursor: pointer;
      border: 1px solid var(--dompick-border-secondary);
      background: var(--dompick-bg-secondary);
      color: var(--dompick-text-primary);
      border-radius: 10px;
      padding: 6px 10px;
      transition: var(--dompick-transition);
    }

    .__dompick-copy:hover {
      background: var(--dompick-border-primary);
      transform: translateY(-1px);
    }

    .__dompick-action {
      cursor: pointer;
      border: 1px solid var(--dompick-accent-secondary);
      background: var(--dompick-accent-secondary);
      color: var(--dompick-accent-tertiary);
      border-radius: 10px;
      padding: 6px 8px;
      margin-left: 4px;
      font-size: 11px;
      transition: var(--dompick-transition);
    }

    .__dompick-action:hover {
      background: var(--dompick-accent-primary);
      transform: translateY(-1px);
    }

             .__dompick-toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      background: var(--dompick-accent-secondary);
      color: var(--dompick-accent-tertiary);
      padding: 8px 12px;
      border-radius: 999px;
      box-shadow: 0 10px 30px var(--dompick-shadow);
      border: 1px solid var(--dompick-accent-primary);
      opacity: 0;
      transition: var(--dompick-transition);
      z-index: var(--dompick-z-top);
      pointer-events: none;
      font-weight: 500;
    }

    .__dompick-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(-4px);
    }

    .__dompick-group {
      border: 1px solid var(--dompick-border-primary);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      background: var(--dompick-bg-tertiary);
      transition: var(--dompick-transition);
    }

    .__dompick-group:last-child {
      margin-bottom: 0;
    }

    .__dompick-group:hover {
      border-color: var(--dompick-accent-primary);
      box-shadow: 0 0 0 1px var(--dompick-accent-primary);
    }

    .__dompick-selector-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 12px;
      align-items: center;
      margin-bottom = '8px';
    }

    .__dompick-selector-row:last-child {
      margin-bottom: 0;
    }

    /* Специальные стили для кнопок режимов */
    .__dompick-mode-btn {
      position: relative;
      overflow: hidden;
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 500;
      transition: var(--dompick-transition);
      border: 2px solid transparent;
    }

    .__dompick-mode-btn.active {
      background: var(--dompick-accent-secondary);
      border-color: var(--dompick-accent-primary);
      color: var(--dompick-accent-tertiary);
      box-shadow: 0 0 0 2px var(--dompick-accent-primary);
    }

    .__dompick-mode-btn:not(.active) {
      background: var(--dompick-bg-secondary);
      border-color: var(--dompick-border-secondary);
      color: var(--dompick-text-secondary);
    }

    .__dompick-mode-btn:not(.active):hover {
      background: var(--dompick-border-primary);
      color: var(--dompick-text-primary);
      transform: translateY(-1px);
    }

    /* Анимация переключения тем */
    .__dompick-theme-transition {
      transition: var(--dompick-transition);
    }

    /* Градиентные эффекты для активных элементов */
    .__dompick-gradient-bg {
      background: linear-gradient(135deg, var(--dompick-accent-secondary), var(--dompick-accent-primary));
    }

    

    /* Эффект волны при клике на кнопки */
    .__dompick-mode-btn {
      position: relative;
      overflow: hidden;
    }

    .__dompick-mode-btn::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 0;
      height: 0;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.3);
      transform: translate(-50%, -50%);
      transition: width 0.6s, height 0.6s;
    }

    .__dompick-mode-btn:active::after {
      width: 300px;
      height: 300px;
    }

    /* Улучшенные hover эффекты */
    .__dompick-mode-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .__dompick-mode-btn.active:hover {
      transform: translateY(-1px);
    }

    /* Анимация появления модального окна */
    .__dompick-dialog {
      animation: __dompick-modal-enter 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    @keyframes __dompick-modal-enter {
      0% {
        transform: scale(0.8) translateY(20px);
        opacity: 0;
      }
      100% {
        transform: scale(1) translateY(0);
        opacity: 1;
      }
    }

    /* Эффект параллакса для backdrop */
    .__dompick-backdrop {
      animation: __dompick-backdrop-enter 0.3s ease-out forwards;
    }

    @keyframes __dompick-backdrop-enter {
      from {
        opacity: 0;
        backdrop-filter: blur(0px);
      }
      to {
        opacity: 1;
        backdrop-filter: blur(4px);
      }
    }

    /* Стили для индикатора режима */
    #__dompick-mode-indicator {
      transition: var(--dompick-transition);
      animation: __dompick-indicator-pulse 0.6s ease-out;
    }

    @keyframes __dompick-indicator-pulse {
      0% {
        transform: scale(0.8);
        opacity: 0.7;
      }
      50% {
        transform: scale(1.1);
        opacity: 1;
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }

    /* Улучшенные стили для кнопок режимов */
    .__dompick-mode-btn {
      font-weight: 500;
      letter-spacing: 0.5px;
    }

    .__dompick-mode-btn.active {
      font-weight: 600;
    }

    /* Эффект градиента для активных кнопок */
    .__dompick-mode-btn.active {
      background: linear-gradient(135deg, var(--dompick-accent-secondary), var(--dompick-accent-primary));
      border-color: var(--dompick-accent-primary);
      color: var(--dompick-accent-tertiary);
      box-shadow: 0 0 0 2px var(--dompick-accent-primary), 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    /* Оптимизация на время перетаскивания */
    .__dompick-dragging * {
      transition: none !important;
    }
    .__dompick-dragging .__dompick-backdrop {
      backdrop-filter: none !important;
    }
    .__dompick-panel {
      will-change: transform;
    }
  `;
  document.head.appendChild(styleEl);

  // ==== Переменные состояния ====
  let currentHighlighted = null;
  let fixedHighlighted = null;
  let isCtrlPressed = false;
  let isSelectionModeActive = false;
  let overlayEl = null;
  let lastHoveredElement = null;
  // Режим вывода: 'cypress' | 'js'
  let __dompickMode = 'cypress';
  // Версия UI
  const __dompickVersion = 'v1.09';

  // Глобальный кэш для селекторов в обоих режимах
  let __dompickSelectorCache = null;
  let __dompickCachedElement = null;

  // ==== Панель ====
  const panel = document.createElement('div');
  panel.className = '__dompick-panel __dompick-theme-transition';
  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
      <div style="flex: 1;">
        <div style="font-weight: bold; margin-bottom: 4px; color: var(--dompick-text-primary);">
          DOM Picker <span style="opacity:.6; color: var(--dompick-text-secondary);">${__dompickVersion}</span>
        </div>
        <div class="__dompick-help" id="__dompick-help">
          <div>Ctrl+клик - показать селекторы</div>
        </div>
        <div style="margin-top:6px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <span style="opacity:.8; color: var(--dompick-text-secondary);">Режим:</span>
          <button class="__dompick-mode-btn" id="__dompick-mode-cypress">
            <span style="margin-right:4px;">⚡</span>Cypress
          </button>
          <button class="__dompick-mode-btn" id="__dompick-mode-js">
            <span style="margin-right:4px;">🔧</span>JS
          </button>
        </div>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <button class="__dompick-drag" id="__dompick-drag-panel" title="Перетащить панель">⠿</button>
        <button class="__dompick-btn-close" id="__dompick-close">Закрыть</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // ==== Функции подсветки ====
  // Сделаем панель перетаскиваемой за ручку
  try {
    const dragHandlePanel = panel.querySelector('#__dompick-drag-panel');
    if (dragHandlePanel) {
      // Для панели сохраняем фиксированное позиционирование (fixed)
      makeDraggable(panel, dragHandlePanel, { constrainToViewport: true, keepFixed: true });
      // Инициал: зафиксируем стартовые координаты, чтобы не "прыгало" при первом переносе
      const r = panel.getBoundingClientRect();
      panel.style.left = `${r.left}px`; panel.style.top = `${r.top}px`; panel.style.right = 'auto'; panel.style.bottom = 'auto';
    }
  } catch {}

  // Кнопки переключения режима
  const modeBtnCypress = panel.querySelector('#__dompick-mode-cypress');
  const modeBtnJs = panel.querySelector('#__dompick-mode-js');
  
  const applyModeStyles = () => {
    if (!modeBtnCypress || !modeBtnJs) return;
    
    // Добавляем класс для плавного перехода
    document.body.classList.add('__dompick-theme-transition');
    
    // Удаляем все классы тем с body
    document.body.classList.remove('__dompick-theme-js', '__dompick-theme-cypress');
    
    // Применяем соответствующую тему
    if (__dompickMode === 'js') {
      document.body.classList.add('__dompick-theme-js');
      modeBtnJs.classList.add('active');
      modeBtnCypress.classList.remove('active');
    } else {
      document.body.classList.add('__dompick-theme-cypress');
      modeBtnCypress.classList.add('active');
      modeBtnJs.classList.remove('active');
    }
    
         // Убираем эффект свечения с обеих кнопок
     modeBtnJs.classList.remove('__dompick-glow');
     modeBtnCypress.classList.remove('__dompick-glow');
    
    // Показываем уведомление о смене режима
    const modeName = __dompickMode === 'js' ? 'JavaScript' : 'Cypress';
    showToast(`Режим переключен на ${modeName}`);
    
    // Обновляем индикатор режима
    const modeIndicator = panel.querySelector('#__dompick-mode-indicator');
    if (modeIndicator) {
      modeIndicator.textContent = __dompickMode === 'js' ? '🔧 JS' : '⚡ Cypress';
      modeIndicator.style.background = 'var(--dompick-accent-secondary)';
      modeIndicator.style.color = 'var(--dompick-accent-tertiary)';
    }
    
    // Обновляем содержимое модального окна, если оно открыто
    updateModalContent();
    
    // Убираем класс перехода через некоторое время
    setTimeout(() => {
      document.body.classList.remove('__dompick-theme-transition');
    }, 300);
  };
  
  // Функция для обновления содержимого модального окна при смене режима
  const updateModalContent = () => {
    const modal = document.querySelector('.__dompick-modal');
    if (!modal) return;
    
    const groupsContainer = modal.querySelector('.__dompick-groups');
    if (!groupsContainer) return;
    
    // НЕТ зафиксированного элемента → просим выбрать
    if (!__dompickCachedElement) {
      groupsContainer.innerHTML = '<div style="opacity:.8;font-size:12px;color:var(--dompick-text-secondary)">' +
        'Сначала выберите элемент (Ctrl+клик).' +
        '</div>';
      return;
    }
    
    // Обновляем заголовок модального окна
    const title = modal.querySelector('.__dompick-title');
    if (title) {
      title.textContent = `Селекторы для ${__dompickMode === 'js' ? 'JS' : 'Cypress'}`;
    }
    
    // Если есть кэш для текущего режима, используем его
    if (__dompickSelectorCache && __dompickCachedElement && __dompickSelectorCache[__dompickMode]) {
      // Очищаем содержимое
      groupsContainer.innerHTML = '';
      
      const availableActions = getAvailableActions(__dompickCachedElement);
      const cachedGroups = __dompickSelectorCache[__dompickMode];
      
      createSelectorGroup(groupsContainer, 'Базовые селекторы', cachedGroups.basicSelectors, cachedGroups.moreBasic, availableActions, 'basic');
      const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
      createSelectorGroup(groupsContainer, containsTitle, cachedGroups.containsSelectors, cachedGroups.moreContains, availableActions, 'contains');
      createSelectorGroup(groupsContainer, 'Позиционные селекторы', cachedGroups.nthSelectors, cachedGroups.moreNth, availableActions, 'nth');

      if (cachedGroups.aggressive && cachedGroups.aggressive.length > 0) {
        createSelectorGroup(groupsContainer, 'Агрессивные селекторы', cachedGroups.aggressive.slice(0, 5), cachedGroups.aggressive.slice(5), availableActions, 'aggressive');
      }
      return;
    }
    
    // Если кэша нет, показываем состояние загрузки и генерируем селекторы синхронно
    groupsContainer.innerHTML = '<div id="__dompick-loading" style="opacity:.8;font-size:12px;color:var(--dompick-text-secondary)">Генерация селекторов...</div>';
    
    // Небольшая задержка чтобы пользователь увидел сообщение о загрузке
    setTimeout(() => {
      // Генерируем селекторы для текущего режима синхронно
      resetPerfGuards();
      __buildBudgetEnd = performance.now() + 5000;
      
      const groups = buildCandidates(__dompickCachedElement);
      
      // Инициализируем кэш если его нет
      if (!__dompickSelectorCache) {
        __dompickSelectorCache = {};
      }
      
      // Сохраняем селекторы для текущего режима
      __dompickSelectorCache[__dompickMode] = groups;
      
      // Отображаем селекторы
      const loading = groupsContainer.querySelector('#__dompick-loading');
      if (loading) loading.remove();
      
      const availableActions = getAvailableActions(__dompickCachedElement);
      
      createSelectorGroup(groupsContainer, 'Базовые селекторы', groups.basicSelectors, groups.moreBasic, availableActions, 'basic');
      const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
      createSelectorGroup(groupsContainer, containsTitle, groups.containsSelectors, groups.moreContains, availableActions, 'contains');
      createSelectorGroup(groupsContainer, 'Позиционные селекторы', groups.nthSelectors, groups.moreNth, availableActions, 'nth');

      if (groups.aggressive && groups.aggressive.length > 0) {
        createSelectorGroup(groupsContainer, 'Агрессивные селекторы', groups.aggressive.slice(0, 5), groups.aggressive.slice(5), availableActions, 'aggressive');
      }
      
      // ГАРАНТИЯ: если ни одного селектора не сгенерировалось — формируем абсолютный CSS‑путь
      const totalCount = groups.basicSelectors.length + groups.containsSelectors.length + groups.nthSelectors.length + (groups.aggressive?.length || 0);
      if (totalCount === 0) {
        const absPath = buildAbsoluteCssPath(__dompickCachedElement);
        const fallback = [{ sel: absPath }];
        createSelectorGroup(groupsContainer, 'Агрессивные селекторы (fallback)', fallback, [], availableActions, 'aggressive');
      }
      
      resetPerfGuards();
    }, 200); // Небольшая задержка для обновления UI
  };

  if (modeBtnCypress && modeBtnJs) {
    modeBtnCypress.addEventListener('click', () => { 
      __dompickMode = 'cypress'; 
      applyModeStyles(); 
    });
    modeBtnJs.addEventListener('click', () => { 
      __dompickMode = 'js'; 
      applyModeStyles(); 
    });
    applyModeStyles();
  }

  // ==== Функции подсветки ====
  const highlightElement = (el) => {
    if (el && el !== panel && !panel.contains(el)) {
      el.classList.add('__dompick-highlight');
    }
  };

  const removeHighlight = (el) => {
    if (el) {
      el.classList.remove('__dompick-highlight');
    }
  };

  const clearAllHighlights = () => {
    if (currentHighlighted) {
      removeHighlight(currentHighlighted);
      currentHighlighted = null;
    }
    if (fixedHighlighted) {
      removeHighlight(fixedHighlighted);
      fixedHighlighted = null;
    }
  };



  // Определяет все возможные действия для элемента
  const getAvailableActions = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = el.type ? el.type.toLowerCase() : '';
    const actions = [];
    
    if (tag === 'input') {
      if (type === 'text' || type === 'email' || type === 'password' || type === 'search' || type === 'url' || type === 'tel') {
        actions.push('type', 'click', 'clear');
      } else if (type === 'checkbox' || type === 'radio') {
        actions.push('check', 'uncheck', 'click');
      } else if (type === 'submit' || type === 'button') {
        actions.push('click');
      } else {
        actions.push('click');
      }
    } else if (tag === 'select') {
      actions.push('select', 'click');
    } else if (tag === 'textarea') {
      actions.push('type', 'click', 'clear');
    } else if (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button') {
      actions.push('click');
    } else {
      // Для остальных элементов - только клик
      actions.push('click');
    }
    
    return actions;
  };



  document.getElementById('__dompick-close').addEventListener('click', () => {
    // 1) Снять режим выбора и убрать оверлей
    if (typeof deactivateSelectionMode === 'function') {
      deactivateSelectionMode();
    }
    
    // 2) Удалить все открытые модалки/тосты на всякий случай
    document.querySelectorAll('.__dompick-modal').forEach(m => m.remove());
    const toast = document.querySelector('.__dompick-toast');
    if (toast) toast.remove();
    
    // 3) Убрать все наши подсветки
    document.querySelectorAll('.__dompick-highlight')
      .forEach(el => el.classList.remove('__dompick-highlight'));
    
    // 4) Снять классы темы с body
    document.body.classList.remove('__dompick-theme-js','__dompick-theme-cypress','__dompick-theme-transition');
    
    // 5) Снять листенеры как и было
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('mouseover', onMouseOver, true);
    window.removeEventListener('mouseout', onMouseOut, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    
    // 6) Удалить панель и стили
    clearAllHighlights();
    panel.remove();
    styleEl.remove();
    
    // 7) Сбросить флаги/кэши и перф-кэш
    if (typeof resetPerfGuards === 'function') resetPerfGuards();
    __dompickSelectorCache = null;
    __dompickCachedElement = null;
    window.__domPickerActive = false;
  });

  // ==== Вспомогательные ====
  const prefDataAttrs = ['data-testid','data-test','data-cy','data-qa','data-test-id','data-automation-id','for'];
  const okAttrs = ['id','name','type','placeholder','href','value','role','aria-label','title','for'];
  const interestingSel = 'button, a, input, select, textarea, label, [role="button"], [role="menuitem"], .select2-container, .select2-choice, .select2-selection, .select2-selection__rendered, .select2-drop, .select2-results, .select2-result, .select2-result-label, .select2-results__option, .select2-input';

  const esc = (s) => CSS.escape(s);
  const looksDynamic = (s='') => /\b\d{4,}\b|\b[a-f0-9]{6,}\b|__/i.test(s);
  const hasDigits = (s='') => /\d/.test(s);

  // Эвристика: «листовой» инлайн-элемент, который следует оставлять как есть (не подниматься к родителю)
  const isLeafInlineElement = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    // Явные «иконко-подобные» и мелкие инлайны
    const leafTags = new Set(['i','svg','img','use','path','picture','source','sup','sub','b','strong','em','small','span']);
    if (leafTags.has(tag) && (!el.children || el.children.length === 0)) return true;

    // Классовые паттерны иконок
    const classList = el.classList ? [...el.classList] : [];
    if (classList.some(c => /^fa($|-)/.test(c) || c.includes('icon') || c.startsWith('mdi-') || c.startsWith('bi-'))) {
      return true;
    }

    // Мелкие инлайн элементы без детей
    try {
      const cs = window.getComputedStyle(el);
      const interactiveBlockers = new Set(['a','button','input','select','textarea','label']);
      if (
        cs && (cs.display === 'inline' || cs.display === 'inline-block') &&
        (!el.children || el.children.length === 0) &&
        !interactiveBlockers.has(tag)
      ) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 40 && rect.height <= 40) return true;
      }
    } catch {}

    return false;
  };

  // Конфиг весов (динамическая система рейтинга). Меняйте значения по необходимости.
  // Пояснения к каждому параметру ниже.
  const selectorWeights = {
    // anchor_type: базовая «опорная» надёжность якоря селектора
    // data-testid / data-qa: специальные тестовые атрибуты почти всегда стабильны
    anchor_data_testid: 30,
    // id без цифр: как правило статичен (семантические id)
    anchor_id_no_digits: 25,
    // комбо role+aria-label: доступности метки обычно осмысленные и стабильные
    anchor_role_aria: 18,
    // стабильный класс без цифр: хороший компромисс (подняли приоритет)
    anchor_stable_class: 16,
    // прочие атрибуты (href/title/name и т.п.) — слегка ниже класса
    anchor_other_attr: 6,
    // текст в контексте (уникален в scope)
    anchor_text_scoped_unique: 10,
    // текст глобально уникален
    anchor_text_global_unique: 4,

    // Штрафы за хрупкость / сложность
    // Позиционные зависимые селекторы (структура DOM)
    penalty_positional: -25,
    // Абсолютный путь (полностью позиционный)
    penalty_absolute_path: -40,
    // Доля цифр в токенах (#id/.class/[attr]): от 0 до -20
    penalty_digits_ratio_max: -20,
    // Глубина пути: -3 за каждый уровень после 2
    penalty_per_depth_after2: -3,
    // Сложность: -2 за каждый атрибут/псевдо после первых двух
    penalty_per_extra_complex: -2,
    // Кол-во ссылок на элементы/сегменты пути: -2 за каждый сегмент после первого
    penalty_per_element_ref_after1: -2,
    // Использование :nth-* (доп. к positional)
    penalty_uses_nth: -15,
    // Общий штраф за каждый атрибут в селекторе (квадратные скобки)
    penalty_per_attr_token: -6,
    // Доп. штраф за data-* атрибуты (кроме тестовых data-testid/qa/cy)
    penalty_per_data_attr_non_test: -4,
    // Риск текста (low 0, mid -6, high -15)
    penalty_text_mid: -6,
    penalty_text_high: -15,

    // Качество контейнера (если есть явный scope)
    // Уникальный стабильный контейнер (без цифр)
    bonus_container_unique_stable: 15,
    // Уникальный контейнер с цифрами
    bonus_container_unique_with_digits: 6,
    // Фильтр видимости / спец-контексты (модалки/datepicker)
    bonus_visibility_context: 6,

    // Соответствие действию (например, клик по ссылке/кнопке)
    bonus_action_perfect: 10,
    bonus_action_ok: 4,
    penalty_action_poor: -6,

    // Устойчивость fallback (более надёжные фоллбеки могут получить +)
    bonus_fallback_low: 3,
    bonus_fallback_mid: 6,
    bonus_fallback_high: 12,
    // Дополнительные поправки
    // Бонус за "tag.class" для кликабельных элементов (простота и надёжность класса)
    bonus_tag_class_clickable: 8,
    // Штраф, если для кликабельного элемента опора идёт на атрибут (а не класс)
    penalty_attr_clickable: -4,
    // Штраф за комбинатор "+" (хрупкая связь с соседом)
    penalty_combinator_plus: -4,
    // Бонусы для простых уникальных селекторов на классы
    bonus_simple_unique_class: 14,       // .class
    bonus_simple_tag_class: 12,          // tag.class
  };

  // --- Утилиты анализа селектора ---
  const isCypressSelector = (item) => !!item.isCypress || /\bcy\./.test(item.sel);
  const includesContains = (s) => /\.contains\(/.test(s) || /cy\.contains\(/.test(s);
  const extractGetScope = (s) => {
    const m = s.match(/cy\.get\(['"]([^'"]+)['"]\)/);
    return m ? m[1] : null;
  };
  const tokensFromSelector = (s) => {
    // Извлекаем критичные токены: #id, .class, [attr=value]
    const idTokens = (s.match(/#[^\s>.:#\[]+/g) || []);
    const classTokens = (s.match(/\.[^\s>.:#\[]+/g) || []);
    const attrTokens = (s.match(/\[[^\]]+\]/g) || []);
    return { idTokens, classTokens, attrTokens };
  };
  const elementRefCount = (s) => {
    // Считаем число сегментов-элементов, разделённых комбинаторами пробел/>, +, ~
    // Убираем лишние пробелы и служебные конструкции внутри []
    const parts = s
      .replace(/\[[^\]]+\]/g, '[]')
      .split(/\s*[>+~]\s*|\s+/)
      .filter(Boolean);
    return Math.max(1, parts.length);
  };
  const digitsRatioInTokens = (s) => {
    const { idTokens, classTokens, attrTokens } = tokensFromSelector(s);
    const toks = [...idTokens, ...classTokens, ...attrTokens];
    const joined = toks.join('');
    if (joined.length === 0) return 0;
    const digits = (joined.match(/\d/g) || []).length;
    return digits / joined.length; // 0..1
  };
  const pathDepth = (s) => {
    // Грубая оценка глубины: по разделителям '>' и пробелам между сегментами
    const segments = s.split(/\s*>\s*|\s+/).filter(Boolean);
    return Math.max(1, segments.length);
  };
  const complexityScore = (s) => {
    // Количество атрибутов и псевдоклассов
    const attrCount = (s.match(/\[[^\]]+\]/g) || []).length;
    const pseudoCount = (s.match(/:[a-zA-Z-]+\b/g) || []).length;
    const total = attrCount + pseudoCount;
    return Math.max(0, total - 2); // сверх первых двух
  };
  const attributeTokenPenalty = (s) => {
    const attrTokens = (s.match(/\[[^\]]+\]/g) || []);
    let penalty = 0;
    for (const tok of attrTokens) {
      penalty += selectorWeights.penalty_per_attr_token; // общий штраф за []
      // data-* атрибуты
      const isTest = /\[(data-testid|data-qa|data-cy|data-test|data-test-id|data-automation-id)=/.test(tok);
      const isData = /\[data-[-a-zA-Z0-9_]+=/.test(tok);
      if (isData && !isTest) penalty += selectorWeights.penalty_per_data_attr_non_test;
    }
    return penalty;
  };
  const usesNth = (s) => /:nth-(?:child|of-type)\(\d+\)/.test(s) || /\.eq\(\d+\)/.test(s);
  const isAbsolutePathLike = (s) => {
    // Только теги, опционально :nth-of-type, с '>'/пробелами, без # . [ ]
    if (/[#\.\[]/.test(s)) return false;
    return /^\s*[a-z][a-z0-9-]*(?::nth-of-type\(\d+\))?(\s*>\s*[a-z][a-z0-9-]*(?::nth-of-type\(\d+\))?)*(\s*)$/.test(s);
  };
  const isAggressiveSelector = (s) => {
    if (isAbsolutePathLike(s)) return true;
    if (usesNth(s)) return true;
    if (pathDepth(s) > 6) return true;
    if (/\+|~/.test(s)) return true;
    return false;
  };
  const anchorTypeBonuses = (sel, targetEl) => {
    let bonus = 0;
    // data-testid / data-qa / data-cy
    if (/\[(data-testid|data-qa|data-cy)=/.test(sel)) bonus += selectorWeights.anchor_data_testid;
    // id без цифр
    const idTokens = (sel.match(/#([a-zA-Z_-][a-zA-Z0-9_-]*)/g) || []);
    if (idTokens.some(t => !/\d/.test(t))) bonus += selectorWeights.anchor_id_no_digits;
    // role+aria-label
    if (/\[role=/.test(sel) && /\[aria-label=/.test(sel)) bonus += selectorWeights.anchor_role_aria;
    // стабильный класс без цифр
    const classTokens = (sel.match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g) || []);
    if (classTokens.some(t => !/\d/.test(t))) bonus += selectorWeights.anchor_stable_class;
    // прочие атрибуты (href, title, name и т.п.)
    if (/\[(id|name|type|placeholder|href|value|title|for)=/.test(sel)) bonus += selectorWeights.anchor_other_attr;
    // текстовые варианты
    if (includesContains(sel)) {
      const scope = extractGetScope(sel);
      if (scope) bonus += selectorWeights.anchor_text_scoped_unique;
      else bonus += selectorWeights.anchor_text_global_unique;
    }
    return bonus;
  };
  const textRiskPenalty = (sel) => {
    if (!includesContains(sel)) return 0;
    const m = sel.match(/contains\(['"]([^'"]+)['"]\)/);
    const txt = m ? m[1] : '';
    if (!txt) return 0;
    if (txt.length <= 25 && !/\d/.test(txt)) return 0; // low
    if (txt.length <= 50) return selectorWeights.penalty_text_mid; // mid
    return selectorWeights.penalty_text_high; // high
  };
  const containerQualityBonus = (sel) => {
    const scope = extractGetScope(sel);
    if (!scope) return 0;
    // Условно считаем scope уникальным (мы строим только уникальные), оценим наличие цифр
    const hasDigitsInScope = /\d/.test(scope);
    return hasDigitsInScope
      ? selectorWeights.bonus_container_unique_with_digits
      : selectorWeights.bonus_container_unique_stable;
  };
  const visibilityContextBonus = (sel) => /:visible/.test(sel) || /\.modal|\.datepicker/.test(sel) ? selectorWeights.bonus_visibility_context : 0;
  const actionFitScore = (sel, el) => {
    const tag = el.tagName.toLowerCase();
    const clickable = /^(a|button|input)$/i.test(tag) || el.getAttribute('role') === 'button';
    if (!clickable) return selectorWeights.bonus_action_ok; // нейтрально-ок
    // Если кликабельный элемент и селектор явно указывает на тег/класс этого элемента
    const tagEnd = new RegExp(`${tag}(?![a-zA-Z0-9-])`);
    if (tagEnd.test(sel) || /\.contains\(/.test(sel)) return selectorWeights.bonus_action_perfect;
    // Явный уникальный ID без цифр (короткий, надёжный) — повышаем соответствие
    if (/^cy\.get\('#[a-zA-Z_-][a-zA-Z_-]*'\)\s*$/.test(`cy.get('${sel}')`) && !/\d/.test(sel)) {
      return selectorWeights.bonus_action_perfect;
    }
    // Предпочтение tag.class для кликабельных
    if (new RegExp(`^${tag}\\.[a-zA-Z_-]`).test(sel) && !/\d/.test(sel)) {
      return selectorWeights.bonus_tag_class_clickable;
    }
    // Если опора идёт на атрибут для кликабельного, снимаем немного баллов
    if (/\[[^\]]+\]/.test(sel)) {
      return selectorWeights.penalty_attr_clickable;
    }
    return selectorWeights.penalty_action_poor;
  };
  const fallbackResilienceBonus = (sel) => {
    if (isAbsolutePathLike(sel)) return selectorWeights.bonus_fallback_low; // слабый
    if (usesNth(sel)) return selectorWeights.bonus_fallback_low; // слабый
    if (/\[(data-testid|data-qa|data-cy)=/.test(sel) || /\[role=/.test(sel)) return selectorWeights.bonus_fallback_high;
    return selectorWeights.bonus_fallback_mid; // по умолчанию лёгкий бонус
  };
  const positionalPenalty = (sel) => usesNth(sel) ? selectorWeights.penalty_uses_nth + selectorWeights.penalty_positional : 0;
  const absolutePathPenalty = (sel) => isAbsolutePathLike(sel) ? selectorWeights.penalty_absolute_path : 0;
  const digitsRatioPenalty = (sel) => {
    const ratio = digitsRatioInTokens(sel); // 0..1
    return Math.round(ratio * Math.abs(selectorWeights.penalty_digits_ratio_max)) * -1;
  };
  const depthPenalty = (sel) => {
    const depth = pathDepth(sel);
    const extra = Math.max(0, depth - 2);
    return extra * selectorWeights.penalty_per_depth_after2;
  };
  const complexityPenalty = (sel) => complexityScore(sel) * selectorWeights.penalty_per_extra_complex;
  const elementRefsPenalty = (sel) => {
    const refs = elementRefCount(sel);
    const extra = Math.max(0, refs - 1);
    return extra * selectorWeights.penalty_per_element_ref_after1;
  };

  function computeSelectorScore(item, targetEl){
    const sel = item.isCypress ? item.sel : item.sel; // одинаково, item.sel всегда строка
    let score = 0;
    // Бонусы якорей
    score += anchorTypeBonuses(sel, targetEl);
    // Штрафы/бонусы
    score += positionalPenalty(sel);
    score += absolutePathPenalty(sel);
    score += digitsRatioPenalty(sel);
    score += depthPenalty(sel);
    score += complexityPenalty(sel);
    score += attributeTokenPenalty(sel);
    score += elementRefsPenalty(sel);
    score += textRiskPenalty(sel);
    score += containerQualityBonus(sel);
    score += visibilityContextBonus(sel);
    score += actionFitScore(sel, targetEl);
    score += fallbackResilienceBonus(sel);
    // Штраф за комбинатор '+' (зависимость от соседей)
    if (/\+/.test(sel)) score += selectorWeights.penalty_combinator_plus;

    // Преференс простым уникальным классам и tag.class
    try {
      const onlyClass = /^\.[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(sel) && !/\d/.test(sel);
      if (onlyClass) score += selectorWeights.bonus_simple_unique_class;
      const tagClass = /^[a-z][a-z0-9-]*\.[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(sel) && !/\d/.test(sel);
      if (tagClass) score += selectorWeights.bonus_simple_tag_class;
    } catch {}
    return score;
  }

  // ==== Быстродействие: общий тайм-бюджет и кэш запросов ====
  let __buildBudgetEnd = 0; // timestamp (performance.now) когда прекращаем дорогие операции
  const __queryCache = new Map(); // selector -> Array<Element>
  const budgetExpired = () => __buildBudgetEnd > 0 && performance.now() > __buildBudgetEnd;
  const resetPerfGuards = () => { __buildBudgetEnd = 0; __queryCache.clear(); };

  const isUnique = (selector, el) => {
    try {
      let list = __queryCache.get(selector);
      if (!list) {
        // Кэшируем результаты querySelectorAll для повтора в рамках одной генерации
        list = Array.from(document.querySelectorAll(selector));
        __queryCache.set(selector, list);
      }
      return list.length === 1 && list[0] === el;
    } catch { return false; }
  };
  
  // Функция для обнаружения похожих атрибутов
  const findSimilarAttrs = (el) => {
    const similarAttrs = [];
    if (!el.attributes) return similarAttrs;
    
    for (const {name, value} of el.attributes) {
      if (!value || value.trim() === '') continue;
      
      // Пропускаем уже известные атрибуты
      if (prefDataAttrs.includes(name) || okAttrs.includes(name)) continue;
      
      // Ищем атрибуты, которые выглядят как уникальные идентификаторы
      const valueStr = value.toString();
      
      // Проверяем, что значение не слишком длинное и не слишком короткое
      if (valueStr.length < 2 || valueStr.length > 50) continue;
      
      // Пропускаем динамические значения
      if (looksDynamic(valueStr)) continue;
      
      // Проверяем, что значение содержит буквы (не только цифры)
      if (!/[a-zA-Z]/.test(valueStr)) continue;
      
      // Проверяем, что атрибут уникален в документе
      const selector = `[${name}="${esc(valueStr)}"]`;
      if (isUnique(selector, el)) {
        similarAttrs.push({name, value: valueStr});
      }
    }
    
    return similarAttrs;
  };

  // Находит ближайший стабильный предок и его уникальный селектор без цифр
  function findStableScope(el) {
    let current = el.parentElement;
    let depth = 0;
    while (current && depth < 10) {
      // 1) Предок с ID без цифр
      if (current.id && !hasDigits(current.id)) {
        const sel = `#${esc(current.id)}`;
        if (document.querySelectorAll(sel).length === 1) {
          return { scopeEl: current, scopeSelector: sel };
        }
      }

      // 2) Предпочтительные data-атрибуты без цифр
      for (const a of prefDataAttrs) {
        const v = current.getAttribute && current.getAttribute(a);
        if (!v || hasDigits(v)) continue;
        const sel = `[${a}="${esc(v)}"]`;
        if (document.querySelectorAll(sel).length === 1) {
          return { scopeEl: current, scopeSelector: sel };
        }
      }

      // 3) Уникальные стабильные классы без цифр
      if (current.classList && current.classList.length > 0) {
        const stable = [...current.classList].filter(c => c && !looksDynamic(c) && !hasDigits(c) && !c.startsWith('__dompick'));
        for (const cls of stable.slice(0, 2)) {
          const sel = `.${esc(cls)}`;
          if (document.querySelectorAll(sel).length === 1) {
            return { scopeEl: current, scopeSelector: sel };
          }
        }
      }

      current = current.parentElement;
      depth++;
    }
    return null;
  }

  // Строит кратчайший позиционный путь от предка до элемента вида tag(>tag:nth-of-type(k))
  function buildMinimalPathFromAncestor(el, ancestorEl) {
    const parts = [];
    let current = el;
    while (current && current !== ancestorEl) {
      const parent = current.parentElement;
      if (!parent) break;
      const tag = current.tagName.toLowerCase();
      const sameTagSiblings = [...parent.children].filter(c => c.tagName.toLowerCase() === tag);
      const index = sameTagSiblings.indexOf(current);
      const part = sameTagSiblings.length === 1 || index < 0 ? tag : `${tag}:nth-of-type(${index + 1})`;
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }

  // Генерирует селекторы: стабильный предок (без цифр) + минимальный позиционный путь до элемента
  function byStableScopePath(el) {
    const out = [];
    const found = findStableScope(el);
    if (!found) return out;
    const { scopeEl, scopeSelector } = found;
    const path = buildMinimalPathFromAncestor(el, scopeEl);
    if (!path) return out;

    const directSel = `${scopeSelector} > ${path}`;
    if (isUnique(directSel, el)) out.push({ sel: directSel });

    const descSel = `${scopeSelector} ${path}`;
    if (isUnique(descSel, el)) out.push({ sel: descSel });

    // Попробуем упростить путь, заменив хвост на стабильный класс/тег,
    // например: '#student-next-lesson span.empty'
    const targetClassList = el.classList ? [...el.classList] : [];
    const stableClass = targetClassList.find(c => c && !looksDynamic(c) && !hasDigits(c) && !c.startsWith('__dompick'));
    if (stableClass) {
      const shortSel1 = `${scopeSelector} .${esc(stableClass)}`;
      if (isUnique(shortSel1, el)) out.push({ sel: shortSel1 });
      const tag = el.tagName.toLowerCase();
      const shortSel2 = `${scopeSelector} ${tag}.${esc(stableClass)}`;
      if (isUnique(shortSel2, el)) out.push({ sel: shortSel2 });
    }
    // Вариант по тегу, если класс не подходит
    const tag = el.tagName.toLowerCase();
    const tagSel = `${scopeSelector} ${tag}`;
    if (isUnique(tagSel, el)) out.push({ sel: tagSel });

    return out;
  }

  // Функция для извлечения текста из элемента
  const getElementText = (el) => {
    if (!el) return '';
    
    // Для input элементов берем placeholder или value
    if (el.tagName === 'INPUT') {
      return el.placeholder || el.value || '';
    }
    
    // Для элементов с aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    
    // Для элементов с title
    const title = el.getAttribute('title');
    if (title) return title;
    
    // Получаем только прямой текст элемента (без вложенных элементов)
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    
    text = text.trim();
    
    // Если прямого текста нет, берем весь textContent, но ограничиваем длину
    if (!text && el.textContent) {
      text = el.textContent.trim();
      if (text.length > 50) {
        text = text.substring(0, 47) + '...';
      }
    }
    
    return text;
  };

  // Функция для получения всех возможных текстов из элемента и его детей
  const getAllTexts = (el) => {
    const texts = [];
    
    // Если есть исходный элемент с текстом, приоритизируем его
    if (el._originalTextElement) {
      const originalText = getElementText(el._originalTextElement);
      if (originalText) texts.push(originalText);
    }
    
    // Основной текст элемента
    const mainText = getElementText(el);
    if (mainText) texts.push(mainText);
    
    // Тексты из дочерних элементов (для случаев как <span>Комментарии</span>)
    const children = el.querySelectorAll('*');
    for (const child of children) {
      const childText = getElementText(child);
      if (childText && childText !== mainText && childText.length >= 2) {
        texts.push(childText);
      }
    }
    
    // Убираем дубликаты и сортируем по длине (короткие первыми, но исходный текст - первым)
    const uniqueTexts = [...new Set(texts)];
    const originalText = el._originalTextElement ? getElementText(el._originalTextElement) : null;
    
    if (originalText && uniqueTexts.includes(originalText)) {
      // Ставим исходный текст первым
      return [originalText, ...uniqueTexts.filter(t => t !== originalText).sort((a, b) => a.length - b.length)];
    }
    
    return uniqueTexts.sort((a, b) => a.length - b.length);
  };

  // Проверка, подходит ли текст для cy.contains
  const isGoodTextForContains = (text) => {
    if (!text || text.length < 2) return false;
    if (text.length > 50) return false;
    if (/^\s*$/.test(text)) return false; // только пробелы
    if (looksDynamic(text)) return false; // динамический текст
    return true;
  };

  // Проверка уникальности элемента по тексту
  const isUniqueByText = (el, text, tagFilter = null) => {
    try {
      if (budgetExpired()) return false; // избегаем дорогих глобальных проходов при исчерпании бюджета
      const cachedSel = tagFilter || '*';
      let candidates = __queryCache.get(`__text_${cachedSel}`);
      if (!candidates) {
        candidates = Array.from(document.querySelectorAll(cachedSel));
        __queryCache.set(`__text_${cachedSel}`, candidates);
      }
      let matches = 0;
      let foundElement = null;
      for (const element of candidates) {
        const elementText = getElementText(element);
        if (elementText === text) {
          matches++;
          foundElement = element;
          if (matches > 1 || budgetExpired()) break;
        }
      }
      return matches === 1 && foundElement === el;
    } catch {
      return false;
    }
  };

  // Проверка уникальности элемента по тексту внутри родителя
  const isUniqueByTextInParent = (el, text, parent) => {
    try {
      if (!parent || budgetExpired()) return false;
      const elements = parent.querySelectorAll('*');
      let matches = 0;
      let foundElement = null;
      for (const element of elements) {
        const elementText = getElementText(element);
        if (elementText === text) {
          matches++;
          foundElement = element;
          if (matches > 1 || budgetExpired()) break;
        }
      }
      return matches === 1 && foundElement === el;
    } catch { return false; }
  };

  // Поиск минимального уникального контекста для cy.contains()
  const findMinimalUniqueContext = (el, text) => {
    let currentParent = el.parentElement;
    let depth = 0;
    const maxDepth = 5;
    
    while (currentParent && depth < maxDepth) {
      // Проверяем ID родителя
      if (currentParent.id) {
        const contextSelector = `#${esc(currentParent.id)}`;
        if (document.querySelectorAll(contextSelector).length === 1) {
          if (isUniqueByTextInParent(el, text, currentParent)) {
            return contextSelector;
          }
        }
      }
      
      // Проверяем предпочтительные data-атрибуты
      for (const attr of prefDataAttrs) {
        const value = currentParent.getAttribute(attr);
        if (value) {
          const contextSelector = `[${attr}="${esc(value)}"]`;
          if (document.querySelectorAll(contextSelector).length === 1) {
            if (isUniqueByTextInParent(el, text, currentParent)) {
              return contextSelector;
            }
          }
        }
      }
      
      // Проверяем уникальные классы
      if (currentParent.classList && currentParent.classList.length > 0) {
        const stableClasses = [...currentParent.classList].filter(c => 
          c && 
          !looksDynamic(c) && 
          !c.startsWith('__dompick') &&
          c.length > 2
        );
        
        for (const cls of stableClasses.slice(0, 2)) {
          const contextSelector = `.${esc(cls)}`;
          if (document.querySelectorAll(contextSelector).length === 1) {
            if (isUniqueByTextInParent(el, text, currentParent)) {
              return contextSelector;
            }
          }
        }
        
        // Комбинация из двух классов
        if (stableClasses.length >= 2) {
          const contextSelector = `.${esc(stableClasses[0])}.${esc(stableClasses[1])}`;
          if (document.querySelectorAll(contextSelector).length === 1) {
            if (isUniqueByTextInParent(el, text, currentParent)) {
              return contextSelector;
            }
          }
        }
      }
      
      // Проверяем семантические контейнеры
      const semanticContainers = ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form'];
      const parentTag = currentParent.tagName.toLowerCase();
      if (semanticContainers.includes(parentTag)) {
        if (isUniqueByTextInParent(el, text, currentParent)) {
          // Дополнительно проверяем, что такой семантический контейнер уникален или почти уникален
          const sameTagContainers = document.querySelectorAll(parentTag);
          if (sameTagContainers.length <= 3) {
            return parentTag;
          }
        }
      }
      
      currentParent = currentParent.parentElement;
      depth++;
    }
    
    return null;
  };

  // Валидация Cypress селектора - проверяет, что селектор действительно найдет нужный элемент
  const validateCypressSelector = (selector, targetElement) => {
    try {
      // Для относительных cy.contains селекторов (с .find, .children, .next и т.д.)
      if (selector.includes('cy.contains(') && (selector.includes('.find(') || selector.includes('.children(') || 
          selector.includes('.next(') || selector.includes('.prev(') || selector.includes('.parent('))) {
        return validateRelativeCypressSelector(selector, targetElement);
      }
      
      // Для cy.contains селекторов с контейнером
      if (selector.includes('.contains(')) {
        const text = selector.match(/contains\(['"]([^'"]+)['"]\)/)?.[1];
        if (!text) return false;
        
        const elementText = getElementText(targetElement);
        if (elementText !== text) return false;
        
        // СТРОГАЯ проверка: если есть контейнер, элемент ДОЛЖЕН быть уникальным в нём
        const containerMatch = selector.match(/cy\.get\(['"]([^'"]+)['"]\)/);
        if (containerMatch) {
          const containerSelector = containerMatch[1];
          try {
            const containers = document.querySelectorAll(containerSelector);
            if (containers.length === 0) return false; // Контейнер не найден
            
            let foundInContainer = false;
            let isUniqueInContainer = true;
            
            for (const container of containers) {
              if (container.contains(targetElement)) {
                foundInContainer = true;
                
                // КРИТИЧНО: проверяем уникальность текста в этом контейнере
                if (!isUniqueByTextInParent(targetElement, text, container)) {
                  isUniqueInContainer = false;
                  break;
                }
              }
            }
            
            return foundInContainer && isUniqueInContainer;
          } catch {
            return false;
          }
        } else {
          // Простой cy.contains('text') - проверяем глобальную уникальность
          return isUniqueByText(targetElement, text);
        }
      }
      
      // Для cy.contains('tag', 'text') селекторов
      if (selector.includes('cy.contains(')) {
        const tagTextMatch = selector.match(/cy\.contains\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/);
        if (tagTextMatch) {
          const [, tag, text] = tagTextMatch;
          const elementText = getElementText(targetElement);
          const elementTag = targetElement.tagName.toLowerCase();
          
          return elementText === text && 
                 elementTag === tag && 
                 isUniqueByText(targetElement, text, tag);
        }
        
        // Простой cy.contains('text')
        const textMatch = selector.match(/cy\.contains\(['"]([^'"]+)['"]\)/);
        if (textMatch) {
          const text = textMatch[1];
          const elementText = getElementText(targetElement);
          return elementText === text && isUniqueByText(targetElement, text);
        }
      }
      
      return true; // Для других типов селекторов пока пропускаем детальную проверку
    } catch {
      return false;
    }
  };

  // Валидация относительных Cypress селекторов
  const validateRelativeCypressSelector = (selector, targetElement) => {
    try {
      // Извлекаем базовый текст и метод
      const baseTextMatch = selector.match(/cy\.contains\(['"]([^'"]+)['"]\)/);
      if (!baseTextMatch) return false;
      
      const baseText = baseTextMatch[1];
      
      // Находим базовый элемент с этим текстом
      const baseElements = [];
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const elText = getElementText(el);
        if (elText === baseText) {
          baseElements.push(el);
        }
      }
      
      if (baseElements.length === 0) return false; // Базовый элемент не найден
      if (baseElements.length > 1) return false;   // Базовый текст не уникален
      
      const baseElement = baseElements[0];
      
      // Определяем метод и проверяем результат
      if (selector.includes('.children()')) {
        // Простой children()
        if (selector.match(/\.children\(\)$/)) {
          const children = [...baseElement.children];
          return children.length === 1 && children[0] === targetElement;
        }
        
        // children('tag')
        const childrenTagMatch = selector.match(/\.children\(['"]([^'"]+)['"]\)/);
        if (childrenTagMatch) {
          const tag = childrenTagMatch[1];
          const tagChildren = [...baseElement.children].filter(child => 
            child.tagName.toLowerCase() === tag
          );
          return tagChildren.length === 1 && tagChildren[0] === targetElement;
        }
        
        // children().eq(index)
        const childrenEqMatch = selector.match(/\.children\(\)\.eq\((\d+)\)/);
        if (childrenEqMatch) {
          const index = parseInt(childrenEqMatch[1]);
          const children = [...baseElement.children];
          return children[index] === targetElement;
        }
      }
      
      if (selector.includes('.find(')) {
        // find("*")
        if (selector.includes('.find("*")')) {
          const descendants = baseElement.querySelectorAll('*');
          return descendants.length === 1 && descendants[0] === targetElement;
        }
        
        // find('tag')
        const findTagMatch = selector.match(/\.find\(['"]([^'"]+)['"]\)/);
        if (findTagMatch) {
          const tag = findTagMatch[1];
          const tagDescendants = baseElement.querySelectorAll(tag);
          return tagDescendants.length === 1 && tagDescendants[0] === targetElement;
        }
      }
      
      if (selector.includes('.next()')) {
        const nextElement = baseElement.nextElementSibling;
        return nextElement === targetElement;
      }
      
      if (selector.includes('.prev()')) {
        const prevElement = baseElement.previousElementSibling;
        return prevElement === targetElement;
      }
      
      if (selector.includes('.nextAll()')) {
        // Простой nextAll()
        if (selector.match(/\.nextAll\(\)$/)) {
          const nextElements = [];
          let current = baseElement.nextElementSibling;
          while (current) {
            nextElements.push(current);
            current = current.nextElementSibling;
          }
          return nextElements.length === 1 && nextElements[0] === targetElement;
        }
        
        // nextAll().eq(index)
        const nextAllEqMatch = selector.match(/\.nextAll\(\)\.eq\((\d+)\)/);
        if (nextAllEqMatch) {
          const index = parseInt(nextAllEqMatch[1]);
          const nextElements = [];
          let current = baseElement.nextElementSibling;
          while (current) {
            nextElements.push(current);
            current = current.nextElementSibling;
          }
          return nextElements[index] === targetElement;
        }
      }
      
      if (selector.includes('.prevAll()')) {
        // Простой prevAll()
        if (selector.match(/\.prevAll\(\)$/)) {
          const prevElements = [];
          let current = baseElement.previousElementSibling;
          while (current) {
            prevElements.unshift(current);
            current = current.previousElementSibling;
          }
          return prevElements.length === 1 && prevElements[0] === targetElement;
        }
        
        // prevAll().eq(index)
        const prevAllEqMatch = selector.match(/\.prevAll\(\)\.eq\((\d+)\)/);
        if (prevAllEqMatch) {
          const index = parseInt(prevAllEqMatch[1]);
          const prevElements = [];
          let current = baseElement.previousElementSibling;
          while (current) {
            prevElements.unshift(current);
            current = current.previousElementSibling;
          }
          return prevElements[index] === targetElement;
        }
      }
      
      if (selector.includes('.parent()')) {
        return baseElement.parentElement === targetElement;
      }
      
      if (selector.includes('.parents(')) {
        const parentsTagMatch = selector.match(/\.parents\(['"]([^'"]+)['"]\)/);
        if (parentsTagMatch) {
          const tag = parentsTagMatch[1];
          let current = baseElement.parentElement;
          while (current) {
            if (current.tagName.toLowerCase() === tag && current === targetElement) {
              return true;
            }
            current = current.parentElement;
          }
          return false;
        }
      }
      
      return false;
    } catch {
      return false;
    }
  };

  // Поднимаемся к «осмысленной» цели
  function snapTarget(el){
    const originalEl = el; // Сохраняем исходный элемент
    // Если исходный элемент несёт осмысленный текст — считаем его целевым,
    // чтобы не подниматься до родителя с цифровым ID
    try {
      const origText = getElementText(originalEl);
      if (isGoodTextForContains(origText)) {
        return originalEl;
      }
    } catch {}
    // Если навели на «листовой» инлайн-элемент (иконка, одиночный span и т.п.) — не поднимаемся
    if (isLeafInlineElement(originalEl)) {
      return originalEl;
    }

    let cur = el, depth = 0;
    
    while (cur && depth < 6){
      if (cur.matches && (cur.matches(interestingSel) || cur.id || cur.getAttribute && prefDataAttrs.some(a=>cur.getAttribute(a)))) {
        // Если исходный элемент содержит хороший текст, сохраняем ссылку на него
        const originalText = getElementText(originalEl);
        if (isGoodTextForContains(originalText)) {
          cur._originalTextElement = originalEl;
        }
        return cur;
      }
      cur = cur.parentElement; 
      depth++;
    }
    return el;
  }

  // ==== Стратегии генерации (как в предыдущей версии) ====
  function byId(el){
    if (!el.id) return [];
    const id = el.id;
    const sel = `#${esc(id)}`;
    if (!isUnique(sel, el)) return [];
    // Если ID содержит цифры — исключаем из базовых: вернётся позже через uniqueWithinScope/агрессивные
    if (hasDigits(id)) return [];
    return [{ sel }];
  }
  function byPreferredData(el){
    const out=[];
    for(const a of prefDataAttrs){
      const v=el.getAttribute&&el.getAttribute(a);
      if(!v) continue;
      const s=`[${a}="${esc(v)}"]`;
      if(isUnique(s,el)) out.push({sel:s,score: hasDigits(v) ? 0 : 95});
      const s2=`${el.tagName.toLowerCase()}${s}`;
      if(isUnique(s2,el)) out.push({sel:s2,score: hasDigits(v) ? 0 : 93});
    }
    return out;
  }
  function byAnyData(el){
    const out=[];
    if(!el.attributes) return out;
    for(const {name,value} of el.attributes){
      if(!name.startsWith('data-')||!value) continue;
      const s=`[${name}="${esc(value)}"]`;
      if(isUnique(s,el)) out.push({sel:s,score: hasDigits(value) ? 0 : 85});
      const s2=`${el.tagName.toLowerCase()}${s}`;
      if(isUnique(s2,el)) out.push({sel:s2,score: hasDigits(value) ? 0 : 83});
    }
    return out;
  }
  function byAttr(el){
    const out=[];
    for(const a of okAttrs){
      const v=el.getAttribute&&el.getAttribute(a);
      if(!v) continue;
      const s=`[${a}="${esc(v)}"]`;
      if(isUnique(s,el)) out.push({sel:s,score: hasDigits(v) ? 0 : 80});
      const s2=`${el.tagName.toLowerCase()}${s}`;
      if(isUnique(s2,el)) out.push({sel:s2,score: hasDigits(v) ? 0 : 78});
    }
    const role=el.getAttribute&&el.getAttribute('role');
    const al=el.getAttribute&&el.getAttribute('aria-label');
    if(role&&al){
      const s=`[role="${esc(role)}"][aria-label="${esc(al)}"]`;
      if(isUnique(s,el)) out.push({sel:s,score: hasDigits(role)||hasDigits(al) ? 0 : 82});
    }
    return out;
  }
  function byClassCombos(el){ 
    const out=[]; 
    const classes=el.classList ? [...el.classList].filter(c => 
      c && 
      !looksDynamic(c) && 
      !c.startsWith('__dompick') // Исключаем служебные классы DOM Picker'а
    ).slice(0,4) : []; 
    
    for(const c of classes){ 
      const s=`.${esc(c)}`; 
      if(isUnique(s,el)) out.push({sel:s,score: hasDigits(c) ? 0 : 70}); 
      const s2=`${el.tagName.toLowerCase()}${s}`; 
      if(isUnique(s2,el)) out.push({sel:s2,score: hasDigits(c) ? 0 : 72}); 
    } 
    
    if(classes.length>=2){ 
      const [a,b]=classes; 
      const s=`.${esc(a)}.${esc(b)}`; 
      if(isUnique(s,el)) out.push({sel:s,score: (hasDigits(a)||hasDigits(b)) ? 0 : 73}); 
      const s2=`${el.tagName.toLowerCase()}${s}`; 
      if(isUnique(s2,el)) out.push({sel:s2,score: (hasDigits(a)||hasDigits(b)) ? 0 : 74}); 
    } 
    
    return out; 
  }
  function bySimilarAttrs(el){ const out=[]; const similarAttrs=findSimilarAttrs(el); for(const {name,value} of similarAttrs){ const s=`[${name}="${esc(value)}"]`; if(isUnique(s,el)) out.push({sel:s}); const s2=`${el.tagName.toLowerCase()}[${name}="${esc(value)}"]`; if(isUnique(s2,el)) out.push({sel:s2}); } return out; }

  // Построение JS-поиска по тексту в (необязательном) scope
  function buildJsFindInScope(scopeSelector, tagOrStar, text, visibleOnly){
    const safeScope = String(scopeSelector || '')
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'");
    const txt = String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const safeTag = String(tagOrStar || '*').replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const base = scopeSelector ? `(document.querySelector('${safeScope}')||document)` : 'document';
    const iife = `(()=>{ const baseEl=${base}; const list=Array.from(baseEl.querySelectorAll('${safeTag}')); let cand=list.filter(el=>el&&el.textContent&&el.textContent.includes('${txt}')); ${visibleOnly ? "cand=cand.filter(el=>el&&el.offsetParent!==null);" : ''} if(!cand.length) return null; const depth=(n)=>{let d=0; for(let p=n; p; p=p.parentElement) d++; return d;}; cand.sort((a,b)=>{ const da=depth(a), db=depth(b); if(da!==db) return db-da; const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect(); const aa=(ra.width||0)*(ra.height||0), ab=(rb.width||0)*(rb.height||0); return aa-ab; }); return cand[0]; })()`;
    return iife;
  }

  // Генерация команд по тексту
  function byCypressText(el) {
    const out = [];
    const texts = getAllTexts(el);
    const tag = el.tagName.toLowerCase();
    
    // Обрабатываем все найденные тексты
    for (const text of texts) {
      if (!isGoodTextForContains(text)) continue;
      
      const escapedText = text.replace(/'/g, "\\'");
      
      if (__dompickMode === 'js') {
        // Глобально уникальный текст
        if (isUniqueByText(el, text)) {
          out.push({ sel: buildJsFindInScope(null, '*', text, false), isJs: true });
        }
        // Уникален среди тега
        if (isUniqueByText(el, text, tag)) {
          out.push({ sel: buildJsFindInScope(null, tag, text, false), isJs: true });
        }
        // Специальные контейнеры (видимый)
        const specialContainer = el.closest('.datepicker, .modal, .modal-body, .modal-content, .modal-dialog, .dropdown, .popup, .overlay, .sidebar, .panel');
        if (specialContainer) {
          const containerClass = specialContainer.classList[0];
          if (containerClass && isUniqueByTextInParent(el, text, specialContainer)) {
            out.push({ sel: buildJsFindInScope(`.${containerClass}`, '*', text, true), isJs: true });
          }
        }
        // Уникальный контекст
        if (!isUniqueByText(el, text)) {
          const uniqueContext = findMinimalUniqueContext(el, text);
          if (uniqueContext) {
            out.push({ sel: buildJsFindInScope(uniqueContext, '*', text, false), isJs: true });
          }
        }
      } else {
        // Режим Cypress
        if (isUniqueByText(el, text)) {
          const containsCmd = `cy.contains('${escapedText}')`;
          out.push({sel: containsCmd, isCypress: true});
        }
        if (isUniqueByText(el, text, tag)) {
          const containsWithTagCmd = `cy.contains('${tag}', '${escapedText}')`;
          out.push({sel: containsWithTagCmd, isCypress: true});
        }
        const specialContainer = el.closest('.datepicker, .modal, .modal-body, .modal-content, .modal-dialog, .dropdown, .popup, .overlay, .sidebar, .panel');
        if (specialContainer) {
          const containerClass = specialContainer.classList[0];
          if (containerClass && isUniqueByTextInParent(el, text, specialContainer)) {
            const visibleContainsCmd = `cy.get('.${containerClass}').filter(':visible').contains('${escapedText}')`;
            out.push({sel: visibleContainsCmd, isCypress: true});
          }
        }
        if (!isUniqueByText(el, text)) {
          const uniqueContext = findMinimalUniqueContext(el, text);
          if (uniqueContext) {
            const contextContainsCmd = `cy.get('${uniqueContext}').contains('${escapedText}')`;
            out.push({sel: contextContainsCmd, isCypress: true});
          }
        }
      }
    }
    
    return out;
  }
  
  // Генерация комбинированных Cypress команд (селектор + текст)
  function byCypressCombo(el) {
    const out = [];
    const texts = getAllTexts(el);
    
    // Обрабатываем все найденные тексты
    for (const text of texts) {
      if (!isGoodTextForContains(text)) continue;
      
      const escapedText = text.replace(/'/g, "\\'");
      
      // ПРИНЦИП: ВСЕГДА используем уникальный контекст для cy.get().contains()
      // Ищем уникальные предки для комбинации get().contains()
      let p = el.parentElement, depth = 0;
      
      while (p && depth < 4) { // Увеличиваем глубину поиска
        // Проверяем ID предка (высший приоритет)
        if (p.id) {
          const parentSel = `#${esc(p.id)}`;
          if (document.querySelectorAll(parentSel).length === 1) {
            if (isUniqueByTextInParent(el, text, p)) {
              if (__dompickMode === 'js') {
                out.push({ sel: buildJsFindInScope(parentSel, '*', text, false), isJs: true });
              } else {
                const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
                out.push({sel: cmd, isCypress: true});
              }
            }
          }
        }
        
        // Проверяем предпочтительные data-атрибуты предка
        for (const attr of prefDataAttrs) {
          const value = p.getAttribute(attr);
          if (value) {
            const parentSel = `[${attr}="${esc(value)}"]`;
            if (document.querySelectorAll(parentSel).length === 1) {
              if (isUniqueByTextInParent(el, text, p)) {
                if (__dompickMode === 'js') {
                  out.push({ sel: buildJsFindInScope(parentSel, '*', text, false), isJs: true });
                } else {
                  const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
                  out.push({sel: cmd, isCypress: true});
                }
              }
            }
          }
        }
        
        // Проверяем уникальные классы предка
        if (p.classList && p.classList.length > 0) {
          const stableClasses = [...p.classList].filter(c => 
            c && 
            !looksDynamic(c) && 
            !c.startsWith('__dompick') &&
            c.length > 2
          );
          
          // Одиночные классы
          for (const cls of stableClasses.slice(0, 2)) {
            const parentSel = `.${esc(cls)}`;
            if (document.querySelectorAll(parentSel).length === 1) {
              if (isUniqueByTextInParent(el, text, p)) {
                if (__dompickMode === 'js') {
                  out.push({ sel: buildJsFindInScope(parentSel, '*', text, false), isJs: true });
                } else {
                  const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
                  out.push({sel: cmd, isCypress: true});
                }
              }
            }
          }
          
          // Комбинации классов
          if (stableClasses.length >= 2) {
            const parentSel = `.${esc(stableClasses[0])}.${esc(stableClasses[1])}`;
            if (document.querySelectorAll(parentSel).length === 1) {
              if (isUniqueByTextInParent(el, text, p)) {
                if (__dompickMode === 'js') {
                  out.push({ sel: buildJsFindInScope(parentSel, '*', text, false), isJs: true });
                } else {
                  const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
                  out.push({sel: cmd, isCypress: true});
                }
              }
            }
          }
        }
        
        // Семантические контейнеры как контекст
        const semanticContainers = ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form'];
        const parentTag = p.tagName.toLowerCase();
        if (semanticContainers.includes(parentTag)) {
          if (isUniqueByTextInParent(el, text, p)) {
            const sameTagContainers = document.querySelectorAll(parentTag);
            if (sameTagContainers.length <= 2) { // Только если семантический тег почти уникален
              if (__dompickMode === 'js') {
                out.push({ sel: buildJsFindInScope(parentTag, '*', text, false), isJs: true });
              } else {
                const cmd = `cy.get('${parentTag}').contains('${escapedText}')`;
                out.push({sel: cmd, isCypress: true});
              }
            }
          }
        }
        
        p = p.parentElement;
        depth++;
      }
    }
    
    return out;
  }
  function uniqueWithinScope(el) {
    // Собираем уникальные предки (scopes)
    const scopes = [];
    let p = el.parentElement, depth = 0;
    
    while (p && depth < 5) {
      if (p.id && !hasDigits(p.id)) {
        const idSel = `#${esc(p.id)}`;
        if (document.querySelectorAll(idSel).length === 1) {
          scopes.push(idSel);
        }
      }
      
      for (const a of prefDataAttrs) {
        const v = p.getAttribute(a);
        if (v) {
          const ds = `[${a}="${esc(v)}"]`;
          if (document.querySelectorAll(ds).length === 1) {
            // Контексты с цифрами оставляем, но понизим их оценку позже
            scopes.push(ds);
          }
        }
      }
      
      p = p.parentElement;
      depth++;
    }
    
    // Собираем "атрибутные атомы" для элемента
    const attributeAtoms = [];
    
    // Предпочтительные data-атрибуты
    for (const attr of prefDataAttrs) {
      const value = el.getAttribute(attr);
      if (value) {
        attributeAtoms.push(`[${attr}="${esc(value)}"]`);
      }
    }
    
    // Любые data-атрибуты
    if (el.attributes) {
      for (const {name, value} of el.attributes) {
        if (name.startsWith('data-') && value && !prefDataAttrs.includes(name)) {
          attributeAtoms.push(`[${name}="${esc(value)}"]`);
        }
      }
    }
    
         // Обычные атрибуты
     for (const attr of okAttrs) {
       const value = el.getAttribute(attr);
       if (value) {
         attributeAtoms.push(`[${attr}="${esc(value)}"]`);
       }
     }
     
     // Похожие атрибуты (автообнаружение)
     const similarAttrs = findSimilarAttrs(el);
     for (const {name, value} of similarAttrs) {
       attributeAtoms.push(`[${name}="${esc(value)}"]`);
     }
    
    // Комбинации role + aria-label
    const role = el.getAttribute('role');
    const ariaLabel = el.getAttribute('aria-label');
    if (role && ariaLabel) {
      attributeAtoms.push(`[role="${esc(role)}"][aria-label="${esc(ariaLabel)}"]`);
    }
    
         // Классы (только нединамические и не служебные)
     if (el.classList) {
       const classes = [...el.classList].filter(c => 
         c && 
         !looksDynamic(c) && 
         !c.startsWith('__dompick') // Исключаем служебные классы
       ).slice(0, 3);
       
       for (const cls of classes) {
         attributeAtoms.push(`.${esc(cls)}`);
       }
       // Комбинация двух классов
       if (classes.length >= 2) {
         attributeAtoms.push(`.${esc(classes[0])}.${esc(classes[1])}`);
       }
     }
    
    // Тестируем атомы только в рамках найденных уникальных предков
    const out = [];
    const tag = el.tagName.toLowerCase();
    
    for (const scope of scopes) {
      for (const atom of attributeAtoms) {
        // Тестируем атом как есть (избегаем цифровых контекстов)
        const selector1 = `${scope} ${atom}`;
        if (isUnique(selector1, el)) {
          out.push({sel: selector1, score: /\d/.test(scope) || /\d/.test(atom) ? 80 : 90});
        }
        
        // Тестируем с прямым потомком
        const selector2 = `${scope} > ${atom}`;
        if (isUnique(selector2, el)) {
          out.push({sel: selector2, score: /\d/.test(scope) || /\d/.test(atom) ? 82 : 92});
        }
        
        // Тестируем с тегом + атом
        const selector3 = `${scope} ${tag}${atom}`;
        if (isUnique(selector3, el)) {
          out.push({sel: selector3, score: /\d/.test(scope) || /\d/.test(atom) ? 78 : 88});
        }
        
        // Тестируем с тегом + атом как прямой потомок
        const selector4 = `${scope} > ${tag}${atom}`;
        if (isUnique(selector4, el)) {
          out.push({sel: selector4, score: /\d/.test(scope) || /\d/.test(atom) ? 79 : 89});
        }
      }
      
      // Если нет атрибутных атомов, используем только тег
      if (attributeAtoms.length === 0) {
        const selector5 = `${scope} ${tag}`;
        if (isUnique(selector5, el)) {
          out.push({sel: selector5, score: /\d/.test(scope) ? 75 : 85});
        }
        
        const selector6 = `${scope} > ${tag}`;
        if (isUnique(selector6, el)) {
          out.push({sel: selector6, score: /\d/.test(scope) ? 77 : 87});
        }
      }
    }
    
    return out;
  }
  function nthPath(el){
    const parts=[];
    let cur=el;
    let usedStableId = false;
    while(cur && cur.nodeType===1 && parts.length<8){
      if(cur.id && !hasDigits(cur.id)){
        parts.unshift(`#${esc(cur.id)}`);
        usedStableId = true;
        break;
      }
      const tag=cur.tagName.toLowerCase();
      const p=cur.parentElement;
      parts.unshift(tag);
      cur=p;
    }
    const sel=parts.join(' > ');
    return isUnique(sel,el)?[{sel,score: usedStableId ? 62 : 58}]:[];
  }
  
  // Структурные селекторы с nth-child
  function byNthChild(el) {
    const out = [];
    const parent = el.parentElement;
    if (!parent) return out;
    
    const tag = el.tagName.toLowerCase();
    const siblings = [...parent.children];
    const index = siblings.indexOf(el) + 1;
    
    // nth-child по позиции среди всех детей
    const nthChildSel = `${tag}:nth-child(${index})`;
    if (isUnique(nthChildSel, el)) {
      out.push({sel: nthChildSel});
    }
    
    // nth-of-type по позиции среди элементов того же типа
    const sameTypeSiblings = siblings.filter(s => s.tagName === el.tagName);
    if (sameTypeSiblings.length > 1) {
      const typeIndex = sameTypeSiblings.indexOf(el) + 1;
      const nthOfTypeSel = `${tag}:nth-of-type(${typeIndex})`;
      if (isUnique(nthOfTypeSel, el)) {
        out.push({sel: nthOfTypeSel});
      }
    }
    
    // first-child, last-child
    if (index === 1) {
      const firstChildSel = `${tag}:first-child`;
      if (isUnique(firstChildSel, el)) {
        out.push({sel: firstChildSel});
      }
    }
    
    if (index === siblings.length) {
      const lastChildSel = `${tag}:last-child`;
      if (isUnique(lastChildSel, el)) {
        out.push({sel: lastChildSel});
      }
    }
    
    return out;
  }
  
  // Селекторы по родительским элементам с nth-child
  function byParentWithNth(el) {
    const out = [];
    const parent = el.parentElement;
    if (!parent) return out;
    
    const tag = el.tagName.toLowerCase();
    const siblings = [...parent.children];
    const index = siblings.indexOf(el) + 1;
    
    // Поиск родителей с ID или классами
    let currentParent = parent;
    let depth = 0;
    
    while (currentParent && depth < 3) {
      // Родитель с ID
      if (currentParent.id) {
        const parentSel = `#${esc(currentParent.id)}`;
        const childSel = `${parentSel} > ${tag}:nth-child(${index})`;
        if (isUnique(childSel, el)) {
          out.push({sel: childSel});
        }
      }
      
      // Родитель с классами
      if (currentParent.classList && currentParent.classList.length > 0) {
        const classes = [...currentParent.classList].filter(c => 
          c && 
          !looksDynamic(c) && 
          !c.startsWith('__dompick') // Исключаем служебные классы
        ).slice(0, 2);
        
        if (classes.length > 0) {
          const parentSel = `.${classes.map(c => esc(c)).join('.')}`;
          const childSel = `${parentSel} > ${tag}:nth-child(${index})`;
          if (isUnique(childSel, el)) {
            out.push({sel: childSel});
          }
        }
      }
      
      currentParent = currentParent.parentElement;
      depth++;
    }
    
    return out;
  }
  
  // Комбинированные селекторы с соседними элементами
  function bySiblingSelectors(el) {
    const out = [];
    const parent = el.parentElement;
    if (!parent) return out;
    
    const tag = el.tagName.toLowerCase();
    const siblings = [...parent.children];
    const index = siblings.indexOf(el);
    
    // Селектор через предыдущий соседний элемент
    if (index > 0) {
      const prevSibling = siblings[index - 1];
      if (prevSibling.id) {
        const siblingId = `#${esc(prevSibling.id)}`;
        const adjacentSel = `${siblingId} + ${tag}`;
        if (isUnique(adjacentSel, el)) {
          out.push({sel: adjacentSel});
        }
      }
      
      if (prevSibling.classList && prevSibling.classList.length > 0) {
        const classes = [...prevSibling.classList].filter(c => 
          c && 
          !looksDynamic(c) && 
          !c.startsWith('__dompick') // Исключаем служебные классы
        ).slice(0, 1);
        
        if (classes.length > 0) {
          const siblingClass = `.${esc(classes[0])}`;
          const adjacentSel = `${siblingClass} + ${tag}`;
          if (isUnique(adjacentSel, el)) {
            out.push({sel: adjacentSel});
          }
        }
      }
    }
    
    return out;
  }
  
  // Специальные селекторы для календарей и подобных компонентов
  function byCalendarSelectors(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.trim();
    
    // СТРОГАЯ проверка, что это именно элемент календаря
    const datepickerContainer = el.closest('.datepicker');
    const calendarContainer = el.closest('[class*="calendar"]');
    const dateContainer = el.closest('[class*="date"]');
    
    // Проверяем только если элемент ДЕЙСТВИТЕЛЬНО в календаре
    if (!datepickerContainer && !calendarContainer && !dateContainer) {
      return out;
    }
    
    // Дополнительная проверка для td - должен быть в календарной таблице
    if (tag === 'td') {
      const table = el.closest('table');
      if (!table) return out;
      
      // Проверяем, что таблица содержит календарные элементы
      const hasCalendarClasses = table.querySelector('.day, .today, .active, .month, .year');
      if (!hasCalendarClasses) return out;
    }
    
    // Селекторы только для datepicker календарей
    if (datepickerContainer && tag === 'td' && text && /^\d+$/.test(text)) {
      const dayNumber = text;
      
      // Проверяем, что .datepicker действительно существует в документе
      if (document.querySelector('.datepicker')) {
        // Поиск по тексту в видимом календаре - с проверкой
        const visibleCalendarSel = `cy.get('.datepicker').filter(':visible').contains('${dayNumber}')`;
        // Проверяем, что этот селектор действительно найдет наш элемент
        const testElements = document.querySelectorAll('.datepicker');
        let foundInDatepicker = false;
        for (const dp of testElements) {
          if (dp.contains(el)) {
            foundInDatepicker = true;
            break;
          }
        }
        
        if (foundInDatepicker) {
          out.push({sel: visibleCalendarSel, isCypress: true});
          
          // Поиск в datepicker-days только если такой элемент существует
          if (document.querySelector('.datepicker-days')) {
            const activeDaysSel = `cy.get('.datepicker-days:visible td').contains('${dayNumber}')`;
            out.push({sel: activeDaysSel, isCypress: true});
          }
        }
      }
      
      // Селекторы относительно today элемента - только если today существует
      const todayElement = datepickerContainer.querySelector('td.today');
      if (todayElement) {
        const allDays = [...datepickerContainer.querySelectorAll('td.day, td.today, td.active')];
        const todayIndex = allDays.indexOf(todayElement);
        const currentIndex = allDays.indexOf(el);
        
        if (todayIndex >= 0 && currentIndex >= 0) {
          const diff = currentIndex - todayIndex;
          if (diff !== 0) {
            const relativeSel = diff > 0 
              ? `cy.get('.datepicker').filter(':visible').find('td.today').nextAll('td').eq(${diff - 1})`
              : `cy.get('.datepicker').filter(':visible').find('td.today').prevAll('td').eq(${Math.abs(diff) - 1})`;
            out.push({sel: relativeSel, isCypress: true});
          }
        }
      }
    }
    
    return out;
  }
  
  function buildCandidates(original) {
    const el = snapTarget(original);
    
    // Собираем все возможные селекторы
    const allSelectors = collectAllSelectors(el);
    
    // Группируем селекторы по типам
    const groups = categorizeSelectors(allSelectors);
    
    return {
      basicSelectors: groups.basic.slice(0, 3),      // Первые 3 без .contains и nth-child
      containsSelectors: groups.contains.slice(0, 3), // 4,5,6 с .contains
      nthSelectors: groups.nth.slice(0, 3),          // 7,8,9 с nth-child
      
      // Резервные селекторы для кнопок "ещё вариантов"
      moreBasic: groups.basic.slice(3),
      moreContains: groups.contains.slice(3),
      moreNth: groups.nth.slice(3),
      
      // Дополнительные агрессивные селекторы
      aggressive: groups.aggressive
    };
  }

  // Собираем все возможные селекторы
  function collectAllSelectors(el) {
    const allSelectors = [];
    const candidatesMap = new Map();

    // Добавляем селекторы порциями, проверяя бюджет
    const addBatch = (batch) => {
      for (const item of batch) {
        if (budgetExpired()) break;
        if (!candidatesMap.has(item.sel)) {
          if (item.isCypress) {
            if (validateCypressSelector(item.sel, el)) {
              item.__targetEl = el;
              candidatesMap.set(item.sel, item);
              allSelectors.push(item);
            }
          } else {
            item.__targetEl = el;
            candidatesMap.set(item.sel, item);
            allSelectors.push(item);
          }
        }
      }
    };

    // 1) Самые быстрые стратегии
    // Сначала стратегии без цифр (score уже понижен внутри)
    addBatch(byStableScopePath(el));
    addBatch(byClassCombos(el));
    addBatch(byAttr(el));
    addBatch(byPreferredData(el));
    addBatch(byId(el));

    // 2) Остальные базовые
    addBatch(byAnyData(el));
    addBatch(uniqueWithinScope(el));
    addBatch(nthPath(el));

    // 3) Текстовые (дорогие) — после базовых
    if (!budgetExpired()) addBatch(byCypressText(el));
    if (!budgetExpired()) addBatch(byCypressCombo(el));
    // Явный короткий текстовый селектор внутри стабильного scope
    const scope = findStableScope(el);
    if (scope) {
      const texts = getAllTexts(el).filter(t => isGoodTextForContains(t));
      const shortText = texts.find(t => t.length <= 25);
      if (shortText) {
        if (__dompickMode === 'js') {
          addBatch([{ sel: buildJsFindInScope(scope.scopeSelector, '*', shortText, false) }]);
        } else {
          const escaped = shortText.replace(/'/g, "\\'");
          const sel1 = `cy.get('${scope.scopeSelector}').contains('${escaped}')`;
          addBatch([{ sel: sel1, isCypress: true }]);
        }
      }
    }

    // 4) Позиционные
    if (!budgetExpired()) addBatch(byNthChild(el));
    if (!budgetExpired()) addBatch(byParentWithNth(el));
    if (!budgetExpired()) addBatch(bySiblingSelectors(el));
    if (!budgetExpired()) addBatch(byCalendarSelectors(el));

    // 5) Агрессивные — включаем всегда (с приоритетом ниже)
    if (!budgetExpired()) addBatch(generateAggressiveFallbacks(el));
    if (!budgetExpired()) addBatch(generateSuperAggressiveFallbacks(el));

    return allSelectors;
  }

  // Категоризация селекторов по группам
  function categorizeSelectors(selectors) {
    const groups = {
      basic: [],      // Без .contains и nth-child
      contains: [],   // С .contains
      nth: [],        // С nth-child
      aggressive: []  // Агрессивные fallback
    };
    
    for (const selector of selectors) {
      const sel = selector.sel;
      
      // contains → contains
      if (sel.includes('cy.contains') || sel.includes('.contains(')) {
        groups.contains.push(selector);
        continue;
      }
      // nth → nth
      if (sel.includes('nth-child') || sel.includes('nth-of-type') || 
          sel.includes(':first-child') || sel.includes(':last-child') ||
          sel.includes(':only-child') || sel.includes(':first-of-type') ||
          sel.includes(':last-of-type') || sel.includes(':only-of-type') ||
          sel.includes('nth(') || sel.includes('eq(')) {
        groups.nth.push(selector);
        continue;
      }
      // Агрессивные по структуре (вместо старого порога score)
      if (isAggressiveSelector(sel)) {
        groups.aggressive.push(selector);
        continue;
      }
      groups.basic.push(selector);
    }
    
    // Динамическая сортировка по новому рейтингу
    const sortByQuality = (a, b) => {
      const aScore = computeSelectorScore(a, a.__targetEl || null);
      const bScore = computeSelectorScore(b, b.__targetEl || null);
      if (aScore !== bScore) return bScore - aScore;
      // При равенстве — более короткий лучше
      return a.sel.length - b.sel.length;
    };
    
    groups.basic.sort(sortByQuality);
    groups.contains.sort(sortByQuality);
    groups.nth.sort(sortByQuality);
    groups.aggressive.sort(sortByQuality);
    
    return groups;
  }
  
  // Агрессивные fallback селекторы для крайних случаев
  function generateAggressiveFallbacks(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    
    // 1. Селекторы с уникальными родителями + nth-child
    const parentWithNthSelectors = generateParentNthSelectors(el);
    out.push(...parentWithNthSelectors);
    
    // 2. Селекторы по позиции в документе (только если уникальные)
    const allSameTagElements = document.querySelectorAll(tag);
    const elementIndex = [...allSameTagElements].indexOf(el);
    if (elementIndex >= 0) {
      const nthSel = `${tag}:nth-of-type(${elementIndex + 1})`;
      if (isUnique(nthSel, el)) {
        out.push({sel: nthSel});
      }
    }
    
    // 3. Селектор по тексту для JS-режима: выбираем ближайший визуально подходящий узел
    const textContent = el.textContent?.trim();
    if (textContent && textContent.length > 0 && textContent.length < 50) {
      const sample = textContent.length > 25 ? textContent.substring(0, 25) : textContent;
      if (__dompickMode === 'js') {
        const jsExpr = buildJsFindInScope(null, '*', sample, false);
        out.push({ sel: jsExpr, __targetEl: el });
      } else {
        const partialText = sample;
        if (partialText.length > 2) {
          const uniqueContext = findMinimalUniqueContext(el, partialText);
          if (uniqueContext) {
            const contextContainsSel = `cy.get('${uniqueContext}').contains('${partialText.replace(/'/g, "\\'")}')`;
            out.push({sel: contextContainsSel, isCypress: true});
          } else if (isUniqueByText(el, partialText)) {
            const containsSel = `cy.contains('${partialText.replace(/'/g, "\\'")}')`;
            out.push({sel: containsSel, isCypress: true});
          }
        }
      }
    }
    
    // 4. Селекторы по атрибутам (только уникальные)
    if (el.attributes) {
      for (const {name, value} of el.attributes) {
        if (name && value && value.length < 50 && !looksDynamic(value)) {
          // Фильтруем системные классы DOM Picker'а
          if (name === 'class' && value.includes('__dompick')) continue;
          
          const attrSel = `[${name}="${esc(value)}"]`;
          if (isUnique(attrSel, el)) {
            out.push({sel: attrSel});
          }
          
          const tagAttrSel = `${tag}[${name}="${esc(value)}"]`;
          if (isUnique(tagAttrSel, el)) {
            out.push({sel: tagAttrSel});
          }
        }
      }
    }
    
    // 5. Селекторы по классам (только стабильные и уникальные)
    if (el.classList && el.classList.length > 0) {
      const stableClasses = [...el.classList].filter(c => 
        c && 
        !looksDynamic(c) && 
        !c.startsWith('__dompick') && // Исключаем наши служебные классы
        c.length > 1
      );
      
      for (const cls of stableClasses.slice(0, 3)) {
        const classSel = `.${esc(cls)}`;
        if (isUnique(classSel, el)) {
          out.push({sel: classSel});
        }
        
        const tagClassSel = `${tag}.${esc(cls)}`;
        if (isUnique(tagClassSel, el)) {
          out.push({sel: tagClassSel});
        }
      }
    }
    
    // 6. Простой селектор по тегу только если он уникален
    if (isUnique(tag, el)) {
      out.push({sel: tag});
    }
    
    // 7. Минимальный уникальный позиционный селектор (короткий суффикс абсолютного пути)
    const minimalPositional = buildMinimalPositionalSelector(el);
    if (minimalPositional) {
      out.push({ sel: minimalPositional });
    }
    
    // 8. Абсолютный CSS-путь (как самый низкоприоритетный запасной вариант)
    out.push({ sel: buildAbsoluteCssPath(el) });
    
    return out;
  }

  // Абсолютный CSS-путь к элементу: html > body > ... > tag:nth-of-type(n)
  function buildAbsoluteCssPath(el) {
    try {
      const parts = [];
      let current = el;
      const stopAt = document.documentElement; // html
      while (current && current !== stopAt) {
        const parent = current.parentElement;
        if (!parent) break;
        const tag = current.tagName.toLowerCase();
        const sameTagSiblings = [...parent.children].filter(c => c.tagName.toLowerCase() === tag);
        const index = sameTagSiblings.indexOf(current);
        // Если среди детей родителя этот tag встречается один раз, nth-of-type не нужен
        const part = sameTagSiblings.length === 1 || index < 0 ? tag : `${tag}:nth-of-type(${index + 1})`;
        parts.unshift(part);
        current = parent;
      }
      return parts.length ? parts.join(' > ') : el.tagName.toLowerCase();
    } catch {
      return el.tagName ? el.tagName.toLowerCase() : '*';
    }
  }

  // Строит массив сегментов абсолютного пути от корня к элементу
  function buildAbsoluteCssSegments(el) {
    const segments = [];
    let current = el;
    const stopAt = document.documentElement; // html
    while (current && current !== stopAt) {
      const parent = current.parentElement;
      if (!parent) break;
      const tag = current.tagName.toLowerCase();
      const sameTagSiblings = [...parent.children].filter(c => c.tagName.toLowerCase() === tag);
      const index = sameTagSiblings.indexOf(current);
      const needsNth = !(sameTagSiblings.length === 1 || index < 0);
      segments.unshift({ tag, index: index + 1, needsNth });
      current = parent;
    }
    return segments;
  }

  // Возвращает самый короткий уникальный позиционный селектор (суффикс абсолютного пути)
  function buildMinimalPositionalSelector(el) {
    try {
      const segments = buildAbsoluteCssSegments(el);
      if (segments.length === 0) return el.tagName.toLowerCase();
      // Функция преобразования сегментов в селекторную строку
      const joinFrom = (startIdx) => segments
        .slice(startIdx)
        .map(seg => seg.needsNth ? `${seg.tag}:nth-of-type(${seg.index})` : seg.tag)
        .join(' > ');
      
      // Проверяем суффиксы от самого короткого (лист) к более длинным
      for (let i = segments.length - 1; i >= 0; i--) {
        const candidate = joinFrom(i);
        if (isUnique(candidate, el)) return candidate;
        // Попробуем локально упростить листовой сегмент, если возможно
        if (i === segments.length - 1) {
          const leaf = segments[segments.length - 1];
          if (leaf.needsNth) {
            const withoutNth = joinFrom(i).replace(/:nth-of-type\(\d+\)$/,'');
            if (isUnique(withoutNth, el)) return withoutNth;
          }
        }
      }
      // Если ни один суффикс не уникален — возвращаем полный путь
      return joinFrom(0);
    } catch {
      return buildAbsoluteCssPath(el);
    }
  }

  // Генерация селекторов с уникальными родителями + nth-child
  function generateParentNthSelectors(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    let currentParent = el.parentElement;
    let depth = 0;
    const maxDepth = 6;
    
    while (currentParent && depth < maxDepth) {
      // Получаем позицию элемента среди детей родителя
      const siblings = [...currentParent.children];
      const elementIndex = siblings.indexOf(el) + 1;
      
      // 1. Родитель с ID + nth-child
      if (currentParent.id) {
        const parentId = `#${esc(currentParent.id)}`;
        if (document.querySelectorAll(parentId).length === 1) {
          // Различные варианты nth-child
          const selectors = [
            `${parentId} > ${tag}:nth-child(${elementIndex})`,
            `${parentId} > :nth-child(${elementIndex})`,
            `${parentId} ${tag}:nth-child(${elementIndex})`
          ];
          
          for (const sel of selectors) {
              if (isUnique(sel, el)) {
                out.push({sel});
              }
          }
        }
      }
      
      // 2. Родитель с data-атрибутами + nth-child
      for (const attr of prefDataAttrs) {
        const value = currentParent.getAttribute(attr);
        if (value) {
          const parentSel = `[${attr}="${esc(value)}"]`;
          if (document.querySelectorAll(parentSel).length === 1) {
            const selectors = [
              `${parentSel} > ${tag}:nth-child(${elementIndex})`,
              `${parentSel} > :nth-child(${elementIndex})`,
              `${parentSel} ${tag}:nth-child(${elementIndex})`
            ];
            
            for (const sel of selectors) {
              if (isUnique(sel, el)) {
                out.push({sel});
              }
            }
          }
        }
      }
      
      // 3. Родитель с уникальными классами + nth-child
      if (currentParent.classList && currentParent.classList.length > 0) {
        const stableClasses = [...currentParent.classList].filter(c => 
          c && 
          !looksDynamic(c) && 
          !c.startsWith('__dompick') &&
          c.length > 2
        );
        
        // Одиночные классы
        for (const cls of stableClasses.slice(0, 2)) {
          const parentSel = `.${esc(cls)}`;
          if (document.querySelectorAll(parentSel).length === 1) {
            const selectors = [
              `${parentSel} > ${tag}:nth-child(${elementIndex})`,
              `${parentSel} > :nth-child(${elementIndex})`,
              `${parentSel} ${tag}:nth-child(${elementIndex})`
            ];
            
            for (const sel of selectors) {
              if (isUnique(sel, el)) {
                out.push({sel});
              }
            }
          }
        }
        
        // Комбинации классов
        if (stableClasses.length >= 2) {
          const parentSel = `.${esc(stableClasses[0])}.${esc(stableClasses[1])}`;
          if (document.querySelectorAll(parentSel).length === 1) {
            const selectors = [
              `${parentSel} > ${tag}:nth-child(${elementIndex})`,
              `${parentSel} > :nth-child(${elementIndex})`
            ];
            
            for (const sel of selectors) {
              if (isUnique(sel, el)) {
                out.push({sel});
              }
            }
          }
        }
      }
      
      // 4. Семантические родители + nth-child
      const semanticTags = ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form', 'table', 'tbody', 'thead', 'ul', 'ol', 'dl'];
      const parentTag = currentParent.tagName.toLowerCase();
      if (semanticTags.includes(parentTag)) {
        const sameTagParents = document.querySelectorAll(parentTag);
        if (sameTagParents.length <= 3) {
          const selectors = [
            `${parentTag} > ${tag}:nth-child(${elementIndex})`,
            `${parentTag} > :nth-child(${elementIndex})`
          ];
          
          for (const sel of selectors) {
            if (isUnique(sel, el)) {
              out.push({sel});
            }
          }
        }
      }
      
      currentParent = currentParent.parentElement;
      depth++;
    }
    
    return out;
  }

  // Супер-агрессивные fallback селекторы для экстремальных случаев
  function generateSuperAggressiveFallbacks(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    
    // 1. Глубокие nth-child цепочки
    const deepNthSelectors = generateDeepNthSelectors(el);
    out.push(...deepNthSelectors);
    
    // 2. Селекторы через соседние элементы
    const siblingSelectors = generateAdvancedSiblingSelectors(el);
    out.push(...siblingSelectors);
    
    // 3. Комбинированные селекторы с частичными атрибутами
    const partialAttrSelectors = generatePartialAttributeSelectors(el);
    out.push(...partialAttrSelectors);
    
    // 4. Селекторы по псевдо-классам
    const pseudoSelectors = generatePseudoClassSelectors(el);
    out.push(...pseudoSelectors);
    
    // 5. Относительные Cypress селекторы
    const relativeCypressSelectors = generateRelativeCypressSelectors(el);
    out.push(...relativeCypressSelectors);
    
    return out;
  }

  // Генерация глубоких nth-child цепочек
  function generateDeepNthSelectors(el) {
    const out = [];
    let current = el;
    const path = [];
    let depth = 0;
    const maxDepth = 4;
    
    // Строим путь от элемента к родителям
    while (current && current.parentElement && depth < maxDepth) {
      const parent = current.parentElement;
      const siblings = [...parent.children];
      const index = siblings.indexOf(current) + 1;
      const tag = current.tagName.toLowerCase();
      
      path.unshift({tag, index});
      current = parent;
      depth++;
      
      // Проверяем, есть ли у текущего родителя уникальные идентификаторы
      if (current.id) {
        const rootSel = `#${esc(current.id)}`;
        if (document.querySelectorAll(rootSel).length === 1) {
          const pathSel = path.map(p => `${p.tag}:nth-child(${p.index})`).join(' > ');
          const fullSel = `${rootSel} > ${pathSel}`;
          if (isUnique(fullSel, el)) {
            out.push({sel: fullSel});
          }
          break; // Нашли уникальный корень
        }
      }
      
      // Проверяем data-атрибуты
      for (const attr of prefDataAttrs.slice(0, 2)) {
        const value = current.getAttribute && current.getAttribute(attr);
        if (value) {
          const rootSel = `[${attr}="${esc(value)}"]`;
          if (document.querySelectorAll(rootSel).length === 1) {
            const pathSel = path.map(p => `${p.tag}:nth-child(${p.index})`).join(' > ');
            const fullSel = `${rootSel} > ${pathSel}`;
            if (isUnique(fullSel, el)) {
              out.push({sel: fullSel});
            }
            break;
          }
        }
      }
    }
    
    return out;
  }

  // Продвинутые селекторы через соседние элементы
  function generateAdvancedSiblingSelectors(el) {
    const out = [];
    const parent = el.parentElement;
    if (!parent) return out;
    
    const tag = el.tagName.toLowerCase();
    const siblings = [...parent.children];
    const index = siblings.indexOf(el);
    
    // Селекторы через предыдущие соседние элементы
    for (let i = Math.max(0, index - 3); i < index; i++) {
      const prevSibling = siblings[i];
      if (!prevSibling) continue;
      
      // По ID предыдущего элемента
      if (prevSibling.id) {
        const siblingId = `#${esc(prevSibling.id)}`;
        const distance = index - i;
        
        if (distance === 1) {
          const adjSel = `${siblingId} + ${tag}`;
          if (isUnique(adjSel, el)) {
            out.push({sel: adjSel});
          }
        } else {
          const genSel = `${siblingId} ~ ${tag}:nth-of-type(${distance})`;
          if (isUnique(genSel, el)) {
            out.push({sel: genSel});
          }
        }
      }
      
      // По классам предыдущего элемента
      if (prevSibling.classList && prevSibling.classList.length > 0) {
        const stableClasses = [...prevSibling.classList].filter(c => 
          c && !looksDynamic(c) && !c.startsWith('__dompick')
        );
        
        for (const cls of stableClasses.slice(0, 1)) {
          const siblingClass = `.${esc(cls)}`;
          const distance = index - i;
          
          if (distance === 1) {
            const adjSel = `${siblingClass} + ${tag}`;
            if (isUnique(adjSel, el)) {
              out.push({sel: adjSel});
            }
          }
        }
      }
    }
    
    return out;
  }

  // Селекторы с частичными атрибутами
  function generatePartialAttributeSelectors(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    
    if (!el.attributes) return out;
    
    for (const {name, value} of el.attributes) {
      if (!value || value.length < 3 || looksDynamic(value)) continue;
      if (name === 'class' && value.includes('__dompick')) continue;
      
      // Селекторы с частичным совпадением атрибутов
      if (value.length > 10) {
        const partialValue = value.substring(0, Math.min(value.length - 2, 15));
        const partialSel = `${tag}[${name}^="${esc(partialValue)}"]`;
        if (isUnique(partialSel, el)) {
          out.push({sel: partialSel});
        }
      }
      
      // Селекторы по окончанию атрибута
      if (value.length > 8) {
        const endValue = value.substring(Math.max(0, value.length - 10));
        const endSel = `${tag}[${name}$="${esc(endValue)}"]`;
        if (isUnique(endSel, el)) {
          out.push({sel: endSel});
        }
      }
      
      // Селекторы по содержимому атрибута
      if (value.includes('-') || value.includes('_')) {
        const parts = value.split(/[-_]/);
        for (const part of parts) {
          if (part.length > 3 && !looksDynamic(part)) {
            const containsSel = `${tag}[${name}*="${esc(part)}"]`;
            if (isUnique(containsSel, el)) {
              out.push({sel: containsSel});
            }
          }
        }
      }
    }
    
    return out;
  }

  // Селекторы по псевдо-классам
  function generatePseudoClassSelectors(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) return out;
    
    const siblings = [...parent.children];
    const index = siblings.indexOf(el);
    const sameTagSiblings = siblings.filter(s => s.tagName === el.tagName);
    const sameTagIndex = sameTagSiblings.indexOf(el);
    
    // :first-child, :last-child, :only-child
    if (index === 0) {
      const firstSel = `${tag}:first-child`;
      if (isUnique(firstSel, el)) {
        out.push({sel: firstSel});
      }
    }
    
    if (index === siblings.length - 1) {
      const lastSel = `${tag}:last-child`;
      if (isUnique(lastSel, el)) {
        out.push({sel: lastSel});
      }
    }
    
    if (siblings.length === 1) {
      const onlySel = `${tag}:only-child`;
      if (isUnique(onlySel, el)) {
        out.push({sel: onlySel});
      }
    }
    
    // :first-of-type, :last-of-type, :only-of-type
    if (sameTagIndex === 0) {
      const firstTypeSel = `${tag}:first-of-type`;
      if (isUnique(firstTypeSel, el)) {
        out.push({sel: firstTypeSel});
      }
    }
    
    if (sameTagIndex === sameTagSiblings.length - 1) {
      const lastTypeSel = `${tag}:last-of-type`;
      if (isUnique(lastTypeSel, el)) {
        out.push({sel: lastTypeSel});
      }
    }
    
    if (sameTagSiblings.length === 1) {
      const onlyTypeSel = `${tag}:only-of-type`;
      if (isUnique(onlyTypeSel, el)) {
        out.push({sel: onlyTypeSel});
      }
    }
    
    // nth-child с формулами
    const totalSiblings = siblings.length;
    if (totalSiblings > 2) {
      // Четные/нечетные
      if (index % 2 === 1) { // четный (nth-child считает с 1)
        const evenSel = `${tag}:nth-child(even)`;
        if (isUnique(evenSel, el)) {
          out.push({sel: evenSel});
        }
      } else {
        const oddSel = `${tag}:nth-child(odd)`;
        if (isUnique(oddSel, el)) {
          out.push({sel: oddSel});
        }
      }
    }
    
    return out;
  }

  // Относительные Cypress селекторы
  function generateRelativeCypressSelectors(el) {
    const out = [];
    
    // Поиск ближайших элементов с текстом для относительного позиционирования
    const nearbyElements = findNearbyElementsWithText(el);
    
    for (const nearbyEl of nearbyElements) {
      const nearbyTexts = getAllTexts(nearbyEl);
      
      for (const nearbyText of nearbyTexts) {
        if (!isGoodTextForContains(nearbyText)) continue;
        
        // Проверяем уникальность ближайшего элемента
        if (isUniqueByText(nearbyEl, nearbyText)) {
          const escapedNearbyText = nearbyText.replace(/'/g, "\\'");
          
          // Генерируем БОЛЕЕ СПЕЦИФИЧНЫЕ относительные селекторы
          const specificRelationships = getSpecificElementRelationships(nearbyEl, el);
          
          for (const relationship of specificRelationships) {
            const relativeSel = `cy.contains('${escapedNearbyText}').${relationship.method}`;
            
            // КРИТИЧНО: проверяем, что этот селектор действительно уникален
            if (validateRelativeCypressSelector(relativeSel, el)) {
              out.push({sel: relativeSel, score: relationship.score, isCypress: true});
            }
          }
        }
      }
    }
    
    return out;
  }

  // Поиск ближайших элементов с текстом
  function findNearbyElementsWithText(el) {
    const nearby = [];
    const parent = el.parentElement;
    if (!parent) return nearby;
    
    // Соседние элементы
    const siblings = [...parent.children];
    const index = siblings.indexOf(el);
    
    // Предыдущие и следующие соседи
    for (let i = Math.max(0, index - 2); i <= Math.min(siblings.length - 1, index + 2); i++) {
      if (i !== index) {
        const sibling = siblings[i];
        const text = getElementText(sibling);
        if (text && text.length > 2) {
          nearby.push(sibling);
        }
      }
    }
    
    // Родительские элементы с текстом
    let currentParent = parent;
    let depth = 0;
    while (currentParent && depth < 2) {
      const parentText = getElementText(currentParent);
      if (parentText && parentText.length > 2) {
        nearby.push(currentParent);
      }
      currentParent = currentParent.parentElement;
      depth++;
    }
    
    return nearby;
  }

  // Определение СПЕЦИФИЧНЫХ отношений между элементами
  function getSpecificElementRelationships(fromEl, toEl) {
    const relationships = [];
    
    // 1. Проверяем, является ли toEl потомком fromEl
    if (fromEl.contains(toEl)) {
      // Прямой потомок
      if (fromEl === toEl.parentElement) {
        const children = [...fromEl.children];
        if (children.length === 1) {
          // Единственный потомок - безопасно использовать children()
          relationships.push({method: 'children()'});
        } else {
          // Множественные потомки - используем более специфичный селектор
          const targetTag = toEl.tagName.toLowerCase();
          const sameTagChildren = children.filter(child => child.tagName.toLowerCase() === targetTag);
          
          if (sameTagChildren.length === 1) {
            relationships.push({method: `children('${targetTag}')`});
          } else {
            const childIndex = children.indexOf(toEl);
            relationships.push({method: `children().eq(${childIndex})`});
          }
        }
      } else {
        // Любой потомок - используем find с более специфичными селекторами
        const descendants = fromEl.querySelectorAll('*');
        if (descendants.length === 1) {
          // Единственный потомок - безопасно
        relationships.push({method: 'find("*")'});
        } else {
          const targetTag = toEl.tagName.toLowerCase();
          const sameTagDescendants = fromEl.querySelectorAll(targetTag);
          
          if (sameTagDescendants.length === 1) {
            relationships.push({method: `find('${targetTag}')`});
          } else {
            // Слишком много потомков - не используем
            // relationships не добавляем
          }
        }
      }
    }
    
    // 2. Проверяем соседние элементы
    if (fromEl.parentElement === toEl.parentElement) {
      const siblings = [...fromEl.parentElement.children];
      const fromIndex = siblings.indexOf(fromEl);
      const toIndex = siblings.indexOf(toEl);
      
      if (toIndex === fromIndex + 1) {
        // Следующий соседний элемент
        relationships.push({method: 'next()'});
      } else if (toIndex > fromIndex) {
        // Следующие элементы
        const nextElements = siblings.slice(fromIndex + 1);
        const targetInNext = nextElements.indexOf(toEl);
        
        if (nextElements.length === 1) {
          relationships.push({method: 'nextAll()'});
        } else if (targetInNext >= 0) {
          relationships.push({method: `nextAll().eq(${targetInNext})`});
        }
      } else if (toIndex === fromIndex - 1) {
        // Предыдущий соседний элемент
        relationships.push({method: 'prev()'});
      } else if (toIndex < fromIndex) {
        // Предыдущие элементы
        const prevElements = siblings.slice(0, fromIndex);
        const targetInPrev = prevElements.indexOf(toEl);
        
        if (prevElements.length === 1) {
          relationships.push({method: 'prevAll()'});
        } else if (targetInPrev >= 0) {
          const reverseIndex = prevElements.length - 1 - targetInPrev;
          relationships.push({method: `prevAll().eq(${reverseIndex})`});
        }
      }
    }
    
    // 3. Проверяем родительские отношения
    if (toEl.contains(fromEl)) {
      // fromEl является потомком toEl
      if (toEl === fromEl.parentElement) {
        relationships.push({method: 'parent()'});
      } else {
        // Более далекий предок - используем parents с селектором
        const targetTag = toEl.tagName.toLowerCase();
        const ancestors = [];
        let current = fromEl.parentElement;
        while (current && current !== toEl) {
          ancestors.push(current);
          current = current.parentElement;
        }
        
        if (ancestors.length === 0) {
          relationships.push({method: 'parent()'});
        } else {
          const sameTagAncestors = [];
          current = fromEl.parentElement;
          while (current) {
            if (current.tagName.toLowerCase() === targetTag) {
              sameTagAncestors.push(current);
            }
            current = current.parentElement;
          }
          
          if (sameTagAncestors.length === 1 && sameTagAncestors[0] === toEl) {
            relationships.push({method: `parents('${targetTag}')`});
          }
        }
      }
    }
    
    return relationships;
  }

  // ==== UI ====
  function showToast(msg){ 
    let t=document.querySelector('.__dompick-toast'); 
    if(!t){ 
      t=document.createElement('div'); 
      t.className='__dompick-toast'; 
      // Всегда добавляем toast в body для правильного z-index
      document.body.appendChild(t);
    } 
    t.textContent=msg; 
    t.classList.add('show'); 
    setTimeout(()=>t.classList.remove('show'),1400); 
  }
  function openModalFor(el) {
    // Проверяем кэш для этого элемента
    if (__dompickSelectorCache && __dompickCachedElement === el) {
      // Используем кэшированные селекторы
      const modal = document.createElement('div');
      modal.className = '__dompick-modal';
      modal.innerHTML = `
        <div class="__dompick-backdrop"></div>
        <div class="__dompick-dialog __dompick-theme-transition">
          <div class="__dompick-head">
            <div class="__dompick-title">Селекторы для ${__dompickMode === 'js' ? 'JS' : 'Cypress'}</div>
            <button class="__dompick-copy" data-close>✖</button>
          </div>
          <div class="__dompick-body">
            <div class="__dompick-groups">
              <div id="__dompick-loading" style="opacity:.8;font-size:12px;color:var(--dompick-text-secondary)">Загрузка из кэша...</div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const groupsContainer = modal.querySelector('.__dompick-groups');
      const closeModal = () => {
        if (fixedHighlighted) {
          removeHighlight(fixedHighlighted);
          fixedHighlighted = null;
        }
        modal.remove();
      };
      modal.querySelector('[data-close]').addEventListener('click', closeModal);
      modal.querySelector('.__dompick-backdrop').addEventListener('click', closeModal);
      modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

      // Быстро отображаем кэшированные селекторы
      setTimeout(() => {
        const loading = groupsContainer.querySelector('#__dompick-loading');
        if (loading) loading.remove();

        const availableActions = getAvailableActions(el);
        const cachedGroups = __dompickSelectorCache[__dompickMode] || __dompickSelectorCache.cypress; // fallback

        createSelectorGroup(groupsContainer, 'Базовые селекторы', cachedGroups.basicSelectors, cachedGroups.moreBasic, availableActions, 'basic');
        const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
        createSelectorGroup(groupsContainer, containsTitle, cachedGroups.containsSelectors, cachedGroups.moreContains, availableActions, 'contains');
        createSelectorGroup(groupsContainer, 'Позиционные селекторы', cachedGroups.nthSelectors, cachedGroups.moreNth, availableActions, 'nth');

        if (cachedGroups.aggressive && cachedGroups.aggressive.length > 0) {
          createSelectorGroup(groupsContainer, 'Агрессивные селекторы', cachedGroups.aggressive.slice(0, 5), cachedGroups.aggressive.slice(5), availableActions, 'aggressive');
        }
      }, 50);
      return;
    }

    // Открываем модалку СРАЗУ, а тяжёлую генерацию переносим на idle/next-tick
    const modal = document.createElement('div');
    modal.className = '__dompick-modal';
    modal.innerHTML = `
      <div class="__dompick-backdrop"></div>
      <div class="__dompick-dialog __dompick-theme-transition">
        <div class="__dompick-head">
          <div class="__dompick-title">Селекторы для ${__dompickMode === 'js' ? 'JS' : 'Cypress'}</div>
          <button class="__dompick-copy" data-close>✖</button>
        </div>
        <div class="__dompick-body">
          <div class="__dompick-groups">
            <div id="__dompick-loading" style="opacity:.8;font-size:12px;color:var(--dompick-text-secondary)">Генерация селекторов...</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const groupsContainer = modal.querySelector('.__dompick-groups');
    const closeModal = () => {
      if (fixedHighlighted) {
        removeHighlight(fixedHighlighted);
        fixedHighlighted = null;
      }
      // Очищаем кэш при закрытии модального окна
      __dompickSelectorCache = null;
      __dompickCachedElement = null;
      modal.remove();
    };
    modal.querySelector('[data-close]').addEventListener('click', closeModal);
    modal.querySelector('.__dompick-backdrop').addEventListener('click', closeModal);
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    // Планируем асинхронную генерацию с тайм-бюджетом
    const runAsync = () => {
      // Устанавливаем увеличенный бюджет на генерацию и чистим кэш
      resetPerfGuards();
      __buildBudgetEnd = performance.now() + 5000; // можно увеличить при необходимости
      
      // Генерируем селекторы для текущего режима
      const groups = buildCandidates(el);
      
      // Инициализируем кэш
      __dompickSelectorCache = {
        [__dompickMode]: groups
      };
      __dompickCachedElement = el;
      
      resetPerfGuards();

      const availableActions = getAvailableActions(el);
      const loading = groupsContainer.querySelector('#__dompick-loading');
      if (loading) loading.remove();

      createSelectorGroup(groupsContainer, 'Базовые селекторы', groups.basicSelectors, groups.moreBasic, availableActions, 'basic');
      const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
      createSelectorGroup(groupsContainer, containsTitle, groups.containsSelectors, groups.moreContains, availableActions, 'contains');
      createSelectorGroup(groupsContainer, 'Позиционные селекторы', groups.nthSelectors, groups.moreNth, availableActions, 'nth');

      // Если есть агрессивные — тоже показываем
      if (groups.aggressive && groups.aggressive.length > 0) {
        createSelectorGroup(groupsContainer, 'Агрессивные селекторы', groups.aggressive.slice(0, 5), groups.aggressive.slice(5), availableActions, 'aggressive');
      }

      // ГАРАНТИЯ: если ни одного селектора не сгенерировалось — формируем абсолютный CSS‑путь
      const totalCount = groups.basicSelectors.length + groups.containsSelectors.length + groups.nthSelectors.length + (groups.aggressive?.length || 0);
      if (totalCount === 0) {
        const absPath = buildAbsoluteCssPath(el);
        const fallback = [{ sel: absPath }];
        createSelectorGroup(groupsContainer, 'Агрессивные селекторы (fallback)', fallback, [], availableActions, 'aggressive');
      }
      
      // Убираем фоновую генерацию - селекторы для противоположного режима будут генерироваться при первом переключении
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(runAsync, { timeout: 250 });
    } else {
      setTimeout(runAsync, 0);
    }
  }

  // Создание группы селекторов
  function createSelectorGroup(container, title, selectors, moreSelectors, availableActions, groupType) {
    if (selectors.length === 0 && moreSelectors.length === 0) return;
    
    const groupDiv = document.createElement('div');
    groupDiv.className = '__dompick-group';
    groupDiv.style.marginBottom = '20px';
    
    // Заголовок группы
    const titleDiv = document.createElement('div');
    titleDiv.style.fontWeight = 'bold';
    titleDiv.style.marginBottom = '8px';
    titleDiv.style.color = 'var(--dompick-accent-tertiary)';
    titleDiv.style.fontSize = '13px';
    titleDiv.textContent = title;
    groupDiv.appendChild(titleDiv);
    
    // Контейнер для селекторов этой группы
    const selectorsContainer = document.createElement('div');
    selectorsContainer.className = `__dompick-selectors-${groupType}`;
    groupDiv.appendChild(selectorsContainer);
    
    // Добавляем основные селекторы
    selectors.forEach((selector, index) => {
      addSelectorToGroup(selectorsContainer, selector, availableActions, index + 1);
    });
    
    // Кнопка "Показать ещё вариантов" если есть дополнительные селекторы
    if (moreSelectors.length > 0) {
      const moreButton = document.createElement('button');
      moreButton.className = '__dompick-btn';
      moreButton.textContent = `Показать ещё вариантов (${moreSelectors.length})`;
      moreButton.style.marginTop = '8px';
      moreButton.style.fontSize = '11px';
      
      let moreShown = false;
      moreButton.addEventListener('click', () => {
        const currentSelectorCount = selectorsContainer.querySelectorAll('.__dompick-item').length;
        const additionalCount = Math.min(5, moreSelectors.length); // Показываем по 5 дополнительных
        
        for (let i = 0; i < additionalCount; i++) {
          const selector = moreSelectors[i];
          addSelectorToGroup(selectorsContainer, selector, availableActions, currentSelectorCount + i + 1);
        }
        
        // Обновляем кнопку
        const remaining = moreSelectors.length - additionalCount;
        if (remaining > 0) {
          moreButton.textContent = `Показать ещё вариантов (${remaining})`;
          // Убираем показанные селекторы из массива
          moreSelectors.splice(0, additionalCount);
        } else {
          moreButton.style.display = 'none';
        }
      });
      
      groupDiv.appendChild(moreButton);
    }
    
    container.appendChild(groupDiv);
  }

  // Конвертация Cypress-цепочек в базовое JS-выражение (возвращает элемент)
  function __escapeJsString(s){
    try { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); } catch { return s; }
  }
  function convertJsToCypressBase(jsExpr) {
    if (!jsExpr || typeof jsExpr !== 'string') return 'cy.get("body")';
    let expr = jsExpr.trim().replace(/;\s*$/, '');
    
    // Проверяем, является ли это уже Cypress селектором
    if (expr.includes('cy.get(') || expr.includes('cy.contains(')) {
      // Это уже Cypress селектор, возвращаем как есть
      return expr;
    }
    
    // document.querySelector('sel')
    let m = expr.match(/^document\.querySelector\((['"])(.+?)\1\)$/);
    if (m) {
      const sel = m[2];
      return `cy.get('${sel}')`;
    }
    
    // Array.from(document.querySelectorAll('*')).find(el => el.textContent.includes('text'))
    m = expr.match(/Array\.from\(document\.querySelectorAll\('([^']+)'\)\)\.find\(el => el\.textContent\.includes\('([^']+)'\)\)/);
    if (m) {
      const selector = m[1];
      const text = m[2];
      if (selector === '*') {
        return `cy.contains('${text}')`;
      } else {
        return `cy.get('${selector}').contains('${text}')`;
      }
    }
    
    // Array.from(document.querySelectorAll('tag')).find(el => el.textContent.includes('text'))
    m = expr.match(/Array\.from\(document\.querySelectorAll\('([a-zA-Z][a-zA-Z0-9-]*)'\)\)\.find\(el => el\.textContent\.includes\('([^']+)'\)\)/);
    if (m) {
      const tag = m[1];
      const text = m[2];
      return `cy.contains('${tag}', '${text}')`;
    }
    
    // Агрессивные JS селекторы - создаем простой fallback
    if (expr.includes('(()=>{') || expr.includes('document.querySelector') || expr.includes('Array.from')) {
      // Для агрессивных селекторов возвращаем базовый селектор
      return 'cy.get("body")';
    }
    
    // Любая другая форма: пробуем вытащить document.querySelector('...')
    m = expr.match(/document\.querySelector\((['"])(.+?)\1\)/);
    if (m) {
      const sel = m[2];
      return `cy.get('${sel}')`;
    }
    
    return 'cy.get("body")';
  }

  function convertCypressToJsBase(cyExpr){
    if (!cyExpr || typeof cyExpr !== 'string') return 'document.body';
    let expr = cyExpr.trim().replace(/;\s*$/, '');
    
    // Проверяем, является ли это агрессивным JS селектором
    if (expr.includes('(()=>{') || expr.includes('document.querySelector') || expr.includes('Array.from')) {
      // Это уже JS селектор, возвращаем как есть
      return expr;
    }
    
    // cy.get('sel')
    let m = expr.match(/^cy\.get\((['"])(.+?)\1\)$/);
    if (m) {
      const sel = __escapeJsString(m[2]);
      return `document.querySelector('${sel}')`;
    }
    
    // cy.contains('text')
    m = expr.match(/^cy\.contains\((['"])(.+?)\1\)$/);
    if (m) {
      const txt = __escapeJsString(m[2]);
      return `Array.from(document.querySelectorAll('*')).find(el => el && el.textContent && el.textContent.includes('${txt}'))`;
    }
    
    // cy.contains('tag', 'text')
    m = expr.match(/^cy\.contains\((['"])([a-zA-Z][a-zA-Z0-9-]*)\1,\s*(['"])(.+?)\3\)$/);
    if (m) {
      const tag = m[2].toLowerCase();
      const txt = __escapeJsString(m[4]);
      return `Array.from(document.querySelectorAll('${tag}')).find(el => el && el.textContent && el.textContent.includes('${txt}'))`;
    }
    
    // cy.get('sel').contains('text')
    m = expr.match(/^cy\.get\((['"])(.+?)\1\)\.contains\((['"])(.+?)\3\)$/);
    if (m) {
      const sel = __escapeJsString(m[2]);
      const txt = __escapeJsString(m[4]);
      return `Array.from(document.querySelectorAll('${sel}')).find(el => el && el.textContent && el.textContent.includes('${txt}'))`;
    }
    
    // cy.get('sel').contains('tag','text')
    m = expr.match(/^cy\.get\((['"])(.+?)\1\)\.contains\((['"])([a-zA-Z][a-zA-Z0-9-]*)\3,\s*(['"])(.+?)\5\)$/);
    if (m) {
      const scope = __escapeJsString(m[2]);
      const tag = m[4].toLowerCase();
      const txt = __escapeJsString(m[6]);
      return `Array.from((document.querySelector('${scope}')||document).querySelectorAll('${tag}')).find(el => el && el.textContent && el.textContent.includes('${txt}'))`;
    }
    
    // cy.get('sel').filter(':visible').contains('text')
    m = expr.match(/^cy\.get\((['"])(.+?)\1\)\.filter\('\:visible'\)\.contains\((['"])(.+?)\3\)$/);
    if (m) {
      const sel = __escapeJsString(m[2]);
      const txt = __escapeJsString(m[4]);
      return `Array.from(document.querySelectorAll('${sel}')).filter(el => el && el.offsetParent !== null).find(el => el.textContent && el.textContent.includes('${txt}'))`;
    }
    
    // cy.get('sel').filter(':visible').contains('tag','text')
    m = expr.match(/^cy\.get\((['"])(.+?)\1\)\.filter\('\:visible'\)\.contains\((['"])([a-zA-Z][a-zA-Z0-9-]*)\3,\s*(['"])(.+?)\5\)$/);
    if (m) {
      const scope = __escapeJsString(m[2]);
      const tag = m[4].toLowerCase();
      const txt = __escapeJsString(m[6]);
      return `Array.from((document.querySelector('${scope}')||document).querySelectorAll('${tag}')).filter(el => el && el.offsetParent !== null).find(el => el.textContent && el.textContent.includes('${txt}'))`;
    }
    
    // cy.get('sel').find('sub').eq(n)
    m = expr.match(/^cy\.get\((['"])(.+?)\1\)\.find\((['"])(.+?)\3\)\.eq\((\d+)\)$/);
    if (m) {
      const scope = __escapeJsString(m[2]);
      const sub = __escapeJsString(m[4]);
      const idx = Number(m[5]) || 0;
      return `Array.from((document.querySelector('${scope}')||document).querySelectorAll('${sub}'))[${idx}]`;
    }
    
    // cy.get('sel').find('sub')
    m = expr.match(/^cy\.get\((['"])(.+?)\1\)\.find\((['"])(.+?)\3\)$/);
    if (m) {
      const scope = __escapeJsString(m[2]);
      const sub = __escapeJsString(m[4]);
      return `(document.querySelector('${scope}')||document).querySelector('${sub}')`;
    }
    
    // Любая другая форма: пробуем вытащить первый cy.get('...')
    m = expr.match(/cy\.get\((['"])(.+?)\1\)/);
    if (m) {
      const sel = __escapeJsString(m[2]);
      return `document.querySelector('${sel}')`;
    }
    
    return 'document.body';
  }

  // Добавление селектора в группу
  function addSelectorToGroup(container, selector, availableActions, number) {
    const selectorRow = document.createElement('div');
    selectorRow.className = '__dompick-selector-row';
    selectorRow.style.display = 'grid';
    selectorRow.style.gridTemplateColumns = '1fr auto auto';
    selectorRow.style.gap = '12px';
    selectorRow.style.alignItems = 'center';
    selectorRow.style.marginBottom = '8px';
    
    const buildBaseForMode = () => {
      if (__dompickMode === 'js') {
        if (selector.isCypress) {
          return convertCypressToJsBase(selector.sel);
        }
        // Если селектор помечен как готовое JS-выражение, возвращаем как есть
        if (selector.isJs) {
          return selector.sel;
        }
        return `document.querySelector('${selector.sel}')`;
      } else {
        if (selector.isCypress) {
          return selector.sel;
        }
        // Если это JS селектор, конвертируем в Cypress
        if (selector.isJs || selector.sel.includes('document.querySelector') || selector.sel.includes('Array.from')) {
          return convertJsToCypressBase(selector.sel);
        }
        return `cy.get('${selector.sel}')`;
      }
    };
    const displayText = buildBaseForMode();
    const copyText = displayText;
    
    // Левая часть - селектор
    const selectorPart = document.createElement('div');
    selectorPart.className = '__dompick-item';
    selectorPart.style.marginBottom = '0';
    
    // Сохраняем оригинальный селектор и информацию о типе в data-атрибутах
    const codeElement = document.createElement('code');
    codeElement.style.fontSize = '11px';
    codeElement.textContent = displayText;
    codeElement.setAttribute('data-original-selector', selector.sel);
    codeElement.setAttribute('data-was-cypress', selector.isCypress ? 'true' : 'false');
    
    selectorPart.innerHTML = `<div><b>${number}.</b> </div>`;
    selectorPart.querySelector('div').appendChild(codeElement);
    
    // Бейдж рейтинга (0..100), цвет от красного к зелёному
    const rawScore = (typeof computeSelectorScore === 'function') ? computeSelectorScore(selector, selector.__targetEl || null) : 0;
    const normalized = Math.max(0, Math.min(100, Math.round(50 + 50 * Math.tanh(rawScore / 80)))) ;
    const hue = Math.round((normalized / 100) * 120); // 0 (red) -> 120 (green)
    const ratingBadge = document.createElement('div');
    ratingBadge.className = '__dompick-rating';
    ratingBadge.textContent = String(normalized);
    ratingBadge.title = `Рейтинг селектора: ${normalized} (raw: ${rawScore})`;
    ratingBadge.style.minWidth = '36px';
    ratingBadge.style.textAlign = 'center';
    ratingBadge.style.fontSize = '10px';
    ratingBadge.style.fontWeight = 'bold';
    ratingBadge.style.color = '#fff';
    ratingBadge.style.padding = '2px 6px';
    ratingBadge.style.borderRadius = '6px';
    ratingBadge.style.background = `linear-gradient(90deg, hsl(${hue}, 70%, 45%), hsl(${hue}, 70%, 38%))`;
    ratingBadge.style.boxShadow = '0 0 0 1px rgba(0,0,0,.05) inset';

    // Правая часть - кнопки
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = '__dompick-buttons';
    buttonsContainer.style.flexShrink = '0'; // Не сжимать кнопки
    
    // Основная кнопка "Копировать"
    const copyBtn = document.createElement('button');
    copyBtn.className = '__dompick-copy';
    copyBtn.textContent = 'Копировать';
    copyBtn.style.fontSize = '10px';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(copyText).then(() => showToast('Скопировано'));
    });
    buttonsContainer.appendChild(copyBtn);
    
    // Кнопки действий
    availableActions.forEach(action => {
      const actionBtn = document.createElement('button');
      actionBtn.className = '__dompick-action';
      actionBtn.textContent = `.${action}()`;
      actionBtn.style.fontSize = '10px';
      actionBtn.addEventListener('click', () => {
        let actionText = '';
        if (__dompickMode === 'js') {
          if (action === 'type') actionText = `${copyText}.value = 'текст';`;
          else if (action === 'select') actionText = `${copyText}.value = 'значение';`;
          else if (action === 'check') actionText = `${copyText}.checked = true;`;
          else if (action === 'uncheck') actionText = `${copyText}.checked = false;`;
          else if (action === 'clear') actionText = `${copyText}.value = '';`;
          else actionText = `${copyText}.click();`;
        } else {
          actionText = action === 'type' ? 
            `${copyText}.${action}('текст');` :
            action === 'select' ?
            `${copyText}.${action}('значение');` :
            `${copyText}.${action}();`;
        }
        navigator.clipboard.writeText(actionText).then(() => showToast(`Скопировано: .${action}()`));
      });
      buttonsContainer.appendChild(actionBtn);
    });
    
    selectorRow.appendChild(selectorPart);
    selectorRow.appendChild(ratingBadge);
    selectorRow.appendChild(buttonsContainer);
    container.appendChild(selectorRow);
  }

  // ==== Обработчики событий ====
  const activateSelectionMode = () => {
    if (isSelectionModeActive) return;
    isSelectionModeActive = true;
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.className = '__dompick-overlay';
    }

    const handleMove = (e) => {
      const x = e.clientX;
      const y = e.clientY;
      // Временно скрываем overlay, чтобы получить реальный элемент под курсором
      overlayEl.style.display = 'none';
      const raw = document.elementFromPoint(x, y);
      overlayEl.style.display = '';

      // Если попали в нашу панель/модалку — игнорируем
      if (!raw || raw === panel || (raw.closest && raw.closest('.__dompick-panel, .__dompick-modal'))) {
        if (currentHighlighted && currentHighlighted !== fixedHighlighted) {
          removeHighlight(currentHighlighted);
          currentHighlighted = null;
        }
        lastHoveredElement = null;
        return;
      }

      const target = snapTarget(raw);
      if (!target || target === panel || panel.contains(target) || (target.closest && target.closest('.__dompick-panel, .__dompick-modal'))) {
        return;
      }

      if (currentHighlighted && currentHighlighted !== fixedHighlighted && currentHighlighted !== target) {
        removeHighlight(currentHighlighted);
      }
      currentHighlighted = target;
      highlightElement(target);
      lastHoveredElement = target;
    };

    const handleClick = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      let target = lastHoveredElement;
      if (!target) {
        // На всякий случай определим элемент под кликом
        overlayEl.style.display = 'none';
        const raw = document.elementFromPoint(e.clientX, e.clientY);
        overlayEl.style.display = '';
        if (raw && !(raw === panel || (raw.closest && raw.closest('.__dompick-panel, .__dompick-modal')))) {
          target = snapTarget(raw);
        }
      }

      if (target && !(target === panel || panel.contains(target))) {
        if (fixedHighlighted) {
          removeHighlight(fixedHighlighted);
        }
        fixedHighlighted = target;
        highlightElement(target);
        openModalFor(target);
      }

      // После клика — выходим из режима
      deactivateSelectionMode();
    };

    overlayEl.addEventListener('mousemove', handleMove, true);
    overlayEl.addEventListener('click', handleClick, true);
    document.body.appendChild(overlayEl);

    // Сохраним ссылки на обработчики для безопасного снятия
    overlayEl.__dompickMove = handleMove;
    overlayEl.__dompickClick = handleClick;
  };

  const deactivateSelectionMode = () => {
    if (!isSelectionModeActive) return;
    isSelectionModeActive = false;
    lastHoveredElement = null;
    if (overlayEl) {
      if (overlayEl.__dompickMove) overlayEl.removeEventListener('mousemove', overlayEl.__dompickMove, true);
      if (overlayEl.__dompickClick) overlayEl.removeEventListener('click', overlayEl.__dompickClick, true);
      if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    }
    // Убираем hover-подсветку, не трогая зафиксированную
    if (currentHighlighted && currentHighlighted !== fixedHighlighted) {
      removeHighlight(currentHighlighted);
      currentHighlighted = null;
    }
  };

  function onKeyDown(e) {
    if (e.key === 'Control') {
      isCtrlPressed = true;
      // Входим в режим выбора
      activateSelectionMode();
    }
  }

  function onKeyUp(e) {
    if (e.key === 'Control') {
      isCtrlPressed = false;
      // Выходим из режима выбора
      deactivateSelectionMode();
      // Убираем hover подсветку когда отпускаем Ctrl
      if (currentHighlighted && currentHighlighted !== fixedHighlighted) {
        removeHighlight(currentHighlighted);
        currentHighlighted = null;
      }
    }
  }

  function onMouseOver(e) {
    if (!isCtrlPressed) return;
    
    const target = snapTarget(e.target);
    if (target === panel || panel.contains(target)) return;
    if (target === fixedHighlighted) return; // не перекрываем зафиксированную подсветку
    
    // Убираем предыдущую hover подсветку
    if (currentHighlighted && currentHighlighted !== fixedHighlighted) {
      removeHighlight(currentHighlighted);
    }
    
    currentHighlighted = target;
    highlightElement(target);
  }

  function onMouseOut(e) {
    if (!isCtrlPressed) return;
    
    const target = snapTarget(e.target);
    if (currentHighlighted === target && target !== fixedHighlighted) {
      removeHighlight(currentHighlighted);
      currentHighlighted = null;
    }
  }

  function onClick(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    
    const target = snapTarget(e.target);
    if (target === panel || panel.contains(target)) return;
    
    // Убираем предыдущую фиксированную подсветку
    if (fixedHighlighted) {
      removeHighlight(fixedHighlighted);
    }
    
    // Фиксируем подсветку на кликнутом элементе
    fixedHighlighted = target;
    highlightElement(target);
    
    // Ctrl+клик - показываем селекторы
    openModalFor(target);
  }

  // Добавляем все обработчики
  // Клики/наведение теперь обрабатываются через Overlay в режиме выбора
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
})();
