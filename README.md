# Dinext Projects P&L

## 📖 Обзор

**Dinext Projects P&L** — это приложение для Frappe/ERPNext, которое расширяет стандартный DocType `Project` функциями проектного P&L, планирования, прогноза, отчетности и согласования бюджета. После семантического разделения владеет финансовыми masters (`Cost Level`, `Rate Category` / `Rate Table`, `Account Table`, `Cost Center Table`, `Business Area`, `Project Payment Scheme`, `Worker Level`), rate-control reports, ролями `Dinext_Financier` / `Dinext_Fin_Dir` / `Dinext_Budget_Approver` и workspace **Фин. Контроль**.

Приложение объединяет кастомный P&L-интерфейс и отдельную вкладку `Метрики` в карточке проекта с Dinext-логикой бюджетирования. Текущие плановые и прогнозные данные отображаются и редактируются в UI проекта, EVM-показатели рассчитываются на сервере через единый whitelisted API и отображаются на вкладке `Метрики`, а сохранение плана работает в двух режимах: через стандартные ERPNext-документы `Budget` и `Monthly Distribution` с workflow согласования либо через прямую запись в кастомный read model `Project Budget`. Точные утвержденные помесячные суммы хранятся отдельно от процентного `Monthly Distribution`, поэтому persisted-значения плана не дрейфуют из-за round-trip округления.

## ✨ Возможности

- **Кастомная вкладка P&L в `Project`** с таблицей трудозатрат/затрат, итоговыми блоками, кнопками отчетов и графиком.
- **Отдельная вкладка `Метрики` в `Project`** с финансовыми EVM-метриками по контурам доходов и расходов, отчетной датой расчета и серверным расчетом `BAC/PV/EV/AC/CV/SV/CPI/SPI/EAC/ETC/VAC/TCPI`.
- **Единый серверный API EVM-метрик** `get_project_financial_metrics`, переиспользующий агрегацию plan/fact из report pipeline и возвращающий готовый payload для UI.
- **Режимы просмотра план / прогноз / факт** с переключателями видимости плана и дельт.
- **Flow согласования бюджета**, в котором сохранение плана из P&L создает ERPNext `Budget`, а не пишет напрямую в `Project Budget`, если site-level toggle согласования включен.
- **Site-level toggle сохранения плана**: можно переключить режим между workflow согласования и прямым сохранением `pba_plan` без `Budget` и workflow.
- **Гранулярность бюджета по ключу**: один `Budget` на сочетание `account + project/task + fiscal year`.
- **Workflow согласования Dinext** со специальными ролями:
  - `Dinext_Project_Manager` отправляет на согласование;
  - `Dinext_Budget_Approver` согласует и отменяет.
- **Семантика замещения**:
  - новый запрос отменяет существующий pending budget для того же канонического ключа;
  - согласование новой версии отменяет ранее согласованный budget для того же ключа.
- **Точное хранение approved monthly amounts** в скрытом поле `Budget.dinext_budget_monthly_amounts`, при этом `Monthly Distribution` остается производным ERPNext-артефактом.
- **Синхронизация `Project Budget`** на submit/cancel через app-owned Python hooks.
- **Навигация из P&L-таблицы**:
  - двойной клик по строке статьи/задачи открывает список `Budget`;
  - двойной клик по ячейке плановой суммы открывает соответствующий approved `Budget`;
  - двойной клик по ячейке факта открывает `General Ledger`.
- **Script Report** `Project Budget Plan vs Forecast` для сравнения плана с прогнозом и фактом.
- **Fixture-driven доставка метаданных** для workflow, workflow states, actions, roles, accounting dimensions, custom fields, client scripts и связанной metadata.

## 🚀 Установка

