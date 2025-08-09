(() => {
  if (window.__domPickerActive) { console.warn('DOM Picker уже активен'); return; }
  window.__domPickerActive = true;

  // ==== Стили ====
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .__dompick-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111827;color:#e5e7eb;
      font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;border:1px solid #374151;border-radius:12px;
      box-shadow:0 10px 30px rgba(0,0,0,.35);padding:10px 12px;min-width:260px;display:flex;justify-content:space-between;align-items:center}
    .__dompick-help{opacity:.8;margin-left:8px}
    .__dompick-btn-close{cursor:pointer;border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;border-radius:8px;padding:4px 8px}
    .__dompick-btn-close:hover{background:#374151}
    .__dompick-btn{cursor:pointer;border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;border-radius:8px;padding:4px 8px;margin-left:4px;font-size:11px}
    .__dompick-btn:hover{background:#374151}
    .__dompick-btn.recording{background:#dc2626;border-color:#dc2626}
    .__dompick-btn.recording:hover{background:#b91c1c}
    .__dompick-highlight{outline:2px solid #ff0066; outline-offset:2px}
    .__dompick-modal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center}
    .__dompick-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}
    .__dompick-dialog{position:relative;background:#0b1020;color:#e5e7eb;width:min(760px,90vw);max-height:80vh;overflow:auto;
      border:1px solid #334155;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.5)}
    .__dompick-head{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #1f2937}
    .__dompick-title{font-weight:700}
    .__dompick-body{padding:12px 16px}
    .__dompick-list{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}
    .__dompick-buttons{display:flex;align-items:center;gap:4px}
    .__dompick-item{background:#0f172a;border:1px solid #1f2937;border-radius:10px;padding:8px 10px;word-break:break-all}
    .__dompick-copy{cursor:pointer;border:1px solid #475569;background:#111827;border-radius:10px;padding:6px 10px}
    .__dompick-copy:hover{background:#1f2937}
    .__dompick-action{cursor:pointer;border:1px solid #059669;background:#064e3b;color:#10b981;border-radius:10px;padding:6px 8px;margin-left:4px;font-size:11px}
    .__dompick-action:hover{background:#065f46}
    .__dompick-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#16a34a;color:#fff;padding:8px 12px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transition:opacity .2s}
    .__dompick-toast.show{opacity:1}
  `;
  document.head.appendChild(styleEl);

  // ==== Переменные состояния ====
  let currentHighlighted = null;
  let fixedHighlighted = null;
  let isCtrlPressed = false;
  let isShiftPressed = false;
  let isRecording = false;
  let recordedActions = [];

  // ==== Панель ====
  const panel = document.createElement('div');
  panel.className = '__dompick-panel';
  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
      <div style="flex: 1;">
        <div style="font-weight: bold; margin-bottom: 4px;">DOM Picker</div>
        <div class="__dompick-help" id="__dompick-help">
          <div>Ctrl+клик - селекторы</div>
          <div>Ctrl+Shift+клик - запись</div>
        </div>
        <div id="__dompick-info" style="margin-top: 8px; font-size: 11px; opacity: 0.8; display: none;"></div>
      </div>
      <button class="__dompick-btn-close" id="__dompick-close">Закрыть</button>
    </div>
  `;
  document.body.appendChild(panel);

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

  // ==== Функции управления информацией ====
  const updateInfoPanel = (message, isRecording = false) => {
    const infoEl = document.getElementById('__dompick-info');
    if (message) {
      infoEl.textContent = message;
      infoEl.style.display = 'block';
      if (isRecording) {
        infoEl.style.color = '#dc2626';
      } else {
        infoEl.style.color = '#16a34a';
      }
    } else {
      infoEl.style.display = 'none';
    }
  };

  const startRecording = () => {
    isRecording = true;
    recordedActions = [];
    updateInfoPanel('Запись началась. Ctrl+Shift+клик для добавления действий', true);
  };

  const stopRecording = () => {
    isRecording = false;
    updateInfoPanel(null);
    
    if (recordedActions.length > 0) {
      showRecordedScript();
    }
  };

  const detectActionType = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = el.type ? el.type.toLowerCase() : '';
    
    if (tag === 'input') {
      if (type === 'text' || type === 'email' || type === 'password' || type === 'search' || type === 'url' || type === 'tel') {
        return 'type';
      }
      if (type === 'checkbox' || type === 'radio') {
        return 'check';
      }
      if (type === 'submit' || type === 'button') {
        return 'click';
      }
    }
    
    if (tag === 'select') {
      return 'select';
    }
    
    if (tag === 'textarea') {
      return 'type';
    }
    
    // По умолчанию - клик
    return 'click';
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

  const recordAction = (el, actionType) => {
    const candidates = buildCandidates(el);
    if (candidates.length === 0) return;
    
    // Берем лучший селектор
    const bestCandidate = candidates[0];
    const selector = bestCandidate.isCypress ? bestCandidate.sel : `cy.get('${bestCandidate.sel}')`;
    
    let action = {
      selector,
      type: actionType,
      element: el.tagName.toLowerCase()
    };
    
    // Добавляем дополнительную информацию в зависимости от типа действия
    if (actionType === 'type' && (el.value || el.placeholder)) {
      action.value = el.value || `{placeholder: "${el.placeholder}"}`;
    } else if (actionType === 'select' && el.selectedOptions.length > 0) {
      action.value = el.selectedOptions[0].value || el.selectedOptions[0].text;
    }
    
    recordedActions.push(action);
    updateInfoPanel(`Записано действий: ${recordedActions.length} (последнее: ${actionType})`, true);
  };

  const showRecordedScript = () => {
    const script = recordedActions.map(action => {
      switch (action.type) {
        case 'click':
          return `${action.selector}.click();`;
        case 'type':
          return `${action.selector}.type('${action.value || 'текст'}');`;
        case 'select':
          return `${action.selector}.select('${action.value || 'значение'}');`;
        case 'check':
          return `${action.selector}.check();`;
        default:
          return `${action.selector}.click();`;
      }
    }).join('\n');

    const modal = document.createElement('div');
    modal.className = '__dompick-modal';
    modal.innerHTML = `
      <div class="__dompick-backdrop"></div>
      <div class="__dompick-dialog">
        <div class="__dompick-head">
          <div class="__dompick-title">Записанный Cypress сценарий</div>
          <button class="__dompick-copy" data-close>✖</button>
        </div>
        <div class="__dompick-body">
          <div style="margin-bottom: 12px;">
            <strong>Записано действий: ${recordedActions.length}</strong>
          </div>
          <div class="__dompick-item" style="margin-bottom: 12px;">
            <pre style="white-space: pre-wrap; font-family: monospace; font-size: 12px; line-height: 1.4;">${script}</pre>
          </div>
          <button class="__dompick-copy" id="__dompick-copy-script">Копировать весь скрипт</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const closeModal = () => modal.remove();
    
    modal.querySelector('[data-close]').addEventListener('click', closeModal);
    modal.querySelector('.__dompick-backdrop').addEventListener('click', closeModal);
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
    
    modal.querySelector('#__dompick-copy-script').addEventListener('click', () => {
      navigator.clipboard.writeText(script).then(() => showToast('Скрипт скопирован'));
    });
  };

  document.getElementById('__dompick-close').addEventListener('click', () => {
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('mouseover', onMouseOver, true);
    window.removeEventListener('mouseout', onMouseOut, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    clearAllHighlights();
    panel.remove();
    styleEl.remove();
    window.__domPickerActive = false;
  });

  // ==== Вспомогательные ====
  const prefDataAttrs = ['data-testid','data-test','data-cy','data-qa','data-test-id','data-automation-id','for'];
  const okAttrs = ['id','name','type','placeholder','href','value','role','aria-label','title','for'];
  const interestingSel = 'button, a, input, select, textarea, label, [role="button"], [role="menuitem"], .select2-container, .select2-choice, .select2-selection, .select2-selection__rendered';

  const esc = (s) => CSS.escape(s);
  const looksDynamic = (s='') => /\b\d{4,}\b|\b[a-f0-9]{6,}\b|__/i.test(s);
  const isUnique = (selector, el) => {
    try { const n = document.querySelectorAll(selector); return n.length === 1 && n[0] === el; } catch { return false; }
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
      const elements = tagFilter 
        ? document.querySelectorAll(tagFilter)
        : document.querySelectorAll('*');
      
      let matches = 0;
      let foundElement = null;
      
      for (const element of elements) {
        const elementText = getElementText(element);
        if (elementText === text) {
          matches++;
          foundElement = element;
          if (matches > 1) break;
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
      const elements = parent.querySelectorAll('*');
      let matches = 0;
      let foundElement = null;
      
      for (const element of elements) {
        const elementText = getElementText(element);
        if (elementText === text) {
          matches++;
          foundElement = element;
          if (matches > 1) break;
        }
      }
      
      return matches === 1 && foundElement === el;
    } catch {
      return false;
    }
  };

  // Валидация Cypress селектора - проверяет, что селектор действительно найдет нужный элемент
  const validateCypressSelector = (selector, targetElement) => {
    try {
      // Для cy.contains селекторов
      if (selector.includes('.contains(')) {
        const text = selector.match(/contains\(['"]([^'"]+)['"]\)/)?.[1];
        if (text) {
          const elementText = getElementText(targetElement);
          if (elementText !== text) return false;
          
          // Проверяем контейнер, если он указан
          const containerMatch = selector.match(/cy\.get\(['"]([^'"]+)['"]\)/);
          if (containerMatch) {
            const containerSelector = containerMatch[1];
            try {
              const containers = document.querySelectorAll(containerSelector);
              let foundInContainer = false;
              for (const container of containers) {
                if (container.contains(targetElement)) {
                  foundInContainer = true;
                  break;
                }
              }
              return foundInContainer;
            } catch {
              return false;
            }
          }
        }
      }
      
      return true; // Для других типов селекторов пока пропускаем детальную проверку
    } catch {
      return false;
    }
  };

  // Поднимаемся к «осмысленной» цели
  function snapTarget(el){
    const originalEl = el; // Сохраняем исходный элемент
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
  function byId(el){ return el.id && isUnique(`#${esc(el.id)}`, el) ? [{sel: `#${esc(el.id)}`, score: 100}] : []; }
  function byPreferredData(el){ const out=[]; for(const a of prefDataAttrs){ const v=el.getAttribute&&el.getAttribute(a); if(!v) continue; const s=`[${a}="${esc(v)}"]`; if(isUnique(s,el)) out.push({sel:s,score:95}); const s2=`${el.tagName.toLowerCase()}${s}`; if(isUnique(s2,el)) out.push({sel:s2,score:93}); } return out; }
  function byAnyData(el){ const out=[]; if(!el.attributes) return out; for(const {name,value} of el.attributes){ if(!name.startsWith('data-')||!value) continue; const s=`[${name}="${esc(value)}"]`; if(isUnique(s,el)) out.push({sel:s,score:85}); const s2=`${el.tagName.toLowerCase()}${s}`; if(isUnique(s2,el)) out.push({sel:s2,score:83}); } return out; }
  function byAttr(el){ const out=[]; for(const a of okAttrs){ const v=el.getAttribute&&el.getAttribute(a); if(!v) continue; const s=`[${a}="${esc(v)}"]`; if(isUnique(s,el)) out.push({sel:s,score:80}); const s2=`${el.tagName.toLowerCase()}${s}`; if(isUnique(s2,el)) out.push({sel:s2,score:78}); } const role=el.getAttribute&&el.getAttribute('role'); const al=el.getAttribute&&el.getAttribute('aria-label'); if(role&&al){ const s=`[role="${esc(role)}"][aria-label="${esc(al)}"]`; if(isUnique(s,el)) out.push({sel:s,score:82}); } return out; }
  function byClassCombos(el){ 
    const out=[]; 
    const classes=el.classList ? [...el.classList].filter(c => 
      c && 
      !looksDynamic(c) && 
      !c.startsWith('__dompick') // Исключаем служебные классы DOM Picker'а
    ).slice(0,4) : []; 
    
    for(const c of classes){ 
      const s=`.${esc(c)}`; 
      if(isUnique(s,el)) out.push({sel:s,score:70}); 
      const s2=`${el.tagName.toLowerCase()}${s}`; 
      if(isUnique(s2,el)) out.push({sel:s2,score:72}); 
    } 
    
    if(classes.length>=2){ 
      const [a,b]=classes; 
      const s=`.${esc(a)}.${esc(b)}`; 
      if(isUnique(s,el)) out.push({sel:s,score:73}); 
      const s2=`${el.tagName.toLowerCase()}${s}`; 
      if(isUnique(s2,el)) out.push({sel:s2,score:74}); 
    } 
    
    return out; 
  }
  function bySimilarAttrs(el){ const out=[]; const similarAttrs=findSimilarAttrs(el); for(const {name,value} of similarAttrs){ const s=`[${name}="${esc(value)}"]`; if(isUnique(s,el)) out.push({sel:s,score:75}); const s2=`${el.tagName.toLowerCase()}[${name}="${esc(value)}"]`; if(isUnique(s2,el)) out.push({sel:s2,score:77}); } return out; }
  
  // Генерация Cypress команд по тексту
  function byCypressText(el) {
    const out = [];
    const texts = getAllTexts(el);
    const tag = el.tagName.toLowerCase();
    
    // Обрабатываем все найденные тексты
    for (const text of texts) {
      if (!isGoodTextForContains(text)) continue;
      
      const escapedText = text.replace(/'/g, "\\'");
      
      // cy.contains('текст') - самый простой вариант
      if (isUniqueByText(el, text)) {
        const containsCmd = `cy.contains('${escapedText}')`;
        out.push({sel: containsCmd, score: 85, isCypress: true});
      }
      
      // cy.contains('tag', 'текст') - более специфичный
      if (isUniqueByText(el, text, tag)) {
        const containsWithTagCmd = `cy.contains('${tag}', '${escapedText}')`;
        out.push({sel: containsWithTagCmd, score: 87, isCypress: true});
      }
      
      // Для элементов в специальных контейнерах - добавляем :visible селекторы
      const specialContainer = el.closest('.datepicker, .modal, .dropdown');
      if (specialContainer) {
        const containerClass = specialContainer.classList[0];
        if (containerClass) {
          // Проверяем, что элемент действительно уникален в этом контейнере
          const elementsInContainer = specialContainer.querySelectorAll('*');
          let foundInContainer = false;
          for (const elem of elementsInContainer) {
            if (elem === el && getElementText(elem) === text) {
              foundInContainer = true;
              break;
            }
          }
          
          if (foundInContainer) {
            const visibleContainsCmd = `cy.get('.${containerClass}').filter(':visible').contains('${escapedText}')`;
            out.push({sel: visibleContainsCmd, score: 88, isCypress: true});
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
      
      // Ищем уникальные предки для комбинации get().contains()
      let p = el.parentElement, depth = 0;
      
      while (p && depth < 3) {
        // Проверяем ID предка
        if (p.id) {
          const parentSel = `#${esc(p.id)}`;
          if (document.querySelectorAll(parentSel).length === 1) {
            if (isUniqueByTextInParent(el, text, p)) {
              const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
              out.push({sel: cmd, score: 88, isCypress: true});
            }
          }
        }
        
        // Проверяем data-атрибуты предка
        for (const attr of prefDataAttrs) {
          const value = p.getAttribute(attr);
          if (value) {
            const parentSel = `[${attr}="${esc(value)}"]`;
            if (document.querySelectorAll(parentSel).length === 1) {
              if (isUniqueByTextInParent(el, text, p)) {
                const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
                out.push({sel: cmd, score: 89, isCypress: true});
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
      if (p.id) {
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
        // Тестируем атом как есть
        const selector1 = `${scope} ${atom}`;
        if (isUnique(selector1, el)) {
          out.push({sel: selector1, score: 90});
        }
        
        // Тестируем с прямым потомком
        const selector2 = `${scope} > ${atom}`;
        if (isUnique(selector2, el)) {
          out.push({sel: selector2, score: 92});
        }
        
        // Тестируем с тегом + атом
        const selector3 = `${scope} ${tag}${atom}`;
        if (isUnique(selector3, el)) {
          out.push({sel: selector3, score: 88});
        }
        
        // Тестируем с тегом + атом как прямой потомок
        const selector4 = `${scope} > ${tag}${atom}`;
        if (isUnique(selector4, el)) {
          out.push({sel: selector4, score: 89});
        }
      }
      
      // Если нет атрибутных атомов, используем только тег
      if (attributeAtoms.length === 0) {
        const selector5 = `${scope} ${tag}`;
        if (isUnique(selector5, el)) {
          out.push({sel: selector5, score: 85});
        }
        
        const selector6 = `${scope} > ${tag}`;
        if (isUnique(selector6, el)) {
          out.push({sel: selector6, score: 87});
        }
      }
    }
    
    return out;
  }
  function nthPath(el){ const parts=[]; let cur=el; while(cur&&cur.nodeType===1&&parts.length<8){ if(cur.id){ parts.unshift(`#${esc(cur.id)}`); break; } const tag=cur.tagName.toLowerCase(); const p=cur.parentElement; if(p){ parts.unshift(tag); } else parts.unshift(tag); cur=p; } const sel=parts.join(' > '); return isUnique(sel,el)?[{sel,score:60}]:[]; }
  
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
      out.push({sel: nthChildSel, score: 45});
    }
    
    // nth-of-type по позиции среди элементов того же типа
    const sameTypeSiblings = siblings.filter(s => s.tagName === el.tagName);
    if (sameTypeSiblings.length > 1) {
      const typeIndex = sameTypeSiblings.indexOf(el) + 1;
      const nthOfTypeSel = `${tag}:nth-of-type(${typeIndex})`;
      if (isUnique(nthOfTypeSel, el)) {
        out.push({sel: nthOfTypeSel, score: 50});
      }
    }
    
    // first-child, last-child
    if (index === 1) {
      const firstChildSel = `${tag}:first-child`;
      if (isUnique(firstChildSel, el)) {
        out.push({sel: firstChildSel, score: 55});
      }
    }
    
    if (index === siblings.length) {
      const lastChildSel = `${tag}:last-child`;
      if (isUnique(lastChildSel, el)) {
        out.push({sel: lastChildSel, score: 55});
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
          out.push({sel: childSel, score: 65});
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
            out.push({sel: childSel, score: 55});
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
          out.push({sel: adjacentSel, score: 58});
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
            out.push({sel: adjacentSel, score: 48});
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
          out.push({sel: visibleCalendarSel, score: 65, isCypress: true});
          
          // Поиск в datepicker-days только если такой элемент существует
          if (document.querySelector('.datepicker-days')) {
            const activeDaysSel = `cy.get('.datepicker-days:visible td').contains('${dayNumber}')`;
            out.push({sel: activeDaysSel, score: 63, isCypress: true});
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
            out.push({sel: relativeSel, score: 60, isCypress: true});
          }
        }
      }
    }
    
    return out;
  }
  
  function buildCandidates(original) {
    const el = snapTarget(original);
    
    // Основные стратегии генерации селекторов
    const primaryStrategies = [
      ...byId(el),
      ...byPreferredData(el),
      ...byAnyData(el),
      ...byAttr(el),
      ...byClassCombos(el),
      ...bySimilarAttrs(el),
      ...byCypressText(el),
      ...byCypressCombo(el),
      ...uniqueWithinScope(el),
      ...nthPath(el)
    ];
    
    // Структурные селекторы - всегда включаем
    const structuralStrategies = [
      ...byNthChild(el),
      ...byParentWithNth(el),
      ...bySiblingSelectors(el),
      ...byCalendarSelectors(el) // Новые селекторы для календарей
    ];
    
    // Объединяем все стратегии
    const allStrategies = [...primaryStrategies, ...structuralStrategies];
    
    // Убираем дубликаты и валидируем Cypress селекторы
    const candidatesMap = new Map();
    for (const item of allStrategies) {
      if (!candidatesMap.has(item.sel)) {
        // Дополнительная валидация для Cypress селекторов
        if (item.isCypress) {
          if (validateCypressSelector(item.sel, el)) {
            candidatesMap.set(item.sel, item);
          }
        } else {
          candidatesMap.set(item.sel, item);
        }
      }
    }
    
    let candidates = [...candidatesMap.values()];
    
    // Если все еще мало селекторов, добавляем агрессивные варианты
    if (candidates.length < 8) {
      const aggressiveFallbacks = generateAggressiveFallbacks(el);
      for (const item of aggressiveFallbacks) {
        if (!candidatesMap.has(item.sel)) {
          candidates.push(item);
        }
      }
    }
    
    // Сортируем по качеству и длине
    const sorted = candidates.sort((a, b) => (a.sel.length - b.sel.length) || (b.score - a.score));
    
    // Выбираем самый надежный селектор
    const mostReliable = [...candidates].sort((a, b) => b.score - a.score)[0];
    
    // Берем топ-9 + самый надежный
    const top = sorted.slice(0, 9);
    if (mostReliable && !top.find(x => x.sel === mostReliable.sel)) {
      top.push(mostReliable);
    }
    
    return top.slice(0, 10);
  }
  
  // Агрессивные fallback селекторы для крайних случаев
  function generateAggressiveFallbacks(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    
    // Селекторы по позиции в документе (только если уникальные)
    const allSameTagElements = document.querySelectorAll(tag);
    const elementIndex = [...allSameTagElements].indexOf(el);
    if (elementIndex >= 0) {
      const nthSel = `${tag}:nth-of-type(${elementIndex + 1})`;
      if (isUnique(nthSel, el)) {
        out.push({sel: nthSel, score: 35});
      }
    }
    
    // Селекторы через текстовое содержимое (только если уникальные)
    const textContent = el.textContent?.trim();
    if (textContent && textContent.length > 0 && textContent.length < 30) {
      const partialText = textContent.substring(0, 15);
      if (partialText.length > 2 && isUniqueByText(el, partialText)) {
        const containsSel = `cy.contains('${partialText.replace(/'/g, "\\'")}')`;
        out.push({sel: containsSel, score: 40, isCypress: true});
      }
    }
    
    // Селекторы по атрибутам (только уникальные)
    if (el.attributes) {
      for (const {name, value} of el.attributes) {
        if (name && value && value.length < 50 && !looksDynamic(value)) {
          // Фильтруем системные классы DOM Picker'а
          if (name === 'class' && value.includes('__dompick')) continue;
          
          const attrSel = `[${name}="${esc(value)}"]`;
          if (isUnique(attrSel, el)) {
            out.push({sel: attrSel, score: 40});
          }
          
          const tagAttrSel = `${tag}[${name}="${esc(value)}"]`;
          if (isUnique(tagAttrSel, el)) {
            out.push({sel: tagAttrSel, score: 42});
          }
        }
      }
    }
    
    // Селекторы по классам (только стабильные и уникальные)
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
          out.push({sel: classSel, score: 45});
        }
        
        const tagClassSel = `${tag}.${esc(cls)}`;
        if (isUnique(tagClassSel, el)) {
          out.push({sel: tagClassSel, score: 47});
        }
      }
    }
    
    // Простой селектор по тегу только если он уникален
    if (isUnique(tag, el)) {
      out.push({sel: tag, score: 25});
    }
    
    return out;
  }

  // ==== UI ====
  function showToast(msg){ let t=document.querySelector('.__dompick-toast'); if(!t){ t=document.createElement('div'); t.className='__dompick-toast'; document.body.appendChild(t); } t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1400); }
  function openModalFor(el) {
    const cand = buildCandidates(el);
    const availableActions = getAvailableActions(el);
    
    const modal = document.createElement('div');
    modal.className = '__dompick-modal';
    modal.innerHTML = `
      <div class="__dompick-backdrop"></div>
      <div class="__dompick-dialog">
        <div class="__dompick-head">
          <div class="__dompick-title">Селекторы для Cypress</div>
          <button class="__dompick-copy" data-close>✖</button>
        </div>
        <div class="__dompick-body">
          <div class="__dompick-list"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    const list = modal.querySelector('.__dompick-list');
    
    cand.forEach((c, i) => {
      const wrap = document.createElement('div');
      wrap.className = '__dompick-item';
      const displayText = c.isCypress ? c.sel : `cy.get('${c.sel}')`;
      const copyText = c.isCypress ? c.sel : `cy.get('${c.sel}')`;
      wrap.innerHTML = `<div><b>${i+1}.</b> <code>${displayText.replace(/</g,'&lt;')}</code></div>`;
      
      // Контейнер для кнопок
      const buttonsContainer = document.createElement('div');
      buttonsContainer.className = '__dompick-buttons';
      
      // Основная кнопка "Копировать"
      const copyBtn = document.createElement('button');
      copyBtn.className = '__dompick-copy';
      copyBtn.textContent = 'Копировать';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(copyText).then(() => showToast('Скопировано'));
      });
      buttonsContainer.appendChild(copyBtn);
      
      // Кнопки действий
      availableActions.forEach(action => {
        const actionBtn = document.createElement('button');
        actionBtn.className = '__dompick-action';
        actionBtn.textContent = `.${action}()`;
        actionBtn.addEventListener('click', () => {
          const actionText = action === 'type' ? 
            `${copyText}.${action}('текст');` :
            action === 'select' ?
            `${copyText}.${action}('значение');` :
            `${copyText}.${action}();`;
          navigator.clipboard.writeText(actionText).then(() => showToast(`Скопировано: .${action}()`));
        });
        buttonsContainer.appendChild(actionBtn);
      });
      
      list.appendChild(wrap);
      list.appendChild(buttonsContainer);
    });
    
    const closeModal = () => {
      if (fixedHighlighted) {
        removeHighlight(fixedHighlighted);
        fixedHighlighted = null;
      }
      modal.remove();
    };
    
    modal.querySelector('[data-close]').addEventListener('click', closeModal);
    modal.querySelector('.__dompick-backdrop').addEventListener('click', closeModal);
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  // ==== Обработчики событий ====
  function onKeyDown(e) {
    if (e.key === 'Control') {
      isCtrlPressed = true;
    }
    if (e.key === 'Shift') {
      isShiftPressed = true;
      // Начинаем запись при нажатии Ctrl+Shift
      if (isCtrlPressed && !isRecording) {
        startRecording();
      }
    }
  }

  function onKeyUp(e) {
    if (e.key === 'Control') {
      isCtrlPressed = false;
      // Убираем hover подсветку когда отпускаем Ctrl
      if (currentHighlighted && currentHighlighted !== fixedHighlighted) {
        removeHighlight(currentHighlighted);
        currentHighlighted = null;
      }
    }
    if (e.key === 'Shift') {
      isShiftPressed = false;
      // Останавливаем запись при отпускании Shift
      if (isRecording) {
        stopRecording();
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
    
    if (e.ctrlKey && e.shiftKey && isRecording) {
      // Ctrl+Shift+клик - записываем действие
      const actionType = detectActionType(target);
      recordAction(target, actionType);
    } else if (e.ctrlKey && !e.shiftKey) {
      // Только Ctrl+клик - показываем селекторы
      openModalFor(target);
    }
  }

  // Добавляем все обработчики
  window.addEventListener('click', onClick, true);
  window.addEventListener('mouseover', onMouseOver, true);
  window.addEventListener('mouseout', onMouseOut, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
})();
