// ---------- Оптимизированный код ----------
//https://erp.dinord.ru/app/issue/ISS-2025-02915
// Глобальные кеши для индексов (WeakMap — индекс привязан к конкретному массиву budgets)
const _budgetIndexCache = new WeakMap();

/** Разделитель для ключа строки-риска: parentKey + RISK_KEY_SEP + risk_docname */
const RISK_KEY_SEP = "|risk|";

/**
 * Создает / возвращает индекс для массива aggregatedBudget.
 * Индекс содержит:
 *  - byValueMap: account -> [items]
 *  - byParentAccountMap: parent_account -> [items]
 *  - у каждого item: _dimMap: signature -> dimension_data_entry (быстрый lookup)
 *  - sumCache: Map для кэширования результатов сумм (включая signature измерений)
 */
function getOrCreateBudgetIndex(aggregatedBudget) {
    if (!aggregatedBudget) return null;
    let idx = _budgetIndexCache.get(aggregatedBudget);
    if (idx) return idx;

    idx = {
        byValueMap: Object.create(null),
        byParentAccountMap: Object.create(null),
        sumCache: new Map()
    };
    let budgets = Object.values( aggregatedBudget );
    for (const child of budgets ) {
        // индекс по child.value
        const v = child.value || "";
        if (!idx.byValueMap[v]) idx.byValueMap[v] = [];
        idx.byValueMap[v].push(child);

        // индекс по parent_account (если есть)
        const p = child.parent_account || "";
        if (p) {
            if (!idx.byParentAccountMap[p]) idx.byParentAccountMap[p] = [];
            idx.byParentAccountMap[p].push(child);
        }

        // подготовка _dimMap для быстрого поиска dimension entry по сигнатуре
        child._dimMap = Object.create(null);
        if (Array.isArray(child.dimension_data)) {
            for (const entry of child.dimension_data) {
                const sig = dimSignature(entry.dimensions);
                // сохраняем сам объект entry — значения берем по ключам (план/факт/прогноз)
                child._dimMap[sig] = entry;
            }
        }
    }

    _budgetIndexCache.set(aggregatedBudget, idx);
    return idx;
}

// Преобразует массив измерений в строковую сигнатуру
function dimSignature(dimArray) {
    if (!Array.isArray(dimArray) || dimArray.length === 0) return "__EMPTY__";

    // Нормализация и сортировка по стабильному ключу
    const normalized = dimArray
        .map(d => ({
            doc: d.doc,
            docname: d.docname,
            key: `${d.doc}:${d.docname}`
        }))
        .sort((a, b) => a.key.localeCompare(b.key));

    // Формируем финальную сигнатуру
    return normalized.map(d => d.key).join("|");
}

/**
 * Оптимизированная версия get_child_budget_sum.
 *
 * Параметры:
 *  - account, task, dimension, period
 *  - aggregatedBudget: массив (тот же, что приходит из frm.aggregatedBudget subset)
 *  - valueKey: "forecast" | "plan" | "fact"
 *
 * Возвращает сумму (Number).
 */