Установите приложение в существующий bench:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch develop
bench install-app dinext_projects_pl
```

Затем примените изменения схемы и метаданных:

```bash
bench --site $SITE migrate
```

Приложение опирается на fixture-based доставку метаданных. При установке и миграции применяются custom fields, client/server scripts, accounting dimensions, workflow `Dinext Budget Approval`, workflow states/actions, финансовые роли, number cards/charts и rate-control reports.

`required_apps`: `dinext_common`, `doctype_permission`, `dinext_projects`.

## 🛠️ Использование

### Основной P&L-сценарий

1. Откройте документ `Project`.
2. Перейдите в кастомный раздел P&L.
3. Проверьте план, прогноз и факт по месяцам.
4. Нажмите `Сохранить план`.
5. Клиентский код вызывает app-owned Python service `save_budget_plan_for_approval`, который группирует строки по `account + target + fiscal year`, а затем:
   - **по умолчанию** создает `Budget` и `Monthly Distribution`, сохраняет точные исходные помесячные суммы в metadata `Budget` и переводит бюджет в Dinext workflow согласования;
   - **если отключен site-level toggle** — сразу обновляет `Project Budget.pba_plan` без создания `Budget` и без workflow.

### Сценарий просмотра метрик

1. Откройте документ `Project`.
2. Перейдите на вкладку `Метрики`.
3. Выберите `Отчетная дата метрик`.
4. Клиентский код вызывает серверный API `get_project_financial_metrics`, который:
   - собирает помесячный plan из `Project Budget` через `process_project_data`;
   - собирает fact из `GL Entry` через `get_actual_data_simple`;
   - рассчитывает EVM-показатели на выбранную отчетную дату с proration текущего месяца.
5. Проверьте EVM-показатели по двум контурам:
   - `Доходы`;
   - `Расходы`.
6. Используйте показатели `BAC`, `PV`, `EV`, `AC`, `CV`, `SV`, `CPI`, `SPI`, `EAC`, `ETC`, `VAC`, `TCPI` для анализа исполнения проекта на выбранную дату.

Пример программного вызова API:

```python
frappe.call(
    "dinext_projects_pl.dinext_projects_pl.financial_metrics.service.get_project_financial_metrics",
    project="PROJ-0001",
    reporting_date="2026-01-15",
)
```

```javascript
frappe.call({
    method: "dinext_projects_pl.dinext_projects_pl.financial_metrics.service.get_project_financial_metrics",
    args: {
        project: frm.doc.name,
        reporting_date: frm._financial_metrics_reporting_date,
    },
});
```

### Согласование бюджета

- Режим согласования управляется site config ключом `dinext_projects_pl_enable_plan_approval`.
- Если ключ равен `1`, используется approval flow через `Budget`.
- Если ключ равен `0`, план сохраняется напрямую в `Project Budget`, а workflow согласования не запускается.
- Pending budgets находятся в состоянии `Pending Approval`.
- При `Approve` бюджет submit'ится и синхронизируется в `Project Budget`.
- При согласовании replacement-версии ранее approved budget для того же канонического ключа отменяется, а новая версия становится источником истины.
- При отмене ранее approved budget read model либо восстанавливается из другого approved replacement, либо очищается по затронутым месяцам.

### UI-помощники

- Двойной клик по строке статьи/задачи в P&L открывает подходящие документы `Budget`.
- Двойной клик по ячейке плановой суммы открывает approved `Budget` для этого периода.
- Кнопки отчетов открывают ERPNext financial reports с фильтрами по проекту.

### Расширение меню прогноза

Другие приложения могут расширять выпадающее меню `Добавить прогноз` через глобальный реестр:

```javascript
frappe.provide("dinext_projects.project_pl_forecast_menu");
dinext_projects.project_pl_forecast_menu = dinext_projects.project_pl_forecast_menu || [];
dinext_projects.project_pl_forecast_menu.push({
  label: __("Мой прогноз"),
  action(frm) {
    // кастомная логика
  },
});
```

Если пункты добавлены после первичной отрисовки, вызовите `dinext_projects.refresh_pl_forecast_dropdown(frm)`.

## 📦 Технологии

- **Python 3.10+**
- **Frappe Framework**
- **ERPNext** (`Budget`, `Monthly Distribution`, финансовые отчеты)
- **JavaScript client scripts** для `Project`
- **Fixture-driven metadata** через `hooks.py`
- **Ruff**, **ESLint**, **Prettier** и **pre-commit** для локальной разработки

## 🔧 Конфигурация

Приложение не вводит собственные environment variables. Основная конфигурация выполняется через метаданные Frappe, `site_config.json` и стандартные ERPNext-сущности:

- `site_config.json`:
  - `dinext_projects_pl_enable_plan_approval` — включает (`1`) или отключает (`0`, default) сохранение плана через `Budget` workflow.
- Пример настройки:

```bash
bench --site $SITE set-config dinext_projects_pl_enable_plan_approval 0
```

При выключенном ключе кнопка `Сохранить план` продолжает использовать тот же серверный API, но он пишет значения напрямую в `Project Budget.pba_plan` и не создает `Budget` / `Monthly Distribution`.

- fixtures для `Accounting Dimension`;
- custom fields в `Budget`:
  - `dinext_budget_account`;
  - `dinext_budget_monthly_amounts`;
  - `workflow_state`;
- workflow metadata для `Dinext Budget Approval`;
- custom fields и client scripts для UI проекта, включая вкладки `P&L` и `Метрики`.

Важные эксплуатационные детали:

- `Monthly Distribution` — производный артефакт для monthly checks в ERPNext, а не источник истины для sync approved plan.
- Точные approved monthly amounts сохраняются прямо в `Budget`, чтобы исключить drift из-за round-trip округления.
- При `dinext_projects_pl_enable_plan_approval = 0` источником истины для новых операций `Сохранить план` сразу становится `Project Budget.pba_plan`, без промежуточного `Budget`.
- `Project Budget.pba_expected` остается независимым прогнозом и не перезаписывается автоматически при approve-sync.
- EVM-метрики используют только `pba_plan` и факт из `GL Entry`; прогноз (`pba_expected`) в расчет EVM не входит.
- Отчетная дата EVM передается в API явно; proration текущего месяца выполняется на сервере.
- В репозитории по-прежнему присутствует fixture `server_script.json`, но основной путь согласования плана реализован в app-owned Python service, а не в site-only server script.

## ✅ Требования

- Рабочий **bench** с **Frappe**.
- Установленный **ERPNext** на целевом сайте для стандартных budget/report doctypes и их логики.
- **Python >= 3.10** согласно [pyproject.toml](pyproject.toml).
- Доступ к стандартным финансовым doctypes и отчетам, которые использует приложение.

## 🤝 Как вносить изменения

Подключите локальные проверки через `pre-commit`:

```bash
cd apps/dinext_projects_pl
pre-commit install
```

Основной инструментарий разработки:

- `ruff` для lint/format/import ordering Python-кода;
- `eslint` для JavaScript;
- `prettier` для форматирования фронтенда;
- `pyupgrade` для обновления синтаксиса Python.

Если нужно изменить metadata:

1. Вносите изменения через систему Frappe/ERPNext.
2. Затем выполняйте:

```bash
bench --site $SITE export-fixtures --app dinext_projects_pl
```

Не редактируйте generated fixture JSON-файлы вручную.

Запуск regression-тестов:

```bash
bench --site $SITE run-tests --app dinext_projects_pl
node --test tests/js/project_pl_financial_metrics.test.js
node --test tests/js/project_pl_echarts.test.js
```

## 📄 Документация

- [README.md](README.md) — обзор репозитория и текущей архитектуры.
- [dinext_projects_pl/hooks.py](dinext_projects_pl/hooks.py) — wiring приложения, fixture filters и hooks.
- [dinext_projects_pl/dinext_projects_pl/budget_approval/service.py](dinext_projects_pl/dinext_projects_pl/budget_approval/service.py) — сервисы согласования бюджета и sync-логика.
- [dinext_projects_pl/dinext_projects_pl/financial_metrics/service.py](dinext_projects_pl/dinext_projects_pl/financial_metrics/service.py) — whitelisted API расчета EVM-метрик проекта.
- [dinext_projects_pl/dinext_projects_pl/financial_metrics/data.py](dinext_projects_pl/dinext_projects_pl/financial_metrics/data.py) — серверная агрегация plan/fact по месяцам для EVM.
- [dinext_projects_pl/dinext_projects_pl/financial_metrics/calculations.py](dinext_projects_pl/dinext_projects_pl/financial_metrics/calculations.py) — формулы EVM и формирование response payload.
- [dinext_projects_pl/public/js/project_pl_financial_metrics.js](dinext_projects_pl/public/js/project_pl_financial_metrics.js) — клиентский render-слой вкладки `Метрики`.
- [dinext_projects_pl/dinext_projects_pl/budget_approval/bootstrap.py](dinext_projects_pl/dinext_projects_pl/budget_approval/bootstrap.py) — константы workflow, ролей и полей.
- [dinext_projects_pl/dinext_projects_pl/overrides/budget.py](dinext_projects_pl/dinext_projects_pl/overrides/budget.py) — override duplicate-validation для `Budget`.
- [dinext_projects_pl/dinext_projects_pl/doctype/project_budget/test_project_budget.py](dinext_projects_pl/dinext_projects_pl/doctype/project_budget/test_project_budget.py) — regression-тесты budget approval flow.
- [dinext_projects_pl/tests/test_financial_metrics_service.py](dinext_projects_pl/tests/test_financial_metrics_service.py) — unit/integration-тесты серверного расчета EVM-метрик.
- [tests/js/project_pl_financial_metrics.test.js](tests/js/project_pl_financial_metrics.test.js) — JS-тесты render-слоя вкладки `Метрики`.
- [tests/js/project_pl_echarts.test.js](tests/js/project_pl_echarts.test.js) — JS-тесты P&L ECharts (palette, tooltip, markLine, toolbox, geometry).

## ❤️ Благодарности

Приложение построено на Frappe и ERPNext budgeting/reporting primitives и адаптировано под Dinext-процессы проектных финансов.

## 🗂️ Структура репозитория

```text
.
├── README.md
├── license.txt
├── pyproject.toml
├── .pre-commit-config.yaml
├── .eslintrc
├── .editorconfig
└── dinext_projects_pl/
    ├── __init__.py
    ├── hooks.py
    ├── modules.txt
    ├── patches.txt
    ├── fixtures/
    │   ├── accounting_dimension.json
    │   ├── client_script.json
    │   ├── custom_field.json
    │   ├── role.json
    │   ├── server_script.json
    │   ├── workflow.json
    │   ├── workflow_action_master.json
    │   └── workflow_state.json
    ├── public/
    │   └── js/
    │       ├── project_pl.js
    │       ├── project_pl_calc.js
    │       ├── project_pl_dashboard.js
    │       ├── project_pl_financial_metrics.js
    │       └── project_pl_style.js
    ├── tests/
    │   └── js/
    │       ├── project_pl_financial_metrics.test.js
    │       └── project_pl_echarts.test.js
    └── dinext_projects_pl/
        ├── budget_approval/
        │   ├── __init__.py
        │   ├── bootstrap.py
        │   └── service.py
        ├── financial_metrics/
        │   ├── __init__.py
        │   ├── constants.py
        │   ├── calculations.py
        │   ├── data.py
        │   └── service.py
        ├── overrides/
        │   ├── __init__.py
        │   └── budget.py
        ├── doctype/
        │   ├── project_budget/
        │   ├── project_budget_amount/
        │   └── project_budget_dimension/
        ├── report/
        │   └── project_budget_plan_vs_forecast/
        └── tests/
            ├── test_app_bootstrap.py
            └── test_financial_metrics_service.py
