(() => {
  if (window.__domPickerActive) { console.warn('DOM Picker уже активен'); return; }
  window.__domPickerActive = true;

  // =========================================================================
  // РАЗДЕЛ 1: КОНФИГУРАЦИЯ И ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
  // =========================================================================

  // --- Конфигурация ---
  // Определяет настройки работы скрипта, такие как таймауты, отладочные флаги и пороги.
  // Настройки могут быть переопределены через глобальные переменные window.
  const __dompickConfig = (() => {
    try {
      const fromLS = (k) => (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || null;
      return {
        debug: true, // Включен режим дебага
        logLevel: String(window.__dompickDebugLevel || 'info'),
        buildBudgetMs: Number(window.__dompickBudgetMs || 5000),
        slowBuildThresholdMs: Number(window.__dompickSlowBuildThresholdMs || 2000),
        slowQueryThresholdMs: Number(window.__dompickSlowQueryThresholdMs || 30),
        // Новые параметры для гейтинга стратегий
        textSearchEnabled: !!(window.__dompickTextSearchEnabled ?? false),
        aggressiveEnabled: !!(window.__dompickAggressiveEnabled ?? true),
        strategyBudgetMs: Number(window.__dompickStrategyBudgetMs || 150),
        targetEnoughBasic: Number(window.__dompickTargetEnoughBasic || 3),
        maxDescendantsForTextSearch: Number(window.__dompickMaxDescendantsForTextSearch || 400),
        domSizeSoftCap: Number(window.__dompickDomSizeSoftCap || 8000),
        // Address Layer фичефлаг
        addressPipeEnabled: Boolean(window.__dompickAddressPipeEnabled !== undefined ? window.__dompickAddressPipeEnabled : true),
      };
    } catch (_) {
      return { 
        debug: false, logLevel: 'info', buildBudgetMs: 5000, slowBuildThresholdMs: 2000, slowQueryThresholdMs: 30,
        textSearchEnabled: false, aggressiveEnabled: true, strategyBudgetMs: 150, targetEnoughBasic: 3,
        maxDescendantsForTextSearch: 400, domSizeSoftCap: 4000, addressPipeEnabled: true
      };
    }
  })();

  // --- Глобальные переменные состояния ---
  // Хранят текущее состояние приложения: активный режим, выбранные элементы и т.д.
  let currentHighlighted = null;
  let fixedHighlighted = null;
  let isCtrlPressed = false;
  let isSelectionModeActive = false;
  let overlayEl = null;
  let lastHoveredElement = null;
  let __dompickMode = 'cypress'; // Режим вывода: 'cypress' | 'js'
  const __dompickVersion = 'v1.12'; // Версия UI
  let __dompickSelectorCache = null; // Глобальный кэш для селекторов в обоих режимах
  let __dompickCachedElement = null;
  
  // Address Layer: кэш для адресов
  let __dompickAddressCache = null; // Глобальный кэш для адресов
  
  // Address Layer переменная
  let __dompickAddressPipeEnabled = __dompickConfig.addressPipeEnabled;

  // --- Переменные для отладки и производительности ---
  const __perfStats = {
    buildRuns: [],                           // {ctx, ms, basic, contains, nth, aggressive}
    strategies: Object.create(null),         // {name: [ms, ...]}
    isUnique: [],                            // {sel, ms, count, cached}
    misc: { getAllTexts: [], findStableScope: [] }, // [ms,...]
    totals: { isUniqueCalls: 0, isUniqueMisses: 0, isUniqueHits: 0, qsaTimeMs: 0 }
  };
  let __buildBudgetEnd = 0; // timestamp (performance.now) когда прекращаем дорогие операции
  const __queryCache = new Map(); // selector -> Array<Element>

  // =========================================================================
  // РАЗДЕЛ 2: ADDRESS LAYER
  // =========================================================================
  
  /**
   * @typedef {Object} Address
   * @property {'css'|'xpath'|'text'|'positional'} kind
   * @property {string[]} path
   * @property {Object=} constraints  // { text?, scopeSelector?, attrs? }
   * @property {Object=} meta         // { score?, strategy? }
   * @property {Element=} target
   */

  /**
   * Address Layer: форматирует CSS Address в строку
   * @param {Address} address
   * @returns {string|null}
   */
  function toCss(address) {
    if (!address || !address.path || !Array.isArray(address.path)) return null;
    
    switch (address.kind) {
      case 'css':
        return address.path.join(' ');
      case 'positional':
        return address.path.join(' ');
      default:
        return null;
    }
  }

  /**
   * Address Layer: форматирует XPath Address в строку
   * @param {Address} address
   * @returns {string|null}
   */
  function toXPath(address) {
    if (!address || !address.path || !Array.isArray(address.path)) return null;
    
    switch (address.kind) {
      case 'xpath':
        return address.path.join('/');
      case 'positional':
        // Address Layer: конвертируем позиционные адреса в XPath
        return address.path.join('/');
      default:
        return null;
    }
  }

  /**
   * Address Layer: форматирует Address в Cypress строку
   * @param {Address} address
   * @returns {string|null}
   */
  function toCypress(address) {
    if (!address || !address.kind) return null;
    
    switch (address.kind) {
      case 'css':
        const cssSelector = toCss(address);
        return cssSelector ? `cy.get('${cssSelector}')` : null;
        
      case 'xpath':
        const xpathExpr = toXPath(address);
        return xpathExpr ? `cy.xpath('${xpathExpr}')` : null;
        
      case 'text':
        const text = address.constraints?.text;
        if (!text) return null;
        
        const escapedText = text.replace(/'/g, "\\'");
        const scopeSelector = address.constraints?.scopeSelector;
        
        if (scopeSelector) {
          return `cy.get('${scopeSelector}').contains('${escapedText}')`;
        } else {
          return `cy.contains('${escapedText}')`;
        }
        
      case 'positional':
        // Address Layer: рендерим позиционные адреса в CSS
        const positionalCss = toCss(address);
        return positionalCss ? `cy.get('${positionalCss}')` : null;
        
      default:
        return null;
    }
  }

  /**
   * Address Layer: форматирует Address в JS строку
   * @param {Address} address
   * @returns {string|null}
   */
  function toJs(address) {
    if (!address || !address.kind) return null;
    
    switch (address.kind) {
      case 'css':
        const cssSelector = toCss(address);
        return cssSelector ? `document.querySelector('${cssSelector}')` : null;
        
      case 'xpath':
        const xpathExpr = toXPath(address);
        return xpathExpr ? `document.evaluate('${xpathExpr}', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue` : null;
        
      case 'text':
        const text = address.constraints?.text;
        if (!text) return null;
        
        const escapedText = text.replace(/'/g, "\\'");
        const scopeSelector = address.constraints?.scopeSelector;
        
        if (scopeSelector) {
          return `document.querySelector('${scopeSelector}').querySelector('*').textContent.includes('${escapedText}')`;
        } else {
          return `Array.from(document.querySelectorAll('*')).find(el => el.textContent.includes('${escapedText}'))`;
        }
        
      case 'positional':
        // Address Layer: рендерим позиционные адреса в CSS
        const positionalCssJs = toCss(address);
        return positionalCssJs ? `document.querySelector('${positionalCssJs}')` : null;
        
      default:
        return null;
    }
  }

  /**
   * Address Layer: конвертирует Address в строку селектора для указанного режима
   * @param {string} mode - 'cypress' | 'js'
   * @param {Address} address
   * @returns {string|null}
   */
  function addressToSelector(mode, address) {
    if (!address || !address.kind) return null;
    
    switch (mode) {
      case 'cypress':
        return toCypress(address);
      case 'js':
        return toJs(address);
      default:
        return null;
    }
  }

  /**
   * Address Layer: универсальная проверка уникальности адреса
   * @param {Address} address
   * @param {Document|Element} within - контекст поиска (по умолчанию document)
   * @returns {{unique: boolean, count: number}|null}
   */
  function isUniqueAddress(address, within = document) {
    if (!address || !address.kind) return null;
    
    try {
      switch (address.kind) {
        case 'css':
          const cssSelector = toCss(address);
          if (!cssSelector) return null;
          const cssElements = within.querySelectorAll(cssSelector);
          return {
            unique: cssElements.length === 1,
            count: cssElements.length
          };
          
        case 'xpath':
          const xpathExpr = toXPath(address);
          if (!xpathExpr) return null;
          const xpathResult = document.evaluate(
            xpathExpr, 
            within, 
            null, 
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, 
            null
          );
          return {
            unique: xpathResult.snapshotLength === 1,
            count: xpathResult.snapshotLength
          };
          
        case 'text':
        case 'positional':
          // Address Layer: проверяем уникальность позиционных адресов как CSS
          const positionalCss = toCss(address);
          if (!positionalCss) return null;
          const positionalElements = within.querySelectorAll(positionalCss);
          return {
            unique: positionalElements.length === 1,
            count: positionalElements.length
          };
          
        default:
          return null;
      }
    } catch (error) {
      __dlog('warn', `Address Layer: ошибка проверки уникальности адреса: ${error.message}`);
      return null;
    }
  }

  /**
   * Address Layer: генерация текстовых адресов
   * @param {Element} el
   * @returns {Address[]}
   */
  function byTextAddress(el) {
    const addresses = [];
    const texts = getAllTexts(el);
    
    // Обрабатываем все найденные тексты
    for (const text of texts) {
      if (!isGoodTextForContains(text)) continue;
      
      // Глобально уникальный текст
      if (isUniqueByText(el, text)) {
        addresses.push({
          kind: 'text',
          path: [text],
          constraints: { text },
          meta: { strategy: 'byTextAddress', score: 85 },
          target: el
        });
      }
      
      // Уникален среди тега
      const tag = el.tagName.toLowerCase();
      if (isUniqueByText(el, text, tag)) {
        addresses.push({
          kind: 'text',
          path: [tag, text],
          constraints: { text, tag },
          meta: { strategy: 'byTextAddress', score: 80 },
          target: el
        });
      }
      
      // Специальные контейнеры (видимый)
      const specialContainer = el.closest('.datepicker, .modal, .modal-body, .modal-content, .modal-dialog, .dropdown, .popup, .overlay, .sidebar, .panel');
      if (specialContainer) {
        const containerClass = specialContainer.classList[0];
        if (containerClass && isUniqueByTextInParent(el, text, specialContainer)) {
          addresses.push({
            kind: 'text',
            path: [containerClass, text],
            constraints: { text, scopeSelector: `.${containerClass}` },
            meta: { strategy: 'byTextAddress', score: 75 },
            target: el
          });
        }
      }
      
      // Уникальный контекст - упрощенная версия
      if (!isUniqueByText(el, text)) {
        // Address Layer: findMinimalUniqueContext не реализована, пропускаем
      }
    }
    
    return addresses;
  }

  /**
   * Address Layer: генерация позиционных адресов (nth-child)
   * @param {Element} el
   * @returns {Address[]}
   */
  function byNthChildAddress(el) {
    const addresses = [];
    const parent = el.parentElement;
    if (!parent) return addresses;
    
    const tag = el.tagName.toLowerCase();
    const siblings = [...parent.children];
    const index = siblings.indexOf(el) + 1;
    
    // nth-child по позиции среди всех детей
    const nthChildPath = [`${tag}:nth-child(${index})`];
    addresses.push({
      kind: 'positional',
      path: nthChildPath,
      constraints: { tag, index, type: 'nth-child' },
      meta: { strategy: 'byNthChildAddress', score: 75 },
      target: el
    });
    
    // nth-of-type по позиции среди элементов того же типа
    const sameTypeSiblings = siblings.filter(s => s.tagName === el.tagName);
    if (sameTypeSiblings.length > 1) {
      const typeIndex = sameTypeSiblings.indexOf(el) + 1;
      const nthOfTypePath = [`${tag}:nth-of-type(${typeIndex})`];
      addresses.push({
        kind: 'positional',
        path: nthOfTypePath,
        constraints: { tag, index: typeIndex, type: 'nth-of-type' },
        meta: { strategy: 'byNthChildAddress', score: 70 },
        target: el
      });
    }
    
    // first-child, last-child
    if (index === 1) {
      const firstChildPath = [`${tag}:first-child`];
      addresses.push({
        kind: 'positional',
        path: firstChildPath,
        constraints: { tag, type: 'first-child' },
        meta: { strategy: 'byNthChildAddress', score: 80 },
        target: el
      });
    }
    
    if (index === siblings.length) {
      const lastChildPath = [`${tag}:last-child`];
      addresses.push({
        kind: 'positional',
        path: lastChildPath,
        constraints: { tag, type: 'last-child' },
        meta: { strategy: 'byNthChildAddress', score: 80 },
        target: el
      });
    }
    
    return addresses;
  }

  /**
   * Address Layer: генерация позиционных адресов с родительскими элементами
   * @param {Element} el
   * @returns {Address[]}
   */
  function byParentWithNthAddress(el) {
    const addresses = [];
    const parent = el.parentElement;
    if (!parent) return addresses;
    
    const tag = el.tagName.toLowerCase();
    const siblings = [...parent.children];
    const index = siblings.indexOf(el) + 1;
    
    // Поиск родителей с ID или классами
    let currentParent = parent;
    let depth = 0;
    
    while (currentParent && depth < 3) {
      // Родитель с ID
      if (currentParent.id) {
        addresses.push({
          kind: 'positional',
          path: [`#${esc(currentParent.id)} > ${tag}:nth-child(${index})`],
          constraints: { parentId: currentParent.id, tag, index, type: 'nth-child' },
          meta: { strategy: 'byParentWithNthAddress', score: 85 },
          target: el
        });
      }
      
      // Родитель с классами
      if (currentParent.classList && currentParent.classList.length > 0) {
        const classes = [...currentParent.classList].filter(c => 
          c && 
          !looksDynamic(c) && 
          !c.startsWith('__dompick')
        ).slice(0, 2);
        if (classes.length > 0) {
          addresses.push({
            kind: 'positional',
            path: [`.${classes.map(c => esc(c)).join('.')} > ${tag}:nth-child(${index})`],
            constraints: { parentClasses: classes, tag, index, type: 'nth-child' },
            meta: { strategy: 'byParentWithNthAddress', score: 80 },
            target: el
          });
        }
      }
      
      currentParent = currentParent.parentElement;
      depth++;
    }
    
    return addresses;
  }

  /**
   * Address Layer: генерация позиционных адресов для календарных элементов
   * @param {Element} el
   * @returns {Address[]}
   */
  function byCalendarSelectorsAddress(el) {
    const addresses = [];
    const tag = el.tagName.toLowerCase();
    
    // Проверяем, находится ли элемент в календаре
    const calendarContainer = el.closest('.calendar, .datepicker, .date-picker, .timepicker, .time-picker, [role="grid"], [role="calendar"]');
    if (!calendarContainer) return addresses;
    
    // Получаем позицию в календаре
    const rows = calendarContainer.querySelectorAll('tr, .calendar-row, .date-row');
    const cells = calendarContainer.querySelectorAll('td, .calendar-cell, .date-cell, [role="gridcell"]');
    
    if (rows.length > 0 && cells.length > 0) {
      // Находим строку и ячейку
      let rowIndex = -1;
      let cellIndex = -1;
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowCells = row.querySelectorAll('td, .calendar-cell, .date-cell, [role="gridcell"]');
        const cellInRow = row.querySelector(tag);
        if (cellInRow === el) {
          rowIndex = i + 1;
          cellIndex = [...rowCells].indexOf(el) + 1;
          break;
        }
      }
      
      if (rowIndex > 0 && cellIndex > 0) {
        let calendarSelector = calendarContainer.tagName.toLowerCase();
        if (calendarContainer.className) {
          const classes = [...calendarContainer.classList].filter(c => c && !looksDynamic(c));
          if (classes.length > 0) {
            calendarSelector = `${calendarSelector}.${classes.map(c => esc(c)).join('.')}`;
          }
        }
        
        addresses.push({
          kind: 'positional',
          path: [`${calendarSelector} tr:nth-child(${rowIndex}) ${tag}:nth-child(${cellIndex})`],
          constraints: { calendarType: 'grid', rowIndex, cellIndex, tag },
          meta: { strategy: 'byCalendarSelectorsAddress', score: 75 },
          target: el
        });
      }
    }
    
    return addresses;
  }

  /**
   * Address Layer: генерация агрессивных fallback адресов
   * @param {Element} el
   * @returns {Address[]}
   */
  function generateAggressiveFallbacksAddress(el) {
    const addresses = [];
    const tag = el.tagName.toLowerCase();
    
    // 1. Селекторы с уникальными родителями + nth-child
    const parentNthAddresses = generateParentNthAddresses(el);
    addresses.push(...parentNthAddresses);

    // 2. Селекторы по позиции в документе
    const allSameTagElements = document.querySelectorAll(tag);
    const elementIndex = [...allSameTagElements].indexOf(el);
    if (elementIndex >= 0) {
      const nthPath = [`${tag}:nth-of-type(${elementIndex + 1})`];
      addresses.push({
        kind: 'positional',
        path: nthPath,
        constraints: { tag, globalIndex: elementIndex + 1, type: 'nth-of-type' },
        meta: { strategy: 'generateAggressiveFallbacksAddress', score: 60 },
        target: el
      });
    }
    
    // 3. Селекторы по атрибутам
    if (el.attributes) {
      for (const {name, value} of el.attributes) {
        if (name && value && value.length < 50 && !looksDynamic(value)) {
          if (name === 'class' && value.includes('__dompick')) continue;
          
          const attrPath = [`[${name}="${esc(value)}"]`];
          addresses.push({
            kind: 'css',
            path: attrPath,
            constraints: { attrName: name, attrValue: value },
            meta: { strategy: 'generateAggressiveFallbacksAddress', score: 65 },
            target: el
          });
          
          const tagAttrPath = [`${tag}[${name}="${esc(value)}"]`];
          addresses.push({
            kind: 'css',
            path: tagAttrPath,
            constraints: { tag, attrName: name, attrValue: value },
            meta: { strategy: 'generateAggressiveFallbacksAddress', score: 70 },
            target: el
          });
        }
      }
    }
    
    // 4. Селекторы по классам
    if (el.classList && el.classList.length > 0) {
      const stableClasses = [...el.classList].filter(c => 
        c && 
        !looksDynamic(c) && 
        !c.startsWith('__dompick') && 
        c.length > 1
      );
      
      for (const cls of stableClasses.slice(0, 3)) {
        const classPath = [`.${esc(cls)}`];
        addresses.push({
          kind: 'css',
          path: classPath,
          constraints: { className: cls },
          meta: { strategy: 'generateAggressiveFallbacksAddress', score: 75 },
          target: el
        });
        
        const tagClassPath = [`${tag}.${esc(cls)}`];
        addresses.push({
          kind: 'css',
          path: tagClassPath,
          constraints: { tag, className: cls },
          meta: { strategy: 'generateAggressiveFallbacksAddress', score: 80 },
          target: el
        });
      }
    }
    
    // 5. Простой селектор по тегу
    const tagPath = [tag];
    addresses.push({
      kind: 'css',
      path: tagPath,
      constraints: { tag },
      meta: { strategy: 'generateAggressiveFallbacksAddress', score: 50 },
      target: el
    });
    
    // 6. Абсолютный CSS-путь
    const absolutePath = buildAbsoluteCssPath(el);
    const absoluteSegments = absolutePath.split(' > ');
    addresses.push({
      kind: 'css',
      path: absoluteSegments,
      constraints: { type: 'absolute-path' },
      meta: { strategy: 'generateAggressiveFallbacksAddress', score: 40 },
      target: el
    });
    
    return addresses;
  }

  /**
   * Address Layer: генерация суперагрессивных fallback адресов
   * @param {Element} el
   * @returns {Address[]}
   */
  function generateSuperAggressiveFallbacksAddress(el) {
    const addresses = [];
    
    // Используем ту же логику, что и generateAggressiveFallbacksAddress, но с более низкими score
    const aggressiveAddresses = generateAggressiveFallbacksAddress(el);
    for (const addr of aggressiveAddresses) {
      addresses.push({
        ...addr,
        meta: { 
          ...addr.meta, 
          strategy: 'generateSuperAggressiveFallbacksAddress',
          score: Math.max(20, addr.meta.score - 20) // Снижаем score на 20
        }
      });
    }
    
    return addresses;
  }

  /**
   * Address Layer: генерация адресов с уникальными родителями + nth-child
   * @param {Element} el
   * @returns {Address[]}
   */
  function generateParentNthAddresses(el) {
    const addresses = [];
    const tag = el.tagName.toLowerCase();
    let currentParent = el.parentElement;
    let depth = 0;
    const maxDepth = 6;
    
    while (currentParent && depth < maxDepth) {
      const siblings = [...currentParent.children];
      const elementIndex = siblings.indexOf(el) + 1;
      
      // Родитель с ID + nth-child
      if (currentParent.id) {
        const parentId = `#${esc(currentParent.id)}`;
        if (document.querySelectorAll(parentId).length === 1) {
          addresses.push({
            kind: 'positional',
            path: [`${parentId} > ${tag}:nth-child(${elementIndex})`],
            constraints: { parentId: currentParent.id, tag, index: elementIndex, type: 'nth-child' },
            meta: { strategy: 'generateParentNthAddresses', score: 90 },
            target: el
          });
        }
      }
      
      currentParent = currentParent.parentElement;
      depth++;
    }
    
    return addresses;
  }

  /**
   * Address Layer: собирает все возможные адреса
   * @param {Element} el
   * @returns {Address[]}
   */
  function collectAllAddresses(el) {
    const allAddresses = [];
    const candidatesMap = new Map();

    // Добавляем адреса порциями, проверяя бюджет
    const addBatch = (batch) => {
      if (!batch || !Array.isArray(batch)) {
        __dlog('debug', `Address Layer: addBatch получил невалидный batch:`, batch);
        return;
      }
      
      for (const addr of batch) {
        if (budgetExpired()) break;
        
        if (!addr || !addr.kind || !addr.path || !Array.isArray(addr.path)) {
          __dlog('debug', `Address Layer: пропускаем невалидный адрес:`, addr);
          continue;
        }
        
        const addrKey = `${addr.kind}:${addr.path.join('|')}`;
        if (!candidatesMap.has(addrKey)) {
          // Проверяем уникальность адреса
          const uniqueness = isUniqueAddress(addr, document);
          if (uniqueness && uniqueness.unique) {
            __dlog('debug', `Address Layer: адрес уникален (count: ${uniqueness.count})`);
            addr.target = el;
            candidatesMap.set(addrKey, addr);
            allAddresses.push(addr);
          } else {
            __dlog('debug', `Address Layer: адрес не уникален (count: ${uniqueness?.count || 0})`);
          }
        }
      }
    };

    // 1) Самые быстрые стратегии
    const stableScopeResults = __timeit('byStableScopePath', () => byStableScopePath(el));
    if (stableScopeResults && stableScopeResults.length > 0) {
      const stableScopeAddresses = stableScopeResults.map(result => ({
        kind: 'css',
        path: [result.sel],
        meta: { strategy: 'byStableScopePath', score: result.score || 0 },
        target: el
      }));
      addBatch(stableScopeAddresses);
    }

    const classCombosResults = __timeit('byClassCombos', () => byClassCombos(el));
    if (classCombosResults && classCombosResults.length > 0) {
      const classCombosAddresses = classCombosResults.map(result => ({
        kind: 'css',
        path: [result.sel],
        meta: { strategy: 'byClassCombos', score: result.score || 0 },
        target: el
      }));
      addBatch(classCombosAddresses);
    }
    
    // 2) Быстрые стратегии с ID и атрибутами
    const idResults = __timeit('byId', () => byId(el));
    if (idResults && idResults.length > 0) {
      const idAddresses = idResults.map(result => ({
        kind: 'css',
        path: [result.sel],
        meta: { strategy: 'byId', score: result.score },
        target: el
      }));
      addBatch(idAddresses);
    }

    const attrResults = __timeit('byAttr', () => byAttr(el));
    if (attrResults && attrResults.length > 0) {
      const attrAddresses = attrResults.map(result => ({
        kind: 'css',
        path: [result.sel],
        meta: { strategy: 'byAttr', score: result.score },
        target: el
      }));
      addBatch(attrAddresses);
    }

    // 3) XPath стратегии
    if (__canRun('byXPath', 2)) {
      const xpathResults = __timeit('byXPath', () => byXPath(el));
      if (xpathResults && xpathResults.length > 0) {
        const xpathAddresses = xpathResults.map(result => ({
          kind: 'xpath',
          path: [result.sel],
          meta: { strategy: 'byXPath', score: result.score },
          target: el
        }));
        addBatch(xpathAddresses);
      }
    }

    // 4) Текстовые стратегии
    if (__dompickConfig.textSearchEnabled) {
      const descendants = __countDescendants(el, __dompickConfig.maxDescendantsForTextSearch + 1);
      if (descendants <= __dompickConfig.maxDescendantsForTextSearch) {
        if (__canRun('byTextAddress', 2)) {
          const textAddresses = __timeit('byTextAddress', () => byTextAddress(el));
          if (textAddresses && textAddresses.length > 0) {
            addBatch(textAddresses);
          }
        }
      } else {
        __dlog('info', `📝 текстовые стратегии: пропуск (${descendants} потомков > ${__dompickConfig.maxDescendantsForTextSearch})`);
      }
    }

    // 5) Позиционные стратегии
    if (!budgetExpired()) {
      const nthAddresses = __timeit('byNthChildAddress', () => byNthChildAddress(el));
      if (nthAddresses && nthAddresses.length > 0) {
        addBatch(nthAddresses);
      }
    }
    if (!budgetExpired()) {
      const parentNthAddresses = __timeit('byParentWithNthAddress', () => byParentWithNthAddress(el));
      if (parentNthAddresses && parentNthAddresses.length > 0) {
        addBatch(parentNthAddresses);
      }
    }
    if (!budgetExpired()) {
      const calendarAddresses = __timeit('byCalendarSelectorsAddress', () => byCalendarSelectorsAddress(el));
      if (calendarAddresses && calendarAddresses.length > 0) {
        addBatch(calendarAddresses);
      }
    }

    // 6) Агрессивные стратегии
    if (__dompickConfig.aggressiveEnabled) {
      const totalDescendants = __countDescendants(document.body, __dompickConfig.domSizeSoftCap + 1);
      if (totalDescendants <= __dompickConfig.domSizeSoftCap) {
        if (__canRun('generateAggressiveFallbacksAddress', 3)) {
          const aggressiveAddresses = __timeit('generateAggressiveFallbacksAddress', () => generateAggressiveFallbacksAddress(el));
          if (aggressiveAddresses && aggressiveAddresses.length > 0) {
            addBatch(aggressiveAddresses);
          }
        }
        if (__canRun('generateSuperAggressiveFallbacksAddress', 4)) {
          const superAggressiveAddresses = __timeit('generateSuperAggressiveFallbacksAddress', () => generateSuperAggressiveFallbacksAddress(el));
          if (superAggressiveAddresses && superAggressiveAddresses.length > 0) {
            addBatch(superAggressiveAddresses);
          }
        }
      } else {
        __dlog('info', `🔥 агрессивные стратегии: пропуск (DOM слишком большой: ${totalDescendants} > ${__dompickConfig.domSizeSoftCap})`);
      }
    }

    return allAddresses;
  }

  /**
   * Address Layer: категоризует адреса по группам
   * @param {Address[]} addresses
   * @returns {Object}
   */
  function categorizeAddresses(addresses) {
    const groups = {
      basic: [],      // Без .contains и nth-child
      contains: [],   // С .contains
      nth: [],        // С nth-child
      xpath: [],      // XPath
      aggressive: []  // Агрессивные fallback
    };

    for (const addr of addresses) {
      switch (addr.kind) {
        case 'xpath':
          groups.xpath.push(addr);
          break;
        case 'text':
          groups.contains.push(addr);
          break;
        case 'positional':
          groups.nth.push(addr);
          break;
        case 'css':
          // Проверяем, содержит ли CSS селектор nth-child
          const cssStr = toCss(addr);
          if (cssStr && (cssStr.includes('nth-child') || cssStr.includes('nth-of-type'))) {
            groups.nth.push(addr);
          } else {
            groups.basic.push(addr);
          }
          break;
        default:
          groups.aggressive.push(addr);
      }
    }

    // Сортировка по score
    const sortByScore = (a, b) => {
      const aScore = a.meta?.score || 0;
      const bScore = b.meta?.score || 0;
      if (aScore !== bScore) return bScore - aScore;
      // При равенстве — более короткий лучше
      const aLength = (a.path && Array.isArray(a.path) ? a.path.join('') : '').length;
      const bLength = (b.path && Array.isArray(b.path) ? b.path.join('') : '').length;
      return aLength - bLength;
    };

    groups.basic.sort(sortByScore);
    groups.contains.sort(sortByScore);
    groups.nth.sort(sortByScore);
    groups.xpath.sort(sortByScore);
    groups.aggressive.sort(sortByScore);

    return groups;
  }

  // =========================================================================
  // РАЗДЕЛ 4: СТИЛИ И UI КОМПОНЕНТЫ
  // =========================================================================
  
  // --- Утилита для перетаскивания элемента ---
/**
 * Делает элемент перетаскиваемым с прилипаниями к краям и гарантией полной видимости.
 * @param {HTMLElement} targetEl
 * @param {HTMLElement} handleEl
 * @param {Object} options
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
  let startX = 0, startY = 0; // координаты указателя при старте
  let baseLeft = 0, baseTop = 0; // абсолютная позиция ЭЛЕМЕНТА при старте (origin для дельты)
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

  // --- безопасная установка HTML на страницах с Trusted Types ---
  const setTrustedHTML = (() => {
    let policy = null;

    // 1) Если доступен Sanitizer API — используем его
    const canSanitize = typeof Element.prototype.setHTML === 'function' && 'Sanitizer' in window;

    // 2) Пытаемся создать TT-политику (имя 'default' часто разрешено; fallback — своё имя)
    if (window.trustedTypes) {
      try { policy = trustedTypes.createPolicy('default', { createHTML: s => s }); } catch {}
      if (!policy) {
        try { policy = trustedTypes.createPolicy('dompick', { createHTML: s => s }); } catch {}
      }
    }

    return (el, html) => {
      // a) Через Sanitizer API
      if (canSanitize) {
        try { el.setHTML(html, { sanitizer: new Sanitizer() }); return; } catch {}
      }
      // b) Через Trusted Types (если политику дали создать)
      if (policy) {
        el.innerHTML = policy.createHTML(html);
        return;
      }
      // c) Фолбэк: парсим строку и вставляем готовые узлы (без innerHTML)
      while (el.firstChild) el.removeChild(el.firstChild);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const frag = document.createDocumentFragment();
      for (const node of Array.from(doc.body.childNodes)) frag.appendChild(node);
      el.appendChild(frag);
    };
  })();
  
  // --- Внедрение CSS стилей ---
  // Создает и добавляет в <head> все необходимые стили для UI компонентов.
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
      margin-bottom: 8px;
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

  // --- Создание и управление основной панелью ---
  const panel = document.createElement('div');
  panel.className = '__dompick-panel __dompick-theme-transition';
  setTrustedHTML(panel, `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
      <div style="flex: 1;">
        <div style="font-weight: bold; margin-bottom: 4px; color: var(--dompick-text-primary);">
          DOM Picker <span style="opacity:.6; color: var(--dompick-text-secondary);">${__dompickVersion}</span>
        </div>
        <div class="__dompick-help" id="__dompick-help">
          <div>Ctrl+клик - показать селекторы</div>
        </div>
        <div style="margin-top:6px; display:flex; 
          align-items:center; gap:6px; flex-wrap:wrap;">
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
  `);
  document.body.appendChild(panel);
  
  // --- Уведомления (Toast) ---
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
  
  // --- Управление модальным окном и темами ---
  function openModalFor(el) {
    // Проверяем кэш для этого элемента
    if (__dompickSelectorCache && __dompickCachedElement === el) {
      // Используем кэшированные селекторы
      const modal = document.createElement('div');
      modal.className = '__dompick-modal';
      setTrustedHTML(modal, `
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
      `);
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

        // Address Layer: функция форматирования адресов для текущего режима
        const formatAddresses = (addresses) => {
          if (!addresses || !Array.isArray(addresses)) return [];
          return addresses.map(addr => {
            const formatted = addressToSelector(__dompickMode, addr);
            if (!formatted) {
              __dlog('debug', 'Address Layer: не удалось отформатировать адрес:', addr);
              return null;
            }
            return {
              sel: formatted,
              isCypress: __dompickMode === 'cypress',
              isJs: __dompickMode === 'js',
              score: addr.meta?.score,
              __targetEl: el,
              __address: addr
            };
          }).filter(Boolean); // Убираем null значения
        };

        // Address Layer: если включен address pipe, форматируем адреса перед отображением
        if (__dompickAddressPipeEnabled) {
          createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', formatAddresses(cachedGroups.basicSelectors), formatAddresses(cachedGroups.moreBasic), availableActions, 'basic');
          const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
          createSelectorGroup(groupsContainer, containsTitle, formatAddresses(cachedGroups.containsSelectors), formatAddresses(cachedGroups.moreContains), availableActions, 'contains');
          createSelectorGroup(groupsContainer, 'Позиционные селекторы', formatAddresses(cachedGroups.nthSelectors), formatAddresses(cachedGroups.moreNth), availableActions, 'nth');
          createSelectorGroup(groupsContainer, 'XPath селекторы', formatAddresses(cachedGroups.xpathSelectors || []), formatAddresses(cachedGroups.moreXPath || []), availableActions, 'xpath');
          if (cachedGroups.aggressive && cachedGroups.aggressive.length > 0) {
            createSelectorGroup(groupsContainer, 'Агрессивные селекторы', formatAddresses(cachedGroups.aggressive.slice(0, 5)), formatAddresses(cachedGroups.aggressive.slice(5)), availableActions, 'aggressive');
          }
        } else {
          // Обычный режим без Address Layer
          createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', cachedGroups.basicSelectors, cachedGroups.moreBasic, availableActions, 'basic');
          const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
          createSelectorGroup(groupsContainer, containsTitle, cachedGroups.containsSelectors, cachedGroups.moreContains, availableActions, 'contains');
          createSelectorGroup(groupsContainer, 'Позиционные селекторы', cachedGroups.nthSelectors, cachedGroups.moreNth, availableActions, 'nth');
          createSelectorGroup(groupsContainer, 'XPath селекторы', cachedGroups.xpathSelectors || [], cachedGroups.moreXPath || [], availableActions, 'xpath');
          if (cachedGroups.aggressive && cachedGroups.aggressive.length > 0) {
            createSelectorGroup(groupsContainer, 'Агрессивные селекторы', cachedGroups.aggressive.slice(0, 5), cachedGroups.aggressive.slice(5), availableActions, 'aggressive');
          }
        }
        
        // Если нет кэша для противоположного режима, генерируем его в фоне
        const oppositeMode = __dompickMode === 'cypress' ? 'js' : 'cypress';
        if (!__dompickSelectorCache[oppositeMode]) {
          setTimeout(() => {
            const originalMode = __dompickMode;
            __dompickMode = oppositeMode;
            resetPerfGuards();
            const oppositeGroups = buildCandidates(el);
            __dompickMode = originalMode;
            __dompickSelectorCache[oppositeMode] = oppositeGroups;
            resetPerfGuards();
          }, 100);
        }
      }, 50);
      return;
    }

    // Открываем модалку СРАЗУ, а тяжёлую генерацию переносим на idle/next-tick
    const modal = document.createElement('div');
    modal.className = '__dompick-modal';
    setTrustedHTML(modal, `
      <div class="__dompick-backdrop"></div>
      <div class="__dompick-dialog __dompick-theme-transition">
        <div class="__dompick-head">
          <div class="__dompick-title">Селекторы для ${__dompickMode === 'js' ? 'JS' : 'Cypress'}</div>
          <button class="__dompick-copy" data-close>✖</button>
        </div>
        <div class="__dompick-body">
          <div class="__dompick-groups">
            <div 
              id="__dompick-loading" style="opacity:.8;font-size:12px;color:var(--dompick-text-secondary)">Генерация селекторов...</div>
          </div>
        </div>
      </div>
    `);
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
    const runAsync = () => { // фоновая (idle/next-tick) генерация селекторов
      // Устанавливаем увеличенный бюджет на генерацию и чистим кэш
      resetPerfGuards();
      const __buildStart = performance.now();
      __buildBudgetEnd = __buildStart + (__dompickConfig.buildBudgetMs || 5000); // можно увеличить при необходимости
      
      // Генерируем селекторы для текущего режима
      const groups = buildCandidates(el);
      const __buildMs = performance.now() - __buildStart;
      if (__dompickConfig.debug) {
        __perfStats.buildRuns.push({ ctx: 'modalAsync', ms: __buildMs,
          basic: groups.basicSelectors.length, contains: groups.containsSelectors.length,
          nth: groups.nthSelectors.length, aggressive: (groups.aggressive?.length || 0)
        });
        if (__buildMs > __dompickConfig.slowBuildThresholdMs) {
          __dlog('info', `⏱️ генерация (async) заняла ${__buildMs.toFixed(1)}ms (>${__dompickConfig.slowBuildThresholdMs}ms)`);
        }
      }
      
      // Инициализируем кэш для текущего режима
      __dompickSelectorCache = {
        [__dompickMode]: groups
      };
      __dompickCachedElement = el;
      
      // Address Layer: если включен address pipe, сохраняем адреса в отдельный кэш
      if (__dompickAddressPipeEnabled) {
        __dompickAddressCache = groups;
      }
      
      // Генерируем селекторы для противоположного режима в фоне
      const oppositeMode = __dompickMode === 'cypress' ? 'js' : 'cypress';
      const originalMode = __dompickMode;
      
      // Временно переключаем режим для генерации
      __dompickMode = oppositeMode;
      resetPerfGuards();
      const oppositeGroups = buildCandidates(el);
      __dompickMode = originalMode; // Возвращаем исходный режим
      
      // Сохраняем селекторы для противоположного режима в кэш
      __dompickSelectorCache[oppositeMode] = oppositeGroups;
      
      if (__dompickConfig.debug) {
        __dlog('info', `✅ Сгенерированы селекторы для режима ${oppositeMode}: ${oppositeGroups.basicSelectors.length} базовых, ${oppositeGroups.containsSelectors.length} текстовых, ${oppositeGroups.nthSelectors.length} позиционных`);
      }
      
      resetPerfGuards();

      // Address Layer: функция форматирования адресов для текущего режима
      const formatAddresses = (addresses) => {
        if (!addresses || !Array.isArray(addresses)) return [];
        return addresses.map(addr => {
          const formatted = addressToSelector(__dompickMode, addr);
          if (!formatted) {
            __dlog('debug', 'Address Layer: не удалось отформатировать адрес:', addr);
            return null;
          }
          return {
            sel: formatted,
            isCypress: __dompickMode === 'cypress',
            isJs: __dompickMode === 'js',
            score: addr.meta?.score,
            __targetEl: el,
            __address: addr
          };
        }).filter(Boolean); // Убираем null значения
      };

      const availableActions = getAvailableActions(el);
      const loading = groupsContainer.querySelector('#__dompick-loading');
      if (loading) loading.remove();
      
      // Address Layer: если включен address pipe, форматируем адреса перед отображением
      if (__dompickAddressPipeEnabled) {
        createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', formatAddresses(groups.basicSelectors), formatAddresses(groups.moreBasic), availableActions, 'basic');
        const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
        createSelectorGroup(groupsContainer, containsTitle, formatAddresses(groups.containsSelectors), formatAddresses(groups.moreContains), availableActions, 'contains');
        createSelectorGroup(groupsContainer, 'Позиционные селекторы', formatAddresses(groups.nthSelectors), formatAddresses(groups.moreNth), availableActions, 'nth');
        createSelectorGroup(groupsContainer, 'XPath селекторы', formatAddresses(groups.xpathSelectors || []), formatAddresses(groups.moreXPath || []), availableActions, 'xpath');

        // Если есть агрессивные — тоже показываем
        if (groups.aggressive && groups.aggressive.length > 0) {
          createSelectorGroup(groupsContainer, 'Агрессивные селекторы', formatAddresses(groups.aggressive.slice(0, 5)), formatAddresses(groups.aggressive.slice(5)), availableActions, 'aggressive');
        }
      } else {
        // Обычный режим без Address Layer
        createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', groups.basicSelectors, groups.moreBasic, availableActions, 'basic');
        const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
        createSelectorGroup(groupsContainer, containsTitle, groups.containsSelectors, groups.moreContains, availableActions, 'contains');
        createSelectorGroup(groupsContainer, 'Позиционные селекторы', groups.nthSelectors, groups.moreNth, availableActions, 'nth');
        createSelectorGroup(groupsContainer, 'XPath селекторы', groups.xpathSelectors || [], groups.moreXPath || [], availableActions, 'xpath');

        // Если есть агрессивные — тоже показываем
        if (groups.aggressive && groups.aggressive.length > 0) {
          createSelectorGroup(groupsContainer, 'Агрессивные селекторы', groups.aggressive.slice(0, 5), groups.aggressive.slice(5), availableActions, 'aggressive');
        }
      }

      // ГАРАНТИЯ: если ни одного селектора не сгенерировалось — формируем абсолютный CSS‑путь
      const totalCount = groups.basicSelectors.length + groups.containsSelectors.length + groups.nthSelectors.length + (groups.xpathSelectors?.length || 0) + (groups.aggressive?.length || 0);
      if (totalCount === 0) {
        const absPath = buildAbsoluteCssPath(el);
        const fallback = [{ sel: absPath }];
        createSelectorGroup(groupsContainer, 'Агрессивные селекторы (fallback)', fallback, [], availableActions, 'aggressive');
      }
      
      resetPerfGuards();
      __dumpPerfSummary('modalAsync', groups);
      // Убираем фоновую генерацию - селекторы для противоположного режима будут генерироваться при первом переключении
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(runAsync, { timeout: 250 });
    } else {
      setTimeout(runAsync, 0);
    }
  }

  // Создание группы селекторов в модальном окне
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

  // Добавление строки с селектором в группу
  function addSelectorToGroup(container, selector, availableActions, number) {
    // Address Layer: проверяем валидность селектора
    if (!selector || !selector.sel) {
      __dlog('debug', 'Address Layer: addSelectorToGroup получил невалидный селектор:', selector);
      return;
    }
    const selectorRow = document.createElement('div');
    selectorRow.className = '__dompick-selector-row';
    selectorRow.style.display = 'grid';
    selectorRow.style.gridTemplateColumns = '1fr auto auto';
    selectorRow.style.gap = '12px';
    selectorRow.style.alignItems = 'center';
    selectorRow.style.marginBottom = '8px';
    
    const buildBaseForMode = () => {
      // Address Layer: если есть адрес, форматируем его для текущего режима
      if (__dompickAddressPipeEnabled && selector.__address) {
        const formatted = addressToSelector(__dompickMode, selector.__address);
        if (formatted) return formatted;
      }
      
      // Address Layer: проверяем, что у нас есть валидный селектор
      if (!selector.sel) {
        __dlog('debug', 'Address Layer: buildBaseForMode получил селектор без sel:', selector);
        return '// Ошибка: не удалось сгенерировать селектор';
      }
      
      // Address Layer: дополнительная проверка на валидность строки
      if (typeof selector.sel !== 'string') {
        __dlog('debug', 'Address Layer: buildBaseForMode получил селектор с невалидным sel:', selector.sel);
        return '// Ошибка: невалидный селектор';
      }
      
      // ✅ XPath: показываем корректные выражения для текущего режима
      if (selector.isXPath) {
        if (__dompickMode === 'js') {
          return `document.evaluate(${JSON.stringify(selector.sel)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
        } else {
          // Для Cypress c плагином cypress-xpath
          return `cy.xpath(${JSON.stringify(selector.sel)})`;
        }
      }

      if (__dompickMode === 'js') {
        if (selector.isCypress) return convertCypressToJsBase(selector.sel);
        if (selector.isJs) return selector.sel;
        return `document.querySelector('${selector.sel}')`;
      } else {
        if (selector.isCypress) return selector.sel;
        if (selector.isJs || (selector.sel && (selector.sel.includes('document.querySelector') || selector.sel.includes('Array.from')))) {
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
    
    setTrustedHTML(selectorPart, `<div><b>${number}.</b> </div>`);
    selectorPart.querySelector('div').appendChild(codeElement);

    // Бейдж рейтинга (0..100), цвет от красного к зелёному
    let rawScore = 0;
    if (__dompickAddressPipeEnabled && selector.__address && selector.__address.meta && selector.__address.meta.score !== undefined) {
      // Address Layer: используем score из адреса если доступен
      rawScore = selector.__address.meta.score;
    } else if (typeof computeSelectorScore === 'function') {
      rawScore = computeSelectorScore(selector, selector.__targetEl || null);
    }
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

  // --- Управление темами и режимами ---
  const applyModeStyles = () => {
    const modeBtnCypress = panel.querySelector('#__dompick-mode-cypress');
    const modeBtnJs = panel.querySelector('#__dompick-mode-js');
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
    if (__dompickConfig.debug) {
      __dlog('info', `🔄 Переключение режима на ${__dompickMode}, обновление модального окна...`);
    }
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
      setTrustedHTML(groupsContainer, '<div style="opacity:.8;font-size:12px;color:var(--dompick-text-secondary)">' +
        'Сначала выберите элемент (Ctrl+клик).' +
        '</div>');
      return;
    }
    
    // Обновляем заголовок модального окна
    const title = modal.querySelector('.__dompick-title');
    if (title) {
      title.textContent = `Селекторы для ${__dompickMode === 'js' ? 'JS' : 'Cypress'}`;
    }
    
    // Address Layer: общая функция форматирования адресов
    const formatAddresses = (addresses) => {
      if (!addresses || !Array.isArray(addresses)) return [];
      return addresses.map(addr => {
        const formatted = addressToSelector(__dompickMode, addr);
        if (!formatted) {
          __dlog('debug', 'Address Layer: не удалось отформатировать адрес:', addr);
          return null;
        }
        return {
          sel: formatted,
          isCypress: __dompickMode === 'cypress',
          isJs: __dompickMode === 'js',
          score: addr.meta?.score,
          __targetEl: __dompickCachedElement,
          __address: addr
        };
      }).filter(Boolean); // Убираем null значения
    };
    
    // Если есть кэш для текущего режима, используем его
    if (__dompickAddressPipeEnabled && __dompickAddressCache && __dompickCachedElement) {
      // Address Layer: используем адресный кэш
      clearNode(groupsContainer);
      const availableActions = getAvailableActions(__dompickCachedElement);
      const cachedAddresses = __dompickAddressCache;
      
      createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', formatAddresses(cachedAddresses.basicSelectors || []), formatAddresses(cachedAddresses.moreBasic || []), availableActions, 'basic');
      const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
      createSelectorGroup(groupsContainer, containsTitle, formatAddresses(cachedAddresses.containsSelectors || []), formatAddresses(cachedAddresses.moreContains || []), availableActions, 'contains');
      createSelectorGroup(groupsContainer, 'Позиционные селекторы', formatAddresses(cachedAddresses.nthSelectors || []), formatAddresses(cachedAddresses.moreNth || []), availableActions, 'nth');
      createSelectorGroup(groupsContainer, 'XPath селекторы', formatAddresses(cachedAddresses.xpathSelectors || []), formatAddresses(cachedAddresses.moreXPath || []), availableActions, 'xpath');
      if (cachedAddresses.aggressive && cachedAddresses.aggressive.length > 0) {
        createSelectorGroup(groupsContainer, 'Агрессивные селекторы', formatAddresses(cachedAddresses.aggressive.slice(0, 5)), formatAddresses(cachedAddresses.aggressive.slice(5)), availableActions, 'aggressive');
      }
      return;
    } else if (__dompickSelectorCache && __dompickCachedElement && __dompickSelectorCache[__dompickMode]) {
      // Очищаем содержимое
      clearNode(groupsContainer);
      const availableActions = getAvailableActions(__dompickCachedElement);
      const cachedGroups = __dompickSelectorCache[__dompickMode];
      
      createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', cachedGroups.basicSelectors, cachedGroups.moreBasic, availableActions, 'basic');
      const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
      createSelectorGroup(groupsContainer, containsTitle, cachedGroups.containsSelectors, cachedGroups.moreContains, availableActions, 'contains');
      createSelectorGroup(groupsContainer, 'Позиционные селекторы', cachedGroups.nthSelectors, cachedGroups.moreNth, availableActions, 'nth');
      createSelectorGroup(groupsContainer, 'XPath селекторы', cachedGroups.xpathSelectors || [], cachedGroups.moreXPath || [], availableActions, 'xpath');
      if (cachedGroups.aggressive && cachedGroups.aggressive.length > 0) {
        createSelectorGroup(groupsContainer, 'Агрессивные селекторы', cachedGroups.aggressive.slice(0, 5), cachedGroups.aggressive.slice(5), availableActions, 'aggressive');
      }
      return;
    } else if (__dompickSelectorCache && __dompickCachedElement) {
      // Есть кэш, но не для текущего режима - генерируем для текущего режима
      if (__dompickConfig.debug) {
        __dlog('info', `🔄 Генерация селекторов для режима ${__dompickMode} (кэш есть, но не для текущего режима)`);
      }
      setTrustedHTML(groupsContainer, '<div id="__dompick-loading" style="opacity:.8;font-size:12px;color:var(--dompick-text-secondary)">Генерация селекторов для текущего режима...</div>');
      
      setTimeout(() => {
        resetPerfGuards();
        const __buildStart = performance.now();
        __buildBudgetEnd = __buildStart + (__dompickConfig.buildBudgetMs || 5000);
        
        const groups = buildCandidates(__dompickCachedElement);
        const __buildMs = performance.now() - __buildStart;
        
        // Сохраняем селекторы для текущего режима в кэш
        __dompickSelectorCache[__dompickMode] = groups;
        
        // Отображаем селекторы
        const loading = groupsContainer.querySelector('#__dompick-loading');
        if (loading) loading.remove();
        
        const availableActions = getAvailableActions(__dompickCachedElement);
        
        // Address Layer: если включен address pipe, форматируем адреса перед отображением
        if (__dompickAddressPipeEnabled) {
          createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', formatAddresses(groups.basicSelectors), formatAddresses(groups.moreBasic), availableActions, 'basic');
          const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
          createSelectorGroup(groupsContainer, containsTitle, formatAddresses(groups.containsSelectors), formatAddresses(groups.moreContains), availableActions, 'contains');
          createSelectorGroup(groupsContainer, 'Позиционные селекторы', formatAddresses(groups.nthSelectors), formatAddresses(groups.moreNth), availableActions, 'nth');
          createSelectorGroup(groupsContainer, 'XPath селекторы', formatAddresses(groups.xpathSelectors || []), formatAddresses(groups.moreXPath || []), availableActions, 'xpath');
          if (groups.aggressive && groups.aggressive.length > 0) {
            createSelectorGroup(groupsContainer, 'Агрессивные селекторы', formatAddresses(groups.aggressive.slice(0, 5)), formatAddresses(groups.aggressive.slice(5)), availableActions, 'aggressive');
          }
        } else {
          // Обычный режим без Address Layer
          createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', groups.basicSelectors, groups.moreBasic, availableActions, 'basic');
          const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
          createSelectorGroup(groupsContainer, containsTitle, groups.containsSelectors, groups.moreContains, availableActions, 'contains');
          createSelectorGroup(groupsContainer, 'Позиционные селекторы', groups.nthSelectors, groups.moreNth, availableActions, 'nth');
          createSelectorGroup(groupsContainer, 'XPath селекторы', groups.xpathSelectors || [], groups.moreXPath || [], availableActions, 'xpath');
          if (groups.aggressive && groups.aggressive.length > 0) {
            createSelectorGroup(groupsContainer, 'Агрессивные селекторы', groups.aggressive.slice(0, 5), groups.aggressive.slice(5), availableActions, 'aggressive');
          }
        }
        
        resetPerfGuards();
      }, 100);
      return;
    }
    
    // Если кэша нет, показываем состояние загрузки и генерируем селекторы синхронно
    setTrustedHTML(groupsContainer, '<div id="__dompick-loading" style="opacity:.8;font-size:12px;color:var(--dompick-text-secondary)">Генерация селекторов...</div>');

    // Небольшая задержка чтобы пользователь увидел сообщение о загрузке
    setTimeout(() => {
      // Генерируем селекторы для текущего режима синхронно
      resetPerfGuards();
      const __buildStart = performance.now();
      __buildBudgetEnd = __buildStart + (__dompickConfig.buildBudgetMs || 5000);
      
      const groups = buildCandidates(__dompickCachedElement);
      const __buildMs = performance.now() - __buildStart;
      if (__dompickConfig.debug) {
        __perfStats.buildRuns.push({ ctx: 'modalSync', ms: __buildMs, 
          basic: groups.basicSelectors.length, contains: groups.containsSelectors.length,
          nth: groups.nthSelectors.length, aggressive: (groups.aggressive?.length || 0)
        });
        if (__buildMs > __dompickConfig.slowBuildThresholdMs) {
          __dlog('info', `⏱️ генерация заняла ${__buildMs.toFixed(1)}ms (>${__dompickConfig.slowBuildThresholdMs}ms)`);
        }
      }
      
      // Инициализируем кэш если его нет
      if (__dompickAddressPipeEnabled) {
        // Address Layer: сохраняем адреса в кэш
        __dompickAddressCache = groups;
      } else {
        if (!__dompickSelectorCache) {
          __dompickSelectorCache = {};
        }
        // Сохраняем селекторы для текущего режима
        __dompickSelectorCache[__dompickMode] = groups;
      }

      // Отображаем селекторы
      const loading = groupsContainer.querySelector('#__dompick-loading');
      if (loading) loading.remove();
      
      const availableActions = getAvailableActions(__dompickCachedElement);
      
      // Address Layer: форматируем адреса если используем address pipe
      if (__dompickAddressPipeEnabled) {
        createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', formatAddresses(groups.basicSelectors), formatAddresses(groups.moreBasic), availableActions, 'basic');
        const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
        createSelectorGroup(groupsContainer, containsTitle, formatAddresses(groups.containsSelectors), formatAddresses(groups.moreContains), availableActions, 'contains');
        createSelectorGroup(groupsContainer, 'Позиционные селекторы', formatAddresses(groups.nthSelectors), formatAddresses(groups.moreNth), availableActions, 'nth');
        createSelectorGroup(groupsContainer, 'XPath селекторы', formatAddresses(groups.xpathSelectors || []), formatAddresses(groups.moreXPath || []), availableActions, 'xpath');
        if (groups.aggressive && groups.aggressive.length > 0) {
          createSelectorGroup(groupsContainer, 'Агрессивные селекторы', formatAddresses(groups.aggressive.slice(0, 5)), formatAddresses(groups.aggressive.slice(5)), availableActions, 'aggressive');
        }
      } else {
        createSelectorGroup(groupsContainer, 'Базовые селекторы CSS', groups.basicSelectors, groups.moreBasic, availableActions, 'basic');
        const containsTitle = (__dompickMode === 'js') ? 'Селекторы по тексту' : 'Селекторы с .contains';
        createSelectorGroup(groupsContainer, containsTitle, groups.containsSelectors, groups.moreContains, availableActions, 'contains');
        createSelectorGroup(groupsContainer, 'Позиционные селекторы', groups.nthSelectors, groups.moreNth, availableActions, 'nth');
        createSelectorGroup(groupsContainer, 'XPath селекторы', groups.xpathSelectors || [], groups.moreXPath || [], availableActions, 'xpath');
        if (groups.aggressive && groups.aggressive.length > 0) {
          createSelectorGroup(groupsContainer, 'Агрессивные селекторы', groups.aggressive.slice(0, 5), groups.aggressive.slice(5), availableActions, 'aggressive');
        }
      }
      
      // ГАРАНТИЯ: если ни одного селектора не сгенерировалось — формируем абсолютный CSS‑путь
      const totalCount = groups.basicSelectors.length + groups.containsSelectors.length + groups.nthSelectors.length + (groups.xpathSelectors?.length || 0) + (groups.aggressive?.length || 0);
      if (totalCount === 0) {
        const absPath = buildAbsoluteCssPath(__dompickCachedElement);
        const fallback = [{ sel: absPath }];
        createSelectorGroup(groupsContainer, 'Агрессивные селекторы (fallback)', fallback, [], availableActions, 'aggressive');
      }
      
      resetPerfGuards();
      __dumpPerfSummary('modalAsync', groups);
    }, 200); // Небольшая задержка для обновления UI
  };
  
  // =========================================================================
  // РАЗДЕЛ 5: ГЛАВНЫЕ ОБРАБОТЧИКИ СОБЫТИЙ
  // =========================================================================
  
  // --- Управление режимом выбора (Selection Mode) ---
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
  
  // --- Обработчики событий клавиатуры и мыши ---
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

  // =========================================================================
  // РАЗДЕЛ 6: ОСНОВНАЯ ЛОГИКА - ГЕНЕРАЦИЯ СЕЛЕКТОРОВ
  // =========================================================================

  // --- Функции-оркестраторы ---
  // Управляют процессом сбора, категоризации и сортировки селекторов.
  function buildCandidates(original) {
    const el = snapTarget(original);
    
    if (__dompickAddressPipeEnabled) {
      // Address Layer: собираем адреса вместо строк
      const allAddresses = collectAllAddresses(el);
      
      // Address Layer: smoke-тест для адресов
      const basicAddresses = allAddresses.filter(addr => addr.kind === 'css' && addr.path && addr.path[0] && !addr.path[0].includes('nth-child') && !addr.path[0].includes('nth-of-type'));
      if (basicAddresses.length >= 1) {
        const firstBasic = basicAddresses[0];
        const uniqueness = isUniqueAddress(firstBasic, document);
        if (uniqueness && uniqueness.unique) {
          __dlog('info', `✅ SMOKE OK: найден ${basicAddresses.length} базовый адрес, первый уникален`);
        } else {
          __dlog('info', `⚠️ SMOKE WARN: найден ${basicAddresses.length} базовый адрес, но первый НЕ уникален`);
        }
      } else {
        __dlog('info', `⚠️ SMOKE WARN: базовых адресов не найдено`);
      }
      
      // Группируем адреса по типам
      const groups = categorizeAddresses(allAddresses);
      return {
        basicSelectors: groups.basic.slice(0, 3),
        containsSelectors: groups.contains.slice(0, 3),
        nthSelectors: groups.nth.slice(0, 3),
        xpathSelectors: (groups.xpath || []).slice(0, 3),
        moreBasic: groups.basic.slice(3),
        moreContains: groups.contains.slice(3),
        moreNth: groups.nth.slice(3),
        moreXPath: (groups.xpath || []).slice(3),
        aggressive: groups.aggressive
      };
    } else {
      // Собираем все возможные селекторы
      const allSelectors = collectAllSelectors(el);
      
      // Address Layer: smoke-тест
      const basicSelectors = allSelectors.filter(s => !s.sel.includes('cy.contains') && !s.sel.includes('.contains(') && !s.sel.includes('nth-child') && !s.sel.includes('nth-of-type'));
      if (basicSelectors.length >= 1) {
        const firstBasic = basicSelectors[0];
        const isUnique = document.querySelectorAll(firstBasic.sel).length === 1;
        if (isUnique) {
          __dlog('info', `✅ SMOKE OK: найден ${basicSelectors.length} базовый селектор, первый уникален`);
        } else {
          __dlog('info', `⚠️ SMOKE WARN: найден ${basicSelectors.length} базовый селектор, но первый НЕ уникален`);
        }
      } else {
        __dlog('info', `⚠️ SMOKE WARN: базовых селекторов не найдено`);
      }
      
      // Группируем селекторы по типам
      const groups = categorizeSelectors(allSelectors);
      return {
        basicSelectors: groups.basic.slice(0, 3),      // Первые 3 без .contains и nth-child
        containsSelectors: groups.contains.slice(0, 3), // 4,5,6 с .contains
        nthSelectors: groups.nth.slice(0, 3),          // 7,8,9 с nth-child
        xpathSelectors: (groups.xpath || []).slice(0, 3),          // 7,8,9 с nth-child
        
        // Резервные селекторы для кнопок "ещё вариантов"
        moreBasic: groups.basic.slice(3),
        moreContains: groups.contains.slice(3),
        moreNth: groups.nth.slice(3),
        moreXPath: (groups.xpath || []).slice(3),
        
        // Дополнительные агрессивные селекторы
        aggressive: groups.aggressive
      };
    }
  }

  // Собирает все возможные селекторы, запуская различные стратегии.
  function collectAllSelectors(el) { // :contentReference{index=7}
    // Address Layer: подробный лог ветки
    if (__dompickAddressPipeEnabled) {
      __dlog('info', `🔗 Address Pipe: ВКЛЮЧЕН (ветка addressPipe)`);
    } else {
      __dlog('info', `🔗 Address Pipe: ВЫКЛЮЧЕН (ветка legacy)`);
    }
    
    const allSelectors = [];
    const candidatesMap = new Map();

    // Добавляем селекторы порциями, проверяя бюджет
    const addBatch = (batch) => {
      for (const item of batch) {
        if (budgetExpired()) break;
        if (!candidatesMap.has(item.sel)) {
          if (__dompickAddressPipeEnabled && item.__address) {
            // Address Layer: проверяем уникальность адреса
            const uniqueness = isUniqueAddress(item.__address, document);
            if (uniqueness && uniqueness.unique) {
              __dlog('debug', `Address Layer: адрес уникален (count: ${uniqueness.count})`);
              item.__targetEl = el;
              candidatesMap.set(item.sel, item);
              allSelectors.push(item);
            } else {
              __dlog('debug', `Address Layer: адрес не уникален (count: ${uniqueness?.count || 0})`);
            }
          } else if (item.isCypress) {
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
    addBatch(__timeit('byStableScopePath', () => byStableScopePath(el)));
    addBatch(__timeit('byClassCombos', () => byClassCombos(el)));
    
    // Address Layer: оборачиваем быстрые стратегии в Address
    if (__dompickAddressPipeEnabled) {
      const attrResults = __timeit('byAttr', () => byAttr(el));
      const attrAddresses = attrResults.map(result => ({
        kind: 'css',
        path: [result.sel],
        meta: { strategy: 'byAttr', score: result.score },
        target: el
      }));
      addBatch(attrAddresses.map(addr => ({
        sel: addressToSelector(__dompickMode, addr),
        isCypress: __dompickMode === 'cypress',
        isJs: __dompickMode === 'js',
        score: addr.meta.score,
        __targetEl: el,
        __address: addr // Address Layer: сохраняем ссылку на адрес для проверки уникальности
      })));
      
      const idResults = __timeit('byId', () => byId(el));
      const idAddresses = idResults.map(result => ({
        kind: 'css',
        path: [result.sel],
        meta: { strategy: 'byId', score: result.score },
        target: el
      }));
      addBatch(idAddresses.map(addr => ({
        sel: addressToSelector(__dompickMode, addr),
        isCypress: __dompickMode === 'cypress',
        isJs: __dompickMode === 'js',
        score: addr.meta.score,
        __targetEl: el,
        __address: addr // Address Layer: сохраняем ссылку на адрес для проверки уникальности
      })));
    } else {
      addBatch(__timeit('byAttr', () => byAttr(el)));
      addBatch(__timeit('byId', () => byId(el)));
    }
    
    addBatch(__timeit('byPreferredData', () => byPreferredData(el)));

    // 2) Остальные базовые
    addBatch(__timeit('byAnyData', () => byAnyData(el)));
    addBatch(__timeit('uniqueWithinScope', () => uniqueWithinScope(el)));
    addBatch(__timeit('nthPath', () => nthPath(el)));
    addBatch(__timeit('byXPath', () => byXPath(el)));
// Подсчитываем "хорошие" базовые селекторы для гейтинга
    const goodBasicCount = allSelectors.length;
    const haveEnoughBasic = goodBasicCount >= __dompickConfig.targetEnoughBasic;

    // 3) Текстовые (дорогие) — гейтим по количеству базовых и размеру DOM
    if (__dompickConfig.textSearchEnabled && !haveEnoughBasic) {
      const descendants = __countDescendants(el, __dompickConfig.maxDescendantsForTextSearch + 1);
      if (descendants <= __dompickConfig.maxDescendantsForTextSearch) {
        if (__dompickAddressPipeEnabled) {
          // Address Layer: используем byTextAddress вместо старых текстовых стратегий
          if (__canRun('byTextAddress', 2)) {
            const textAddresses = __timeit('byTextAddress', () => byTextAddress(el));
            addBatch(textAddresses.map(addr => ({
              sel: addressToSelector(__dompickMode, addr),
              isCypress: __dompickMode === 'cypress',
              isJs: __dompickMode === 'js',
              score: addr.meta.score,
              __targetEl: el,
              __address: addr // Address Layer: сохраняем ссылку на адрес для проверки уникальности
            })));
          }
        } else {
          // Address Layer: старые текстовые стратегии удалены - заменены на byTextAddress
        }
      } else {
        __dlog('info', `📝 текстовые стратегии: пропуск (${descendants} потомков > ${__dompickConfig.maxDescendantsForTextSearch})`);
      }
    } else if (!__dompickConfig.textSearchEnabled) {
      __dlog('info', '📝 текстовые стратегии: отключены глобально');
    } else {
      __dlog('info', `📝 текстовые стратегии: пропуск (достаточно базовых: ${goodBasicCount} >= ${__dompickConfig.targetEnoughBasic})`);
    }

    // Явный короткий текстовый селектор внутри стабильного scope
    const scope = __timeit('findStableScope(in-collect)', () => findStableScope(el));
    if (scope) {
      const texts = __timeit('getAllTexts(scope-short)', () => getAllTexts(el)).filter(t => isGoodTextForContains(t));
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
    if (__dompickAddressPipeEnabled) {
      // Address Layer: используем адресные версии позиционных стратегий
      if (!budgetExpired()) {
        const nthAddresses = __timeit('byNthChildAddress', () => byNthChildAddress(el));
        addBatch(nthAddresses.map(addr => ({
          sel: addressToSelector(__dompickMode, addr),
          isCypress: __dompickMode === 'cypress',
          isJs: __dompickMode === 'js',
          score: addr.meta.score,
          __targetEl: el,
          __address: addr
        })));
      }
      if (!budgetExpired()) {
        const parentNthAddresses = __timeit('byParentWithNthAddress', () => byParentWithNthAddress(el));
        addBatch(parentNthAddresses.map(addr => ({
          sel: addressToSelector(__dompickMode, addr),
          isCypress: __dompickMode === 'cypress',
          isJs: __dompickMode === 'js',
          score: addr.meta.score,
          __targetEl: el,
          __address: addr
        })));
      }
      if (!budgetExpired()) {
        const calendarAddresses = __timeit('byCalendarSelectorsAddress', () => byCalendarSelectorsAddress(el));
        addBatch(calendarAddresses.map(addr => ({
          sel: addressToSelector(__dompickMode, addr),
          isCypress: __dompickMode === 'cypress',
          isJs: __dompickMode === 'js',
          score: addr.meta.score,
          __targetEl: el,
          __address: addr
        })));
      }
    } else {
      // Address Layer: старые позиционные стратегии удалены - заменены на адресные версии
    }

    // 5) Агрессивные — гейтим по размеру DOM и количеству базовых
    if (__dompickConfig.aggressiveEnabled && !haveEnoughBasic) {
      const totalDescendants = __countDescendants(document.body, __dompickConfig.domSizeSoftCap + 1);
      if (totalDescendants <= __dompickConfig.domSizeSoftCap) {
        if (__dompickAddressPipeEnabled) {
          // Address Layer: используем адресные версии агрессивных стратегий
          if (__canRun('generateAggressiveFallbacksAddress', 3)) {
            const aggressiveAddresses = __timeit('generateAggressiveFallbacksAddress', () => generateAggressiveFallbacksAddress(el));
            addBatch(aggressiveAddresses.map(addr => ({
              sel: addressToSelector(__dompickMode, addr),
              isCypress: __dompickMode === 'cypress',
              isJs: __dompickMode === 'js',
              score: addr.meta.score,
              __targetEl: el,
              __address: addr
            })));
          }
          if (__canRun('generateSuperAggressiveFallbacksAddress', 4)) {
            const superAggressiveAddresses = __timeit('generateSuperAggressiveFallbacksAddress', () => generateSuperAggressiveFallbacksAddress(el));
            addBatch(superAggressiveAddresses.map(addr => ({
              sel: addressToSelector(__dompickMode, addr),
              isCypress: __dompickMode === 'cypress',
              isJs: __dompickMode === 'js',
              score: addr.meta.score,
              __targetEl: el,
              __address: addr
            })));
          }
        } else {
          // Address Layer: старые агрессивные стратегии удалены - заменены на адресные версии
        }
      } else {
        __dlog('info', `🔥 агрессивные стратегии: пропуск (DOM слишком большой: ${totalDescendants} > ${__dompickConfig.domSizeSoftCap})`);
      }
    } else if (!__dompickConfig.aggressiveEnabled) {
      __dlog('info', '🔥 агрессивные стратегии: отключены глобально');
    } else {
      __dlog('info', `🔥 агрессивные стратегии: пропуск (достаточно базовых: ${goodBasicCount} >= ${__dompickConfig.targetEnoughBasic})`);
    }

    return allSelectors;
  }

  // Категоризует селекторы по группам и сортирует их по качеству.
  function categorizeSelectors(selectors) {
    const groups = {
      basic: [],      // Без .contains и nth-child
      contains: [],   // С .contains
      nth: [],        // С nth-child
      xpath: [],      // XPath
      aggressive: []  // Агрессивные fallback
    };
    for (const selector of selectors) {
      const sel = selector.sel;
      
            if (selector.isXPath) { groups.xpath.push(selector); continue; }
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
    groups.xpath.sort(sortByQuality);
    groups.aggressive.sort(sortByQuality);
    
    return groups;
  }

  // --- Функции подсветки и выбора цели ---
  
  // Поднимается от элемента, на который навели, к более осмысленному (кнопка, ссылка и т.п.)
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

  // Добавляет класс подсветки к элементу
  const highlightElement = (el) => {
    if (el && el !== panel && !panel.contains(el)) {
      el.classList.add('__dompick-highlight');
    }
  };

  // Удаляет класс подсветки
  const removeHighlight = (el) => {
    if (el) {
      el.classList.remove('__dompick-highlight');
    }
  };

  // Очищает все активные подсветки
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
  
  // =========================================================================
  // РАЗДЕЛ 7: СТРАТЕГИИ ГЕНЕРАЦИИ СЕЛЕКТОРОВ
  // =========================================================================

  // --- 5.1: Базовые CSS селекторы ---
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

  function bySimilarAttrs(el){ const out=[]; const similarAttrs=findSimilarAttrs(el);
    for(const {name,value} of similarAttrs){ const s=`[${name}="${esc(value)}"]`; if(isUnique(s,el)) out.push({sel:s}); const s2=`${el.tagName.toLowerCase()}[${name}="${esc(value)}"]`; if(isUnique(s2,el)) out.push({sel:s2}); } return out;
  }

  // Address Layer: byCypressText и byCypressCombo удалены - заменены на byTextAddress
  
  // --- 5.3: Контекстные и иерархические селекторы ---
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

  // --- 5.4: Позиционные селекторы (nth-child) ---
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
  
  // Address Layer: старые позиционные функции byNthChild и byParentWithNth удалены - заменены на адресные версии
  
  // --- 5.5: XPath селекторы ---
function __xpathLiteral(value) {
  const s = String(value);
  if (!s.includes("'")) return "'" + s + "'";
  const parts = s.split("'").map(part => "'" + part + "'");
  return "concat(" + parts.join(", \"'\", ") + ")";
}

function isUniqueXPath(xpath, el) {
  try {
    const doc = el && el.ownerDocument ? el.ownerDocument : document;
    const result = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return result.snapshotLength === 1 && result.snapshotItem(0) === el;
  } catch {
    return false;
  }
}

function buildAbsoluteXPath(node) {
  if (!node || node.nodeType !== 1) return null;
  const segments = [];
  for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
    let tag = el.tagName.toLowerCase();
    let index = 1, sameTagCount = 0;
    if (el.parentElement) {
      const siblings = el.parentElement.children;
      for (let i = 0; i < siblings.length; i++) {
        const sib = siblings[i];
        if (sib.tagName && sib.tagName.toLowerCase() === tag) {
          sameTagCount++;
          if (sib === el) index = sameTagCount;
        }
      }
      if (sameTagCount > 1) tag += `[${index}]`;
    }
    segments.unshift(tag);
  }
  return '/' + segments.join('/');
}

function byXPath(el) {
  const out = [];
  if (!el || el.nodeType !== 1) return out;
  const tag = el.tagName.toLowerCase();

  // 1) id
  if (el.id && el.id.length < 80 && !/%|\/|\s/.test(el.id)) {
    const lit = __xpathLiteral(el.id);
    const xp1 = `//*[@id=${lit}]`;
    if (isUniqueXPath(xp1, el)) out.push({ sel: xp1, isXPath: true });
    const xp2 = `//${tag}[@id=${lit}]`;
    if (isUniqueXPath(xp2, el)) out.push({ sel: xp2, isXPath: true });
  }

  // 2) preferred data-* attributes
  try {
    const pref = ['data-testid','data-test','data-cy','data-qa','data-test-id','data-automation-id','for'];
    for (const a of pref) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v || v.length > 120 || /^\s*$/.test(v)) continue;
      const lit = __xpathLiteral(v);
      const xp1 = `//*[@${a}=${lit}]`;
      if (isUniqueXPath(xp1, el)) out.push({ sel: xp1, isXPath: true });
      const xp2 = `//${tag}[@${a}=${lit}]`;
      if (isUniqueXPath(xp2, el)) out.push({ sel: xp2, isXPath: true });
    }
  } catch {}

  // 3) role + aria-label
  const role = el.getAttribute && el.getAttribute('role');
  const aria = el.getAttribute && el.getAttribute('aria-label');
  if (role && aria) {
    const xp = `//${tag}[@role=${__xpathLiteral(role)} and @aria-label=${__xpathLiteral(aria)}]`;
    if (isUniqueXPath(xp, el)) out.push({ sel: xp, isXPath: true });
    const xp2 = `//*[@role=${__xpathLiteral(role)} and @aria-label=${__xpathLiteral(aria)}]`;
    if (isUniqueXPath(xp2, el)) out.push({ sel: xp2, isXPath: true });
  }

  // 4) другие устойчивые атрибуты
  for (const a of okAttrs) {
    const v = el.getAttribute && el.getAttribute(a);
    if (!v || v.length > 120 || /^\s*$/.test(v)) continue;
    const lit = __xpathLiteral(v);
    const xp1 = `//${tag}[@${a}=${lit}]`;
    if (isUniqueXPath(xp1, el)) out.push({ sel: xp1, isXPath: true });
  }

  // 5) короткий класс (без цифр) — осторожно
  if (el.classList && el.classList.length) {
    for (const c of el.classList) {
      // Пропускаем классы, добавленные самим скриптом
      if (c.startsWith('__dompick')) continue;
      if (!/\d/.test(c) && c.length <= 40) {
        const xp = `//${tag}[contains(concat(' ', normalize-space(@class), ' '), ' ${c} ')]`;
        if (isUniqueXPath(xp, el)) out.push({ sel: xp, isXPath: true });
      }
    }
  }

  // 6) контекст от стабильного предка
  let cur = el.parentElement;
  while (cur && cur.nodeType === 1) {
    let base = null;
    if (cur.id && !/%|\/|\s/.test(cur.id)) {
      base = `//*[@id=${__xpathLiteral(cur.id)}]`;
    } else {
      for (const a of ['data-testid','data-test','data-cy','data-qa','data-test-id','data-automation-id']) {
        const v = cur.getAttribute && cur.getAttribute(a);
        if (v && v.length <= 120 && !/^\s*$/.test(v)) { base = `//*[@${a}=${__xpathLiteral(v)}]`; break; }
      }
    }
    if (base) {
      // позиция текущего узла среди одноимённых детей своего родителя
      const parent = el.parentElement;
      let idx = 1, sameTagCount = 0;
      if (parent) {
        const kids = parent.children;
        for (let i = 0; i < kids.length; i++) {
          if (kids[i].tagName && kids[i].tagName.toLowerCase() === tag) {
            sameTagCount++;
            if (kids[i] === el) idx = sameTagCount;
          }
        }
      }
      const xp = `${base}//${tag}${(sameTagCount > 1) ? `[${idx}]` : ''}`;
      if (isUniqueXPath(xp, el)) out.push({ sel: xp, isXPath: true });
    }
    cur = cur.parentElement;
  }

  // 7) Абсолютный fallback — всегда уникален
  if (out.length === 0) {
    const abs = buildAbsoluteXPath(el);
    if (abs && isUniqueXPath(abs, el)) {
      out.push({ sel: abs, isXPath: true });
    }
  }

  // дедупликация
  const seen = new Set();
  return out.filter(o => !seen.has(o.sel) && (seen.add(o.sel), true));
}

  // --- 5.5: Стабильные scope селекторы ---
  // Находит ближайший стабильный предок и его уникальный селектор без цифр
  function findStableScope(el) {
    const t0 = performance.now();
    let current = el.parentElement;
    let depth = 0;
    while (current && depth < 10) {
      // 1) Предок с ID без цифр
      if (current.id && !hasDigits(current.id)) {
        const sel = `#${esc(current.id)}`;
        if (document.querySelectorAll(sel).length === 1) {
          const dt = performance.now() - t0;
          if (__dompickConfig.debug) __perfStats.misc.findStableScope.push(dt);
          return { scopeEl: current, scopeSelector: sel };
        }
      }

      // 2) Предпочтительные data-атрибуты без цифр
      for (const a of prefDataAttrs) {
        const v = current.getAttribute && current.getAttribute(a);
        if (!v || hasDigits(v)) continue;
        const sel = `[${a}="${esc(v)}"]`;
        if (document.querySelectorAll(sel).length === 1) {
          const dt = performance.now() - t0;
          if (__dompickConfig.debug) __perfStats.misc.findStableScope.push(dt);
          return { scopeEl: current, scopeSelector: sel };
        }
      }

      // 3) Уникальные стабильные классы без цифр
      if (current.classList && current.classList.length > 0) {
        const stable = [...current.classList].filter(c => c && !looksDynamic(c) && !hasDigits(c) && !c.startsWith('__dompick'));
        for (const cls of stable.slice(0, 2)) {
          const sel = `.${esc(cls)}`;
          if (document.querySelectorAll(sel).length === 1) {
            const dt = performance.now() - t0;
            if (__dompickConfig.debug) __perfStats.misc.findStableScope.push(dt);
            return { scopeEl: current, scopeSelector: sel };
          }
        }
      }

      current = current.parentElement;
      depth++;
    }
    const dt = performance.now() - t0;
    if (__dompickConfig.debug) __perfStats.misc.findStableScope.push(dt);
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
    const found = __timeit('findStableScope', () => findStableScope(el));
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
  
  // --- 5.6: Агрессивные и Fallback стратегии ---
  // Address Layer: старые функции bySiblingSelectors и byCalendarSelectors удалены - заменены на адресные версии
  
  // Address Layer: старая функция generateAggressiveFallbacks удалена - заменена на адресную версию

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

  // Address Layer: функция buildAbsoluteCssSegments удалена - заменена на адресную версию

  // Address Layer: функция buildMinimalPositionalSelector удалена - заменена на адресную версию

  // Address Layer: старые вспомогательные функции удалены - заменены на адресные версии

  // Address Layer: старая функция generateSuperAggressiveFallbacks удалена - заменена на адресную версию
  
  // =========================================================================
  // РАЗДЕЛ 8: АНАЛИЗ И ОЦЕНКА СЕЛЕКТОРОВ (СКОРИНГ)
  // =========================================================================
  
  // --- Конфигурация весов для оценки селекторов ---
  // Определяет "ценность" различных частей селектора для вычисления его итогового рейтинга.
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

  // --- Главная функция оценки селектора ---
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
  
  // --- Функции-анализаторы для скоринга ---
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
    // Считает число сегментов-элементов, разделённых комбинаторами пробел/>, +, ~
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

  // --- Утилиты для работы с текстом ---
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
    const t0_all = performance.now();
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
    const t0 = performance.now();
    const children = el.querySelectorAll('*');
    const dt = performance.now() - t0;
    if (__dompickConfig.debug) {
      __perfStats.misc.getAllTexts.push(dt);
    }
    for (const child of children) {
      const childText = getElementText(child);
      if (childText && childText !== mainText && childText.length >= 2) {
        texts.push(childText);
      }
    }
    
    // Убираем дубликаты и сортируем по длине (короткие первыми, но исходный текст - первым)
    const uniqueTexts = [...new Set(texts)];
    const originalText = el._originalTextElement ? getElementText(el._originalTextElement) : null;
    
    if (__dompickConfig.debug) {
      const dtAll = performance.now() - t0_all;
      if (dtAll > __dompickConfig.slowQueryThresholdMs) __dlog('trace', `getAllTexts: ${dtAll.toFixed(1)}ms`);
    }
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

  // --- Валидаторы селекторов ---
  // Address Layer: validateCypressSelector и validateRelativeCypressSelector удалены - заменены на isUniqueAddress

  // =========================================================================
  // РАЗДЕЛ 9: ВСПОМОГАТЕЛЬНЫЕ УТИЛИТЫ
  // =========================================================================

  // --- 7.1: Утилиты для производительности ---
  const budgetExpired = () => __buildBudgetEnd > 0 && performance.now() > __buildBudgetEnd;
  const resetPerfGuards = () => {
    __buildBudgetEnd = 0;
    __queryCache.clear();
    // сброс профайла между запусками генерации
    if (__dompickConfig.debug) {
      __perfStats.strategies = Object.create(null);
      __perfStats.isUnique.length = 0;
      __perfStats.misc.getAllTexts.length = 0;
      __perfStats.misc.findStableScope.length = 0;
      __perfStats.totals = { isUniqueCalls: 0, isUniqueMisses: 0, isUniqueHits: 0, qsaTimeMs: 0 };
    }
  };

  const isUnique = (selector, el) => { // :contentReference{index=5}
    try {
      let list = __queryCache.get(selector);
      if (!list) {
        // Кэшируем результаты querySelectorAll для повтора в рамках одной генерации
        const t0 = performance.now();
        list = Array.from(document.querySelectorAll(selector));
        const dt = performance.now() - t0;
        if (__dompickConfig.debug) {
          __perfStats.totals.isUniqueMisses++;
          __perfStats.totals.qsaTimeMs += dt;
          if (dt > __dompickConfig.slowQueryThresholdMs) {
            __perfStats.isUnique.push({ sel: selector, ms: +dt.toFixed(1), count: list.length, cached: false });
          }
        }
        __queryCache.set(selector, list);
      } else if (__dompickConfig.debug) {
        __perfStats.totals.isUniqueHits++;
        __perfStats.isUnique.push({ sel: selector, ms: 0, count: list.length, cached: true });
      }
      if (__dompickConfig.debug) __perfStats.totals.isUniqueCalls++;
      return list.length === 1 && list[0] === el;
    } catch { return false; }
  };

  function __timeit(name, fn) {
    const t0 = performance.now();
    const res = fn();
    const dt = performance.now() - t0;
    if (__dompickConfig.debug) {
      (__perfStats.strategies[name] || (__perfStats.strategies[name] = [])).push(dt);
      if (dt > __dompickConfig.slowQueryThresholdMs) {
        __dlog('info', `⚠️ медленная стратегия ${name}: ${dt.toFixed(1)}ms`);
      }
    }
    return res;
  }

  // --- 7.2: Утилиты для отладки ---
  function __dlog(level, ...args) {
    if (!__dompickConfig.debug) return;
    const ok = __dompickConfig.logLevel === 'trace' || level !== 'trace';
    if (ok) console.log('[DOMPick]', ...args);
  }

  function __dumpPerfSummary(ctx, groups) {
    if (!__dompickConfig.debug) return;
    const lastRun = __perfStats.buildRuns[__perfStats.buildRuns.length - 1];
    console.groupCollapsed(`🧪 DOMPick Perf (${ctx}) · ${lastRun?.ms?.toFixed?.(1)}ms`);
    if (groups) {
      console.log('Counts:', {
        basic: groups.basicSelectors?.length, contains: groups.containsSelectors?.length,
        nth: groups.nthSelectors?.length, aggressive: (groups.aggressive?.length || 0)
      });
    }
    console.log('isUnique:', __perfStats.totals, 'samples:', __perfStats.isUnique.length);
    const stratAvg = Object.fromEntries(Object.entries(__perfStats.strategies).map(([k, arr]) => {
      const sum = arr.reduce((a,b)=>a+b,0); return [k, { calls: arr.length, avgMs: +(sum/arr.length).toFixed(2), sumMs: +sum.toFixed(1) }];
    }));
    console.table(stratAvg);
    if (__perfStats.isUnique.length) {
      console.table(__perfStats.isUnique.slice(0, 20));
    }
    console.groupEnd();
  }

  // --- 7.3: Общие DOM-утилиты ---
  const clearNode = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };
  const esc = (s) => CSS.escape(s);
  const looksDynamic = (s='') => /\b\d{4,}\b|\b[a-f0-9]{6,}\b|__/i.test(s);
  const hasDigits = (s='') => /\d/.test(s);
  
  // Вспомогательные константы для селекторов
  const prefDataAttrs = ['data-testid','data-test','data-cy','data-qa','data-test-id','data-automation-id','for'];
  const okAttrs = ['id','name','type','placeholder','href','value','role','aria-label','title','for'];
  const interestingSel = 'button, a, input, select, textarea, label, [role="button"], [role="menuitem"], .select2-container, .select2-choice, .select2-selection, .select2-selection__rendered, .select2-drop, .select2-results, .select2-result, .select2-result-label, .select2-results__option, .select2-input';

  // Утилиты для гейтинга стратегий
  function __canRun(name, weight = 1) {
    if (budgetExpired()) {
      __dlog('info', `⏰ ${name}: пропуск (бюджет истёк)`);
      return false;
    }
    const remaining = __buildBudgetEnd - performance.now();
    if (remaining < __dompickConfig.strategyBudgetMs * weight) {
      __dlog('info', `⏰ ${name}: пропуск (остаток ${remaining.toFixed(0)}ms < ${__dompickConfig.strategyBudgetMs * weight}ms)`);
      return false;
    }
    return true;
  }

  function __countDescendants(el, cap = 5000) {
    let count = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, null, false);
    while (walker.nextNode() && count < cap) count++;
    return count;
  }
  
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
  
  // Address Layer: старые конвертеры селекторов удалены - заменены на addressToSelector
  
  // =========================================================================
  // РАЗДЕЛ 10: ИНИЦИАЛИЗАЦИЯ И ОЧИСТКА
  // =========================================================================
  
  // --- Функция уничтожения/закрытия ---
  // Вызывается при клике на кнопку "Закрыть". Полностью удаляет все элементы, стили и обработчики.
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

  // --- Инициализация ---
  // Запускает всю логику: очищает "хвосты", настраивает UI и добавляет обработчики событий.
  
  // Очистка "хвостов" от предыдущего запуска
  document.querySelectorAll('.__dompick-modal, .__dompick-overlay').forEach(n => n.remove());
  document.querySelectorAll('.__dompick-highlight').forEach(el => el.classList.remove('__dompick-highlight'));
  document.body.classList.remove('__dompick-theme-js','__dompick-theme-cypress','__dompick-theme-transition');

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

  // Навешиваем события на кнопки переключения режима
  const modeBtnCypress = panel.querySelector('#__dompick-mode-cypress');
  const modeBtnJs = panel.querySelector('#__dompick-mode-js');
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

  // Добавляем все основные обработчики событий
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  // Клики и наведения теперь обрабатываются через activateSelectionMode/deactivateSelectionMode
  
})();