function get_child_budget_sum(account, task, dimension = [], period, aggregatedBudget, valueKey = "forecast") {
    if (!aggregatedBudget || !period) return 0;

    const budgetIndex = getOrCreateBudgetIndex(aggregatedBudget);
    if (!budgetIndex) return 0;

    // сигнатура измерений (включаем порядок и конкретные doc/docname)
    const dimSigBase = dimSignature(dimension);
    const forecastKey = `${valueKey}_${period.year}_${period.month}`;

    // cache key включает account, task, dimSig, valueKey и период
    const cacheKey = `${account}::${task || ""}::${dimSigBase}::${forecastKey}`;
    if (budgetIndex.sumCache.has(cacheKey)) {
        return budgetIndex.sumCache.get(cacheKey);
    }

    let sum = 0;
    const processed = new WeakSet(); // чтобы не дважды обрабатывать один и тот же child объект
    const stack = [{ account, task, dimArr: Array.isArray(dimension) ? dimension.slice() : [] }];

    while (stack.length) {
        const { account: curAccount, task: curTask, dimArr } = stack.pop();

        // собираем кандидатов: те у которых child.value == curAccount и те у которых parent_account == curAccount
        const candidates = [];
        const byValue = budgetIndex.byValueMap[curAccount] || [];
        const byParent = budgetIndex.byParentAccountMap[curAccount] || [];
        // добавляем все (дубликаты исключим через processed)
        for (const c of byValue) candidates.push(c);
        for (const c of byParent) candidates.push(c);

        for (const child of candidates) {
            if (processed.has(child)) continue; // уже обработан
            // применяем логику isChildOf (перенесена в быстрые условия)
            let accepted = isChildOf( child, curAccount, curTask );

            if (!accepted) continue;
            processed.add(child);

            // формируем измерения для поиска: фильтр по Task если curTask задан (как в оригинале)
            let dimForChild;
            if (curTask) {
                // убираем измерение Task==curTask (как в оригинале)
                dimForChild = dimArr.filter(item => !(item.doc === "Task" && item.docname === curTask));
            } else {
                dimForChild = dimArr.slice();
            }
            if (child.task) {
                // добавляем текущее child.task в измерения
                dimForChild = dimForChild.concat([{ doc: "Task", docname: child.task.value }]);
            }
            if (child.risk) {
                // добавляем текущее child.task в измерения
                dimForChild = dimForChild.concat([{ doc: "Project Risk", docname: child.risk.value }]);
            }

            const sig = dimSignature(dimForChild);
            const entry = child._dimMap ? child._dimMap[sig] : (Array.isArray(child.dimension_data) ? child.dimension_data.find(x => dimSignature(x.dimensions) === sig) : null);
            const val = entry ? (Number(entry[forecastKey]) || 0) : 0;

            if (val > 0) {
                sum += val;
            } else {
                // если прямого значения нет — добавляем в стек для рекурсивного обхода потомков
                stack.push({ account: child.value, task: child.task ? child.task.value : undefined, dimArr: dimForChild });
            }
        }
    }

    budgetIndex.sumCache.set(cacheKey, sum);
    return sum;
}

function get_direct_budget_value(row, period, valueKey) {
    if (!row || !Array.isArray(row.dimension_data) || !row.dimension_data.length || !period) {
        return 0;
    }

    const fieldname = `${valueKey}_${period.year}_${period.month}`;
    return row.dimension_data.reduce((sum, bucket) => {
        return sum + (Number(bucket?.[fieldname]) || 0);
    }, 0);
}

function get_row_period_total(frm, row, period, valueKey) {
    const directValue = get_direct_budget_value(row, period, valueKey);
    if (directValue) {
        return directValue;
    }

    return get_child_budget_sum(
        row.value,
        row.task ? row.task.value : "",
        [],
        period,
        frm.aggregatedBudget,
        valueKey
    );
}

/**
 * Оптимизированная calc_column_total — основной метод, использующий индексы.
 *
 * Возвращает объект { plan_income, plan_expenses, actual_income, actual_expenses }
 */
function calc_column_total(frm, period, roots, calc_plan = true, calc_fact = false) {
    let plan_income = 0;
    let plan_expenses = 0;
    let actual_income = 0;
    let actual_expenses = 0;

    for (const child of roots) {
        const actualValueKey = (period.is_past || calc_fact) ? "fact" : "forecast";
        const plan = calc_plan ? get_row_period_total(frm, child, period, "plan") : 0;
        const actual = get_row_period_total(frm, child, period, actualValueKey);

        if (child.type === "Expense") {
            actual_expenses += actual;
            plan_expenses += plan;
        } else if (child.type === "Income") {
            actual_income += actual;
            plan_income += plan;
        }
    }

    return {
        plan_income,
        plan_expenses,
        actual_income,
        actual_expenses
    };
}

/**
 * Прогнозные затраты по одному периоду (только forecast_*, без fact для прошлых месяцев).
 */
function get_period_forecast_expenses(frm, period, roots) {
    let forecast_expenses = 0;

    for (const child of roots) {
        if (child.type !== "Expense") {
            continue;
        }
        forecast_expenses += get_row_period_total(frm, child, period, "forecast");
    }

    return forecast_expenses;
}

/**
 * Сумма всех прогнозных затрат проекта по затратным P&L-счетам (forecast / pba_expected).
 */
function get_total_forecast_expenses(frm) {
    if (!frm || !frm.aggregatedBudget) {
        return 0;
    }

    const periods = get_budget_display_periods(frm, "month");
    const roots = Object.values(frm.aggregatedBudget).filter(b => !b.parent_account && !b.task);
    let total = 0;

    for (const period of periods) {
        total += get_period_forecast_expenses(frm, period, roots);
    }

    return parseFloat(total.toFixed(2));
}