```

- `dinext_projects_pl/hooks.py` подключает client assets, fixtures, override для `Budget` и submit/cancel hooks.
- `dinext_projects_pl/fixtures/` содержит system-generated metadata, экспортированную из сайта.
- `dinext_projects_pl/public/js/` содержит UI проекта, агрегацию данных, рендеринг P&L-графика, вкладки `P&L`/`Метрики` и интерактивные обработчики навигации.
- `dinext_projects_pl/public/js/project_pl_financial_metrics.js` — thin client render для вкладки `Метрики`; расчет выполняется на сервере.
- `dinext_projects_pl/dinext_projects_pl/budget_approval/` содержит app-owned flow согласования бюджета и sync с `Project Budget`.
- `dinext_projects_pl/dinext_projects_pl/financial_metrics/` содержит серверный расчет EVM-метрик и whitelisted API для UI проекта.
- `dinext_projects_pl/dinext_projects_pl/overrides/` адаптирует duplicate-checks ERPNext `Budget` под Dinext replacement semantics.
- `dinext_projects_pl/dinext_projects_pl/doctype/` определяет кастомный read model `Project Budget`.
- `dinext_projects_pl/dinext_projects_pl/report/` содержит script report для сравнения плана и прогноза; его helpers переиспользуются EVM API.
- `dinext_projects_pl/dinext_projects_pl/tests/` и `tests/js/` содержат Python/JS regression-тесты для budget approval и EVM metrics.

## 🔗 Схема потока

```mermaid
flowchart LR
  ProjectForm[Карточка проекта: P&L и Метрики] --> ClientJS[project_pl.js и связанные helpers]
  ClientJS --> ApprovalAPI[save_budget_plan_for_approval]
  ApprovalAPI --> BudgetDoc[ERPNext Budget]
  ApprovalAPI --> MonthlyDistribution[Monthly Distribution]
  ApprovalAPI --> ExactMonthly[dinext_budget_monthly_amounts]
  BudgetDoc --> Workflow[Workflow Dinext Budget Approval]
  Workflow -->|Approve| SubmitHook[on_budget_submit]
  Workflow -->|Cancel approved| CancelHook[on_budget_cancel]
  SubmitHook --> ProjectBudget[Read model Project Budget]
  CancelHook --> ProjectBudget
  MetricsUI[project_pl_financial_metrics.js] --> MetricsAPI[get_project_financial_metrics]
  MetricsAPI --> ReportPipeline[process_project_data и get_actual_data_simple]
  ReportPipeline --> ProjectBudget
  ReportPipeline --> GLEntry[GL Entry fact]
  MetricsAPI --> ProjectProgress[Project.percent_complete]
  ProjectForm --> MetricsUI
  ClientJS -->|Двойной клик по plan cell| FindApproved[find_approved_budget_for_period]
  FindApproved --> BudgetDoc
  ClientJS --> Reports[ERPNext P&L и GL reports]
```

## 📝 История изменений

Последние значимые изменения на уровне репозитория:

- расчет EVM-метрик вынесен в единый серверный API `get_project_financial_metrics`; клиентская вкладка `Метрики` стала thin render-слоем;
- добавлены Python/JS regression-тесты для серверного расчета EVM и render-слоя вкладки `Метрики`;
- основной flow сохранения плана переведен с прямой записи в `Project Budget` на app-owned budget approval services;
- добавлены Dinext workflow fixtures для согласования `Budget`, включая отдельную роль согласующего и набор workflow states/actions;
- добавлено точное хранение approved monthly amounts в `Budget`, чтобы исключить round-trip drift при approve-sync;
- добавлено regression-покрытие для multi-month approval sync и replacement semantics.
