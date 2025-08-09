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
    .__dompick-highlight{outline:2px solid #ff0066; outline-offset:2px}
    .__dompick-modal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center}
    .__dompick-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}
    .__dompick-dialog{position:relative;background:#0b1020;color:#e5e7eb;width:min(920px,95vw);max-height:85vh;
      border:1px solid #334155;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.5);display:flex;flex-direction:column}
    .__dompick-head{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #1f2937;
      flex-shrink:0;position:sticky;top:0;background:#0b1020;z-index:10;border-radius:14px 14px 0 0}
    .__dompick-title{font-weight:700}
    .__dompick-body{padding:12px 16px;overflow-y:auto;flex:1}
    .__dompick-list{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}
    .__dompick-buttons{display:flex;align-items:center;gap:4px}
    .__dompick-item{background:#0f172a;border:1px solid #1f2937;border-radius:10px;padding:8px 10px;word-break:break-all}
    .__dompick-copy{cursor:pointer;border:1px solid #475569;background:#111827;border-radius:10px;padding:6px 10px}
    .__dompick-copy:hover{background:#1f2937}
    .__dompick-action{cursor:pointer;border:1px solid #059669;background:#064e3b;color:#10b981;border-radius:10px;padding:6px 8px;margin-left:4px;font-size:11px}
    .__dompick-action:hover{background:#065f46}
    .__dompick-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#16a34a;color:#fff;padding:8px 12px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transition:opacity .2s}
    .__dompick-toast.show{opacity:1}
    .__dompick-group{border:1px solid #1f2937;border-radius:8px;padding:12px;margin-bottom:12px;background:#0f172a}
    .__dompick-group:last-child{margin-bottom:0}
    .__dompick-btn{cursor:pointer;border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;border-radius:6px;padding:6px 12px;font-size:11px;transition:background .2s}
    .__dompick-btn:hover{background:#374151}
    .__dompick-selector-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;margin-bottom:8px}
    .__dompick-selector-row:last-child{margin-bottom:0}
  `;
  document.head.appendChild(styleEl);

  // ==== Переменные состояния ====
  let currentHighlighted = null;
  let fixedHighlighted = null;
  let isCtrlPressed = false;

  // ==== Панель ====
  const panel = document.createElement('div');
  panel.className = '__dompick-panel';
  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
      <div style="flex: 1;">
        <div style="font-weight: bold; margin-bottom: 4px;">DOM Picker</div>
        <div class="__dompick-help" id="__dompick-help">
          <div>Ctrl+клик - показать селекторы</div>
        </div>
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
      
      // ВАЖНО: cy.contains('текст') используем только если текст ГЛОБАЛЬНО уникален
      if (isUniqueByText(el, text)) {
        const containsCmd = `cy.contains('${escapedText}')`;
        out.push({sel: containsCmd, score: 85, isCypress: true});
      }
      
      // cy.contains('tag', 'текст') - более специфичный, но тоже только если уникален
      if (isUniqueByText(el, text, tag)) {
        const containsWithTagCmd = `cy.contains('${tag}', '${escapedText}')`;
        out.push({sel: containsWithTagCmd, score: 87, isCypress: true});
      }
      
      // Для элементов в специальных контейнерах - ОБЯЗАТЕЛЬНО используем контекст
      const specialContainer = el.closest('.datepicker, .modal, .dropdown, .popup, .overlay, .sidebar, .panel');
      if (specialContainer) {
        const containerClass = specialContainer.classList[0];
        if (containerClass && isUniqueByTextInParent(el, text, specialContainer)) {
          const visibleContainsCmd = `cy.get('.${containerClass}').filter(':visible').contains('${escapedText}')`;
          out.push({sel: visibleContainsCmd, score: 90, isCypress: true}); // Повышаем приоритет контекстных селекторов
        }
      }
      
      // Если текст НЕ глобально уникален, НЕ добавляем простой cy.contains()
      // Вместо этого ищем минимальный уникальный контекст
      if (!isUniqueByText(el, text)) {
        const uniqueContext = findMinimalUniqueContext(el, text);
        if (uniqueContext) {
          const contextContainsCmd = `cy.get('${uniqueContext}').contains('${escapedText}')`;
          out.push({sel: contextContainsCmd, score: 89, isCypress: true});
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
              const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
              out.push({sel: cmd, score: 92, isCypress: true}); // Повышаем приоритет
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
                const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
                out.push({sel: cmd, score: 93, isCypress: true}); // Высший приоритет для data-атрибутов
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
                const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
                out.push({sel: cmd, score: 88, isCypress: true});
              }
            }
          }
          
          // Комбинации классов
          if (stableClasses.length >= 2) {
            const parentSel = `.${esc(stableClasses[0])}.${esc(stableClasses[1])}`;
            if (document.querySelectorAll(parentSel).length === 1) {
              if (isUniqueByTextInParent(el, text, p)) {
                const cmd = `cy.get('${parentSel}').contains('${escapedText}')`;
                out.push({sel: cmd, score: 90, isCypress: true});
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
              const cmd = `cy.get('${parentTag}').contains('${escapedText}')`;
              out.push({sel: cmd, score: 85, isCypress: true});
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
    
    // Основные стратегии
    const basicStrategies = [
      ...byId(el),
      ...byPreferredData(el),
      ...byAnyData(el),
      ...byAttr(el),
      ...byClassCombos(el),
      ...bySimilarAttrs(el),
      ...uniqueWithinScope(el),
      ...nthPath(el)
    ];
    
    // Cypress текстовые селекторы
    const cypressStrategies = [
      ...byCypressText(el),
      ...byCypressCombo(el)
    ];
    
    // Структурные селекторы с nth-child
    const nthStrategies = [
      ...byNthChild(el),
      ...byParentWithNth(el),
      ...bySiblingSelectors(el),
      ...byCalendarSelectors(el)
    ];
    
    // Агрессивные стратегии
    let aggressiveStrategies = [];
    const basicCount = basicStrategies.length + cypressStrategies.length + nthStrategies.length;
    
    if (basicCount < 15) {
      aggressiveStrategies = [
        ...generateAggressiveFallbacks(el),
        ...generateSuperAggressiveFallbacks(el)
      ];
    }
    
    // Валидируем и добавляем все селекторы
    const candidatesMap = new Map();
    
    for (const strategies of [basicStrategies, cypressStrategies, nthStrategies, aggressiveStrategies]) {
      for (const item of strategies) {
        if (!candidatesMap.has(item.sel)) {
          // Валидация для Cypress селекторов
          if (item.isCypress) {
            if (validateCypressSelector(item.sel, el)) {
              candidatesMap.set(item.sel, item);
              allSelectors.push(item);
            }
          } else {
            candidatesMap.set(item.sel, item);
            allSelectors.push(item);
          }
        }
      }
    }
    
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
      
      // Проверяем, содержит ли селектор .contains
      if (sel.includes('cy.contains') || sel.includes('.contains(')) {
        groups.contains.push(selector);
      }
      // Проверяем, содержит ли селектор nth-child или подобные
      else if (sel.includes('nth-child') || sel.includes('nth-of-type') || 
               sel.includes(':first-child') || sel.includes(':last-child') ||
               sel.includes(':only-child') || sel.includes(':first-of-type') ||
               sel.includes(':last-of-type') || sel.includes(':only-of-type') ||
               sel.includes('nth(') || sel.includes('eq(')) {
        groups.nth.push(selector);
      }
      // Агрессивные селекторы (с низким score)
      else if (selector.score < 40) {
        groups.aggressive.push(selector);
      }
      // Остальные - базовые
      else {
        groups.basic.push(selector);
      }
    }
    
    // Сортируем каждую группу по качеству
    const sortByQuality = (a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 5) return scoreDiff;
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
        out.push({sel: nthSel, score: 35});
      }
    }
    
    // 3. Селекторы через текстовое содержимое с контекстом
    const textContent = el.textContent?.trim();
    if (textContent && textContent.length > 0 && textContent.length < 30) {
      const partialText = textContent.substring(0, 15);
      if (partialText.length > 2) {
        // Ищем уникальный контекст для текста
        const uniqueContext = findMinimalUniqueContext(el, partialText);
        if (uniqueContext) {
          const contextContainsSel = `cy.get('${uniqueContext}').contains('${partialText.replace(/'/g, "\\'")}')`;
          out.push({sel: contextContainsSel, score: 45, isCypress: true});
        } else if (isUniqueByText(el, partialText)) {
          const containsSel = `cy.contains('${partialText.replace(/'/g, "\\'")}')`;
          out.push({sel: containsSel, score: 40, isCypress: true});
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
            out.push({sel: attrSel, score: 40});
          }
          
          const tagAttrSel = `${tag}[${name}="${esc(value)}"]`;
          if (isUnique(tagAttrSel, el)) {
            out.push({sel: tagAttrSel, score: 42});
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
          out.push({sel: classSel, score: 45});
        }
        
        const tagClassSel = `${tag}.${esc(cls)}`;
        if (isUnique(tagClassSel, el)) {
          out.push({sel: tagClassSel, score: 47});
        }
      }
    }
    
    // 6. Простой селектор по тегу только если он уникален
    if (isUnique(tag, el)) {
      out.push({sel: tag, score: 25});
    }
    
    return out;
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
              out.push({sel, score: 52 - depth});
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
                out.push({sel, score: 54 - depth});
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
                out.push({sel, score: 48 - depth});
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
                out.push({sel, score: 50 - depth});
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
              out.push({sel, score: 44 - depth});
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
            out.push({sel: fullSel, score: 30 - depth});
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
              out.push({sel: fullSel, score: 32 - depth});
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
            out.push({sel: adjSel, score: 38});
          }
        } else {
          const genSel = `${siblingId} ~ ${tag}:nth-of-type(${distance})`;
          if (isUnique(genSel, el)) {
            out.push({sel: genSel, score: 35});
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
              out.push({sel: adjSel, score: 33});
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
          out.push({sel: partialSel, score: 28});
        }
      }
      
      // Селекторы по окончанию атрибута
      if (value.length > 8) {
        const endValue = value.substring(Math.max(0, value.length - 10));
        const endSel = `${tag}[${name}$="${esc(endValue)}"]`;
        if (isUnique(endSel, el)) {
          out.push({sel: endSel, score: 26});
        }
      }
      
      // Селекторы по содержимому атрибута
      if (value.includes('-') || value.includes('_')) {
        const parts = value.split(/[-_]/);
        for (const part of parts) {
          if (part.length > 3 && !looksDynamic(part)) {
            const containsSel = `${tag}[${name}*="${esc(part)}"]`;
            if (isUnique(containsSel, el)) {
              out.push({sel: containsSel, score: 24});
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
        out.push({sel: firstSel, score: 32});
      }
    }
    
    if (index === siblings.length - 1) {
      const lastSel = `${tag}:last-child`;
      if (isUnique(lastSel, el)) {
        out.push({sel: lastSel, score: 32});
      }
    }
    
    if (siblings.length === 1) {
      const onlySel = `${tag}:only-child`;
      if (isUnique(onlySel, el)) {
        out.push({sel: onlySel, score: 35});
      }
    }
    
    // :first-of-type, :last-of-type, :only-of-type
    if (sameTagIndex === 0) {
      const firstTypeSel = `${tag}:first-of-type`;
      if (isUnique(firstTypeSel, el)) {
        out.push({sel: firstTypeSel, score: 30});
      }
    }
    
    if (sameTagIndex === sameTagSiblings.length - 1) {
      const lastTypeSel = `${tag}:last-of-type`;
      if (isUnique(lastTypeSel, el)) {
        out.push({sel: lastTypeSel, score: 30});
      }
    }
    
    if (sameTagSiblings.length === 1) {
      const onlyTypeSel = `${tag}:only-of-type`;
      if (isUnique(onlyTypeSel, el)) {
        out.push({sel: onlyTypeSel, score: 33});
      }
    }
    
    // nth-child с формулами
    const totalSiblings = siblings.length;
    if (totalSiblings > 2) {
      // Четные/нечетные
      if (index % 2 === 1) { // четный (nth-child считает с 1)
        const evenSel = `${tag}:nth-child(even)`;
        if (isUnique(evenSel, el)) {
          out.push({sel: evenSel, score: 25});
        }
      } else {
        const oddSel = `${tag}:nth-child(odd)`;
        if (isUnique(oddSel, el)) {
          out.push({sel: oddSel, score: 25});
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
          relationships.push({method: 'children()', score: 28});
        } else {
          // Множественные потомки - используем более специфичный селектор
          const targetTag = toEl.tagName.toLowerCase();
          const sameTagChildren = children.filter(child => child.tagName.toLowerCase() === targetTag);
          
          if (sameTagChildren.length === 1) {
            relationships.push({method: `children('${targetTag}')`, score: 26});
          } else {
            const childIndex = children.indexOf(toEl);
            relationships.push({method: `children().eq(${childIndex})`, score: 24});
          }
        }
      } else {
        // Любой потомок - используем find с более специфичными селекторами
        const descendants = fromEl.querySelectorAll('*');
        if (descendants.length === 1) {
          // Единственный потомок - безопасно
          relationships.push({method: 'find("*")', score: 22});
        } else {
          const targetTag = toEl.tagName.toLowerCase();
          const sameTagDescendants = fromEl.querySelectorAll(targetTag);
          
          if (sameTagDescendants.length === 1) {
            relationships.push({method: `find('${targetTag}')`, score: 20});
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
        relationships.push({method: 'next()', score: 30});
      } else if (toIndex > fromIndex) {
        // Следующие элементы
        const nextElements = siblings.slice(fromIndex + 1);
        const targetInNext = nextElements.indexOf(toEl);
        
        if (nextElements.length === 1) {
          relationships.push({method: 'nextAll()', score: 25});
        } else if (targetInNext >= 0) {
          relationships.push({method: `nextAll().eq(${targetInNext})`, score: 23});
        }
      } else if (toIndex === fromIndex - 1) {
        // Предыдущий соседний элемент
        relationships.push({method: 'prev()', score: 30});
      } else if (toIndex < fromIndex) {
        // Предыдущие элементы
        const prevElements = siblings.slice(0, fromIndex);
        const targetInPrev = prevElements.indexOf(toEl);
        
        if (prevElements.length === 1) {
          relationships.push({method: 'prevAll()', score: 25});
        } else if (targetInPrev >= 0) {
          const reverseIndex = prevElements.length - 1 - targetInPrev;
          relationships.push({method: `prevAll().eq(${reverseIndex})`, score: 23});
        }
      }
    }
    
    // 3. Проверяем родительские отношения
    if (toEl.contains(fromEl)) {
      // fromEl является потомком toEl
      if (toEl === fromEl.parentElement) {
        relationships.push({method: 'parent()', score: 28});
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
          relationships.push({method: 'parent()', score: 28});
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
            relationships.push({method: `parents('${targetTag}')`, score: 26});
          }
        }
      }
    }
    
    return relationships;
  }

  // ==== UI ====
  function showToast(msg){ let t=document.querySelector('.__dompick-toast'); if(!t){ t=document.createElement('div'); t.className='__dompick-toast'; document.body.appendChild(t); } t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1400); }
  function openModalFor(el) {
    const groups = buildCandidates(el);
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
          <div class="__dompick-groups"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    const groupsContainer = modal.querySelector('.__dompick-groups');
    
    // Создаем группы селекторов
    createSelectorGroup(groupsContainer, 'Базовые селекторы', groups.basicSelectors, groups.moreBasic, availableActions, 'basic');
    createSelectorGroup(groupsContainer, 'Селекторы с .contains', groups.containsSelectors, groups.moreContains, availableActions, 'contains');
    createSelectorGroup(groupsContainer, 'Позиционные селекторы', groups.nthSelectors, groups.moreNth, availableActions, 'nth');
    
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
    titleDiv.style.color = '#10b981';
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
    
    // Кнопка "Сгенерировать ещё вариантов" если есть дополнительные селекторы
    if (moreSelectors.length > 0) {
      const moreButton = document.createElement('button');
      moreButton.className = '__dompick-btn';
      moreButton.textContent = `Сгенерировать ещё вариантов (${moreSelectors.length})`;
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
          moreButton.textContent = `Ещё варианты (${remaining})`;
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

  // Добавление селектора в группу
  function addSelectorToGroup(container, selector, availableActions, number) {
    const selectorRow = document.createElement('div');
    selectorRow.className = '__dompick-selector-row';
    selectorRow.style.display = 'grid';
    selectorRow.style.gridTemplateColumns = '1fr auto';
    selectorRow.style.gap = '12px';
    selectorRow.style.alignItems = 'center';
    selectorRow.style.marginBottom = '8px';
    
    const displayText = selector.isCypress ? selector.sel : `cy.get('${selector.sel}')`;
    const copyText = selector.isCypress ? selector.sel : `cy.get('${selector.sel}')`;
    
    // Левая часть - селектор
    const selectorPart = document.createElement('div');
    selectorPart.className = '__dompick-item';
    selectorPart.style.marginBottom = '0';
    selectorPart.innerHTML = `<div><b>${number}.</b> <code style="font-size: 11px;">${displayText.replace(/</g,'&lt;')}</code></div>`;
    
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
        const actionText = action === 'type' ? 
          `${copyText}.${action}('текст');` :
          action === 'select' ?
          `${copyText}.${action}('значение');` :
          `${copyText}.${action}();`;
        navigator.clipboard.writeText(actionText).then(() => showToast(`Скопировано: .${action}()`));
      });
      buttonsContainer.appendChild(actionBtn);
    });
    
    selectorRow.appendChild(selectorPart);
    selectorRow.appendChild(buttonsContainer);
    container.appendChild(selectorRow);
  }

  // ==== Обработчики событий ====
  function onKeyDown(e) {
    if (e.key === 'Control') {
      isCtrlPressed = true;
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
  window.addEventListener('click', onClick, true);
  window.addEventListener('mouseover', onMouseOver, true);
  window.addEventListener('mouseout', onMouseOut, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
})();