function is_pl_expense_account(frm, account) {
    if (!frm || !frm.aggregatedBudget || !account) {
        return false;
    }

    const row = Object.values(frm.aggregatedBudget).find(b => b.value === account);
    return Boolean(row && row.type === "Expense");
}

/**
 * Обновляет estimated_costing в форме проекта без сохранения документа.
 */
function sync_estimated_costing_from_forecast(frm) {
    if (!frm) {
        return;
    }

    frm.set_value("estimated_costing", get_total_forecast_expenses(frm));
}

/**
 * Обновляет/создаёт запись dimension_data для конкретного child в frm.aggregatedBudget,
 * а затем точечно инвалидирует кеши, которые могли зависеть от этой записи.
 *
 * account — строка account (child.value)
 * task — строка task.docname или пусто
 * dim — массив измерений (dimensions)
 * year, month — целые
 * valueKey — "forecast" | "plan" | "fact"
 * newValue — числовое или строковое значение
 */
function updateBudgetDimensionEntry(frm, account, task, dim, year, month, valueKey, newValue) {
    if (!frm.aggregatedBudget) return;
    console.time("updateBudgetDimensionEntry");

    let key;
    const riskDim = dim && dim.find(d => d && d.doc === "Project Risk");
    const taskDim = dim && dim.find(d => d && d.doc === "Task");
    const taskId = taskDim ? taskDim.docname : (task || "");
    if (riskDim) {
        const parentKey = account + (taskId || "");
        key = parentKey + RISK_KEY_SEP + riskDim.docname;
    } else {
        key = taskId ? (account + taskId) : account;
    }

    // Нахождение child в frm.aggregatedBudget
    let child = frm.aggregatedBudget && frm.aggregatedBudget[key];

    if (!child) {
        // Если child не найден — мы не можем корректно обновить (возможно нужно создать).
        // Опционально: создаём новый child-объект (минимально необходимый набор полей).
        child = {
            value: account,
            parent_account: null,
            type: undefined,
            task: task ? { value: task } : undefined,
            dimension_data: []
        };
        // Попробуем добавить в frm.aggregatedBudget (если это объект map)
        frm.aggregatedBudget[key] = child;
    }

    // Найдём / создадим соответствующую запись dimension_data (по сигнатуре без учёта порядка)
    const normalizedDimSig = dimSignature(dim || []);
    if (!Array.isArray(child.dimension_data)) child.dimension_data = [];

    // Ищем entry по сигнатуре
    let dimEntry = null;
    // Если у child есть _dimMap — использую его
    if (child._dimMap) {
        dimEntry = child._dimMap[normalizedDimSig];
    } else {
        dimEntry = child.dimension_data.find(x => dimSignature(x.dimensions) === normalizedDimSig);
    }

    if (!dimEntry) {
        // Создаём новую запись (с правильным полем dimensions)
        dimEntry = { dimensions: Array.isArray(dim) ? dim.slice() : [] };
        child.dimension_data.push(dimEntry);
    }

    // Обновляем значение
    const valueField = `${valueKey}_${year}_${month}`;
    dimEntry[valueField] = newValue;

    // Обновляем child._dimMap если он существует (индекс уже был построен)
    const budgetIndex = getOrCreateBudgetIndex(frm.aggregatedBudget);
    if (budgetIndex && child._dimMap) {
        child._dimMap[normalizedDimSig] = dimEntry;
    }

    // Точечная инвалидация кеша:
    //  - сгенерируем список аккаунтов, чьи суммы могли измениться: сам child.value и все его предки (по parent_account)
    const affectedAccounts = collectAncestorAccounts(frm.aggregatedBudget, child);

    // формируем сигнатуру измерения, которую мы изменили (без учёта порядка)
    const affectedDimSig = normalizedDimSig;
    const forecastKey = `${valueKey}_${year}_${month}`;

    invalidateSumCacheForBudgetIndex(budgetIndex, affectedAccounts, affectedDimSig, forecastKey);
    console.timeEnd("updateBudgetDimensionEntry");
}

/**
 * Собирает набор аккаунтов (value) — сам элемент и все его предки по цепочке parent_account.
 * Возвращает Set строк.
 */
