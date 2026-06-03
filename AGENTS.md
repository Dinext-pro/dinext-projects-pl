# Dinext Agent Navigation Stub

Общие агентные инструкции, навыки и правила для Dinext ведутся централизованно в sibling-репозитории `dinext-docs`. Этот файл в consumer-репозитории — указатель и **обязательный** порядок загрузки, а не краткая справка.

**Путь к central repo:** ниже предполагается типичный layout `frappe-bench/apps/<your_app>/` рядом с `frappe-bench/apps/dinext-docs/`. Если clone `dinext-docs` лежит иначе, подставьте фактический путь к корню репозитория `dinext-docs` вместо префикса `../dinext-docs/`.

## Обязательный порядок (до любой реализации / отладки / ревью)

1. Прочитать этот stub целиком.
2. Прочитать контракт доступа: `../dinext-docs/agents/ide/runtime-access.md`.
3. Прочитать реестр: `../dinext-docs/agents/registry/index.yaml` и открыть по задаче релевантные `content_path`.
4. Прочитать каноническое руководство: `../dinext-docs/agents/ide/agents/dinext-frappe-developer-guide.md`.
5. При необходимости — central skills/rules из путей registry, каталоги `../dinext-docs/agents/ide/skills/` и `../dinext-docs/agents/ide/rules/`, workflow предложений `../dinext-docs/agents/ide/proposals/README.md`.

**Не начинать** implementation, debug или review в этом приложении, пока не выполнены шаги 2–4 (минимум). Пропуск central слоя после чтения stub — **нарушение процесса**, а не допустимый fallback; полный контракт и приоритеты см. в `runtime-access.md`.

## Приоритет

**Central Dinext layer** (реестр + runtime-access + developer guide + опубликованные central skills/rules) имеет **операционный приоритет** над встроенными generic Cursor/Compound skills и глобальными workflow **до тех пор**, пока задача явно не сведена к чисто локальному изменению только этого репозитория без затрагивания shared-политик Dinext.

Локальные `.cursor/skills/` и `.cursor/rules/` — только **дополнение** к central слою, не замена.

## Анти-паттерны

- Считать этот stub или `dinext-docs` опциональной справкой и сразу уходить в generic skills.
- Прочитать stub, но не открыть registry и developer guide перед работой.
- Дублировать shared-артефакты в этом репозитории вместо правок в `dinext-docs` (см. central proposal workflow).

## Дополнительные пути (после минимального набора)

- `../dinext-docs/agents/ide/skills/`
- `../dinext-docs/agents/ide/rules/`
- `../dinext-docs/agents/ide/proposals/README.md`

## Локально в этом приложении допустимы только

- app-specific skills в `.cursor/skills/`, если они относятся только к этому приложению;
- app-specific rules в `.cursor/rules/`, если они относятся только к этому приложению;
- опционально: скопировать в `.cursor/rules/` содержимое `../dinext-docs/agents/ide/navigation/consumer-always-apply-rule.mdc.example` (переименовать в `.mdc`), чтобы IDE поднимала central-first порядок автоматически.

Если нужный shared-артефакт отсутствует локально, не создавай его в этом репозитории. Добавляй или обновляй его в `dinext-docs`.

Если хочешь предложить изменение shared-артефакта, используй central proposal workflow через `../dinext-docs/agents/ide/proposals/inbox/`.

## Если central слой уже был пропущен в сессии

Останови текущую линию выполнения, догрузи файлы из шагов выше, переоцени уже сделанные шаги на соответствие central политикам; не продолжай тот же workstream без явной переоценки. Подробнее: раздел про восстановление в `../dinext-docs/agents/ide/runtime-access.md`.