function collectAncestorAccounts(aggregatedBudget, child) {
    const res = new Set();
    if (!child) return res;
    const start = child.value;
    if (start) res.add(start);

    // Получим быстрый индекс value -> первый child
    const idx = getOrCreateBudgetIndex(aggregatedBudget);
    // safe guard
    if (!idx) return res;

    let currentParent = child.parent_account || null;
    // Проходим вверх по parent_account
    while (currentParent) {
        if (res.has(currentParent)) break;
        res.add(currentParent);
        // пробуем найти следующий родителя (используем byValueMap)
        const parents = idx.byValueMap[currentParent];
        if (parents && parents.length) {
            // берем первый — ожидается, что структура дерева корректна
            currentParent = parents[0].parent_account || null;
        } else {
            currentParent = null;
        }
    }
    return res;
}

/**
 * Инвалидирует записи в sumCache, которые потенциально используют изменённую запись.
 * Подход: проходим по ключам в sumCache и удаляем те, у которых аккаунт совпадает с одним из affectedAccounts
 * или которые явно содержат изменённую сигнатуру измерений или тот же forecastKey.
 *
 * Это компромисс: мы не пытаемся пересчитать все суммы сразу (это тяжело), но безопасно удаляем спорные кеши.
 */
function invalidateSumCacheForBudgetIndex(budgetIndex, affectedAccountsSet, affectedDimSig, forecastKey) {
    if (!budgetIndex || !budgetIndex.sumCache || affectedAccountsSet.size === 0) return;

    // Обходим все ключи и удаляем те, которые могут быть затронуты
    for (const key of Array.from(budgetIndex.sumCache.keys())) {
        // cacheKey формат: `${account}::${task || ""}::${dimSig}::${forecastKey}`
        // Быстрая проверка: если forecastKey не совпадает — всё ещё может быть затронуто (разные периоды),
        // но мы точно должны инвалидировать ключи с тем же forecastKey.
        // Удаляем если:
        //  - account в affectedAccountsSet
        //  - или dimSig === affectedDimSig
        //  - или forecastKey === forecastKey (точнее — ключ заканчивается на прогнозное поле)
        const parts = key.split("::");
        const accInKey = parts[0] || "";
        const dimSigInKey = parts[2] || "";
        const fk = parts[3] || "";

        let shouldInvalidate = false;
        if (affectedAccountsSet.has(accInKey) && fk === forecastKey) {
            shouldInvalidate = true;
        }

        if (shouldInvalidate) {
            budgetIndex.sumCache.delete(key);
        }
    }
}


// Утилита: очистить кеш для конкретного aggregatedBudget (вызовите, если данные в массиве изменились)
function clearBudgetIndexCacheFor(aggregatedBudget) {
    if (aggregatedBudget && _budgetIndexCache.has(aggregatedBudget)) {
        _budgetIndexCache.delete(aggregatedBudget);
    }
}

function updateTaskDimensionOptimized(frm) {
    if (!frm.aggregatedBudget || !frm.aggregatedTasks) return;

    console.time("updateTaskDimension_opt");

    const budgetsArr = Object.values(frm.aggregatedBudget);
    const tasksArr = Object.values(frm.aggregatedTasks);

    if (!budgetsArr.length || !tasksArr.length) {
        console.timeEnd("updateTaskDimension_opt");
        return;
    }

    const budgetsWithTasks = Object.create(null);
    const tasksLen = tasksArr.length;

    for (let bi = 0, bLen = budgetsArr.length; bi < bLen; bi++) {
        const budget = budgetsArr[bi];
        const dimensionData = budget.dimension_data || [];
        // shallow copy base budget once
        const baseBudgetCopy = { ...budget };

        // build signature -> bucket map; allow multiple buckets per signature (array)
        const sigToBuckets = Object.create(null);
        const nonTaskBuckets = [];

        for (let di = 0, dLen = dimensionData.length; di < dLen; di++) {
            const bucket = dimensionData[di];
            const dims = bucket && bucket.dimensions;
            if (!dims || !dims.length) {
                nonTaskBuckets.push(bucket);
                continue;
            }

            // check if bucket contains any Task doc (we need to move all with Task out)
            let hasTask = false;
            for (let k = 0; k < dims.length; k++) {
                if (dims[k] && dims[k].doc === "Task") {
                    hasTask = true;
                    break;
                }
            }

            if (!hasTask) {
                // matches original filter: keep those without any Task
                nonTaskBuckets.push(bucket);
                continue;
            }

            // если есть Task — добавляем в sigMap (включая комбинированные dimensions, т.е. нескольких элементов)
            const sig = dimSignature(dims);
            // push bucket into array for this signature
            const existing = sigToBuckets[sig];
            if (existing) {
                existing.push(bucket);
            } else {
                sigToBuckets[sig] = [bucket];
            }
        }

        // записываем базовый бюджет без Task buckets
        baseBudgetCopy.dimension_data = nonTaskBuckets;
        budgetsWithTasks[String(budget.value)] = baseBudgetCopy;

        // проверяем, разрешены ли Task в allowed_dimensions (один проход)
        const allowed = budget.allowed_dimensions || [];
        let allowsTask = false;
        for (let ai = 0, aLen = allowed.length; ai < aLen; ai++) {
            if (allowed[ai] && allowed[ai].document_type === "Task") {
                allowsTask = true;
                break;
            }
        }
        if (!allowsTask) continue;

        // для каждой задачи собираем все бакеты, содержащие эту задачу (в т.ч. Task+Risk)
        for (let ti = 0; ti < tasksLen; ti++) {
            const task = tasksArr[ti];
            // shallow copy базового бюджета и минимальные изменения
            const taskBudget = {
                ...baseBudgetCopy,
                account: task.subject,
                indent: (baseBudgetCopy.indent || 0) + (task.indent || 0) + 1,
                task: task
            };

            const targetDims = [{ doc: "Task", docname: task.value }];
            const bucketsForTask = [];
            for (const sig in sigToBuckets) {
                const buckets = sigToBuckets[sig];
                for (let bi = 0; bi < buckets.length; bi++) {
                    const b = buckets[bi];
                    const dims = b.dimensions || [];
                    if (dims.some(d => d && d.doc === "Task" && d.docname === task.value)) {
                        bucketsForTask.push(b);
                    }
                }
            }
            if (bucketsForTask.length) {
                taskBudget.dimension_data = bucketsForTask;
            } else {
                taskBudget.dimension_data = [{ dimensions: targetDims }];
            }

            budgetsWithTasks[String(budget.value) + String(task.value)] = taskBudget;
        }
    }

    // Записываем результат обратно в frm (как в исходном коде)
    frm.aggregatedBudget = budgetsWithTasks;

    console.timeEnd("updateTaskDimension_opt");
}

/**
 * Добавляет строки-риски в frm.aggregatedBudget: для каждого bucket в dimension_data
 * с измерением Project Risk создаётся дочерняя строка к соответствующей статье/задаче.
 * Вызывается после updateTaskDimensionOptimized и при отсутствии aggregatedTasks (из updateTaskDimension).
 */
function addRiskDimensionRows( agg ) {
    if (!agg) return;
    const keys = Object.keys(agg);
    const toAdd = [];

    for (let i = 0; i < keys.length; i++) {
        const parentKey = keys[i];
        if (parentKey.indexOf(RISK_KEY_SEP) >= 0) continue;
        const row = agg[parentKey];
        const dimensionData = row && row.dimension_data;
        if (!Array.isArray(dimensionData)) continue;

        for (let di = 0; di < dimensionData.length; di++) {
            const bucket = dimensionData[di];
            const dims = bucket && bucket.dimensions;
            if (!dims || !dims.length) continue;

            let risk_docname = null;
            for (let k = 0; k < dims.length; k++) {
                if (dims[k] && dims[k].doc === "Project Risk") {
                    risk_docname = dims[k].docname;
                    break;
                }
            }
            if (!risk_docname) continue;

            const riskRowKey = parentKey + RISK_KEY_SEP + risk_docname;
            if (agg[riskRowKey]) continue;

            const riskRow = {
                ...row,
                value: row.value,
                indent: (row.indent || 0) + 1,
                _parentKey: parentKey,
                risk: { value: risk_docname },
                dimension_data: [bucket]
            };
            delete riskRow.account;
            toAdd.push([riskRowKey, riskRow]);

            row.dimension_data = dimensionData.filter( 
                b => !b.dimensions.find( 
                    d => d.doc == "Project Risk" && d.docname == risk_docname ) );
        }
    }

    for (let i = 0; i < toAdd.length; i++) {
        agg[toAdd[i][0]] = toAdd[i][1];
    }
}