// Новая версия для тестирования

frappe.query_reports["Project Budget Plan vs Forecast"] = {
    filters: [
        {
            fieldname: "project",
            label: __("Project"),
            fieldtype: "Link",
            options: "Project"
        },
        {
            fieldname: "project_portfolio",
            label: __("Project Portfolio"),
            fieldtype: "Link",
            options: "Project Portfolio"
        },
        {
            fieldname: "cost_center",
            label: __("Cost Center"),
            fieldtype: "Link",
            options: "Cost Center",
            get_query: function() {
                var company = frappe.query_report.get_filter_value("company");
                return {
                    filters: {
                        company: company
                    }
                };
            }
        },
        {
            fieldname: "business_area",
            label: __("Business Area"),
            fieldtype: "Link",
            options: "Business Area"
        },
        {
            fieldname: "company",
            label: __("Company"),
            fieldtype: "Link",
            options: "Company",
            default: frappe.defaults.get_user_default("Company"),
           reqd: 1
        },
        {
            fieldname: "from_year",
            label: __("From Year"),
            fieldtype: "Int",
            default: new Date().getFullYear(),
            reqd: 1
        },
        {
            fieldname: "to_year",
            label: __("To Year"),
            fieldtype: "Int",
            default: new Date().getFullYear(),
            reqd: 1
        },
        {
            fieldname: "from_month",
            label: __("From Month"),
            fieldtype: "Select",
            options: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12",
            default: "1"
        },
        {
            fieldname: "to_month",
            label: __("To Month"),
            fieldtype: "Select",
            options: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12",
            default: "12"
        },
        {
            fieldname: "show_plan",
            label: __("Show Plan"),
            fieldtype: "Check",
            default: 1
        },
        {
            fieldname: "view_type",
            label: __("View Type"),
            fieldtype: "Select",
            options: [
                {value: "forecast_actual", label: __("Forecast and actual")},
                {value: "forecast_only", label: __("Forecast only")},
                {value: "actual_only", label: __("Actual only")}
            ],
            default: "forecast_actual"
        },
        {
            fieldname: "show_zero_columns",
            label: __("Show Zero Columns"),
            fieldtype: "Check",
            default: 1
        },
        {
            fieldname: "show_zero_rows",
            label: __("Show Zero Rows"),
            fieldtype: "Check",
            default: 0
        },
        {
            fieldname: "enable_drill_down",
            label: __("Enable Drill Down"),
            fieldtype: "Check",
            default: 0,
            hidden: 1
        },
        {
            fieldname: "include_future_actual",
            label: __("Show Future Fact"),
            fieldtype: "Check",
            default: 0
        },
        {
            fieldname: "apply_cc_allocation",
            label: __("Apply Cost Center Allocation"),
            fieldtype: "Check",
            default: 1
        }
        
    ],

    onload: function(report) {
        // Добавляем кнопки управления
        report.page.add_inner_button(__("Toggle Plan"), function() {
            var show_plan = report.get_filter_value("show_plan");
            report.set_filter_value("show_plan", show_plan ? 0 : 1);
            report.refresh();
        }, __("Controls"));

        // Кнопка для переключения drill-down
        report.page.add_inner_button(__("Toggle Drill Down"), function() {
            var enable = report.get_filter_value("enable_drill_down");
            report.set_filter_value("enable_drill_down", enable ? 0 : 1);
            frappe.show_alert({
                message: __("Drill Down {0}", [enable ? __("Disabled") : __("Enabled")]),
                indicator: enable ? "red" : "green"
            });
        }, __("Controls"));

        // Применяем стили
        apply_report_styles();
    },

    formatter: function(value, row, column, data, default_formatter) {
        value = default_formatter(value, row, column, data);

        // Выделяем группы счетов жирным шрифтом
        if (data && data.indent === 0) {
            value = `<b>${value}</b>`;
        }

        // Всегда убираем копейки для валютных полей
        if (column.fieldtype === "Currency" && value !== undefined && value !== null) {
            var num = flt(value);
            if (!isNaN(num)) {
                // Округляем до целых и форматируем с разделителями тысяч
                var rounded = Math.round(num);
                // Форматируем число с пробелами в качестве разделителей тысяч
                value = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
            }
        }

        // Затемнение нулей для числовых колонок
        if (data && column.fieldtype === "Currency" && flt(value) === 0) {
            value = `<span style="color: #999; opacity: 0.6;">${value}</span>`;
        }

        // Стили для строки прибыли
        if (data && data.is_profit_row) {
            var profit = flt(value);
            if (!isNaN(profit)) {
                if (profit > 0) {
                    value = `<span style="color: #28a745; font-weight: bold;">${value}</span>`;
                } else if (profit < 0) {
                    value = `<span style="color: #dc3545; font-weight: bold;">${value}</span>`;
                } else {
                    // Для нулевой прибыли также затемняем
                    value = `<span style="color: #999; opacity: 0.6;">${value}</span>`;
                }
            }
        }

        // Стили для строки рентабельности
        if (data && data.is_profitability_row) {
            var profitability = flt(value);
            if (!isNaN(profitability)) {
                if (profitability === 0) {
                    value = `<span style="color: #999; opacity: 0.6;">${value}%</span>`;
                } else {
                    value = `<span style="font-style: italic;">${value}%</span>`;
                }
           }
        }

        // Добавляем drill-down для сумм плана и прогноза
        if (data && data.account && !data.is_profit_row && !data.is_profitability_row) {
            var enable_drill_down = frappe.query_report.get_filter_value("enable_drill_down");
            
            if (enable_drill_down && column.fieldtype === "Currency" && flt(value) !== 0) {
                var fieldname = column.fieldname;
                
                // Для месячных колонок (plan_2026_04, forecast_2026_04)
                if (fieldname.startsWith('plan_') || fieldname.startsWith('forecast_')) {
                    var parts = fieldname.split('_');
                    if (parts.length === 3) {
                        var year = parts[1];
                        var month = parts[2];
                        var data_type = parts[0];
                        
                        value = `<span class="drillable-amount" 
                                    data-account="${data.account}"
                                    data-year="${year}"
                                    data-month="${month}"
                                    data-type="${data_type}"
                                    data-amount="${flt(value)}"
                                    data-is-total="0"
                                    style="cursor: pointer; text-decoration: underline dotted; color: inherit;">
                                    ${value}
                                </span>`;
                    }
                }
                // Для итоговых колонок (total_plan, total_exp_fct)
                else if (fieldname === 'total_plan' || fieldname === 'total_exp_fct' || 
                         fieldname === 'total_exp' || fieldname === 'total_fct') {
                    
                    // Определяем тип данных для итога
                    var total_type = 'plan';
                    if (fieldname === 'total_exp_fct' || fieldname === 'total_exp') {
                        total_type = 'forecast';
                    } else if (fieldname === 'total_fct') {
                        total_type = 'actual';
                    }
                    
                    value = `<span class="drillable-amount" 
                                data-account="${data.account}"
                                data-year="total"
                                data-month="total"
                                data-type="${total_type}"
                                data-amount="${flt(value)}"
                                data-is-total="1"
                                style="cursor: pointer; text-decoration: underline wavy; color: inherit; font-weight: 600;">
                                ${value}
                            </span>`;
                }
            }
        }

        return value;
    },
    
    after_datatable_render: function(datatable) {
        // Ждем полной загрузки таблицы
        setTimeout(function() {
            // Находим заголовки колонок Total и добавляем им класс для выделения
            $('.dt-cell--header .dt-cell__content').each(function() {
                var headerText = $(this).text().trim();
                
                // Проверяем, является ли заголовок итоговой колонкой
                if (headerText.includes("Total Plan") || 
                    headerText.includes("Total Exp/Fct") || 
                    headerText.includes("Total Exp") || 
                    headerText.includes("Total Fct")) {
                    
                    // Добавляем класс для выделения
                    $(this).addClass('total-column-header');
                    
                    // Также добавляем жирное начертание
                    $(this).css({
                        'font-weight': 'bold',
                        'color': '#212529'
                    });
                }
            });
            
            // Также выделяем жирным ячейки в строках с итогами
            $('.dt-cell').each(function() {
                var $cell = $(this);
                var fieldname = $cell.data('fieldname');
                
                // Проверяем, является ли это итоговой колонкой
                if (fieldname && (
                    fieldname === 'total_plan' || 
                    fieldname === 'total_exp_fct' || 
                    fieldname === 'total_exp' || 
                    fieldname === 'total_fct')) {
                    
                    // Добавляем класс для выделения
                    $cell.find('.dt-cell__content').addClass('total-column-data');
                }
            });
            
            // Добавляем обработчики для drill-down
            $('.drillable-amount').off('click').on('click', function(e) {
                e.stopPropagation();
                
                var account = $(this).data('account');
                var year = $(this).data('year');
                var month = $(this).data('month');
                var type = $(this).data('type');
                var amount = $(this).data('amount');
                var isTotal = $(this).data('is-total');
                
                if (isTotal == 1) {
                    // Для итоговых колонок
                    showTotalBudgetDetails(account, type, amount);
                } else {
                    // Для месячных колонок
                    showBudgetDetails(account, year, month, type, amount);
                }
            });
        }, 100);
    }
};

function apply_report_styles() {
    var styles = `
        .report-container .dt-cell__content {
            text-align: right !important;
        }
        
        .report-container .dt-cell--col-0 .dt-cell__content {
            text-align: left !important;
        }
        
        .profit-row {
            background-color: #f8f9fa !important;
            font-weight: bold !important;
        }
        
        .profit-row .dt-cell__content {
            border-top: 2px solid #dee2e6 !important;
        }
        
        .profitability-row {
            background-color: #f8f9fa !important;
            font-style: italic !important;
        }
        
        .indent-1 { padding-left: 20px !important; }
        .indent-2 { padding-left: 40px !important; }
        .indent-3 { padding-left: 60px !important; }
        .indent-4 { padding-left: 80px !important; }
        .indent-5 { padding-left: 100px !important; }
        
        /* Стили для заголовков итоговых колонок */
        .total-column-header {
            font-weight: bold !important;
            color: #212529 !important;
            background-color: #e9ecef !important;
        }
        
        /* Стили для данных в итоговых колонках */
        .total-column-data {
            font-weight: 600 !important;
            background-color: #f8f9fa !important;
        }
        
        /* Дополнительные стили для выделения итоговых колонок */
        [data-fieldname="total_plan"] .dt-cell__content,
        [data-fieldname="total_exp_fct"] .dt-cell__content,
        [data-fieldname="total_exp"] .dt-cell__content,
        [data-fieldname="total_fct"] .dt-cell__content {
            font-weight: 600 !important;
            background-color: #f8f9fa !important;
        }
        
        /* Границы для разделения итоговых колонок */
        [data-fieldname="total_plan"],
        [data-fieldname="total_exp_fct"],
        [data-fieldname="total_exp"],
        [data-fieldname="total_fct"] {
            border-left: 2px solid #dee2e6 !important;
        }
        
        /* Стили для заголовков итоговых колонок (альтернативный подход) */
        .dt-cell--header[data-fieldname="total_plan"] .dt-cell__content,
        .dt-cell--header[data-fieldname="total_exp_fct"] .dt-cell__content,
        .dt-cell--header[data-fieldname="total_exp"] .dt-cell__content,
        .dt-cell--header[data-fieldname="total_fct"] .dt-cell__content {
            font-weight: 700 !important;
            color: #212529 !important;
            background-color: #e9ecef !important;
            border-bottom: 2px solid #adb5bd !important;
        }
        
        /* Стили для модального окна детализации */
        .budget-detail-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        
        .budget-detail-table th {
            background-color: #f8f9fa;
            font-weight: bold;
            padding: 8px;
            text-align: left;
            border-bottom: 2px solid #dee2e6;
        }
        
        .budget-detail-table td {
            padding: 6px 8px;
            border-bottom: 1px solid #e9ecef;
        }
        
        .budget-detail-table tr:hover {
            background-color: #f1f3f4;
        }
        
        .detail-header {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #1a73e8;
            color: #1a73e8;
        }
        
        .detail-subheader {
            font-size: 14px;
            margin-bottom: 10px;
            color: #5f6368;
        }
        
        .drillable-amount {
            cursor: pointer !important;
            text-decoration: underline dotted !important;
            color: inherit !important;
            border-bottom: 1px dashed #aaa;
        }
        
        .drillable-amount:hover {
            text-decoration: underline solid !important;
            font-weight: 600;
            background-color: #f5f5f5;
        }
    `;

    var styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

function showBudgetDetails(account, year, month, type, amount) {
    // Создаем компактный диалог
    var dialog = new frappe.ui.Dialog({
        title: __("Budget Details: {0} - {1}/{2}", [type === 'plan' ? 'Plan' : 'Forecast', year, month]),
        size: "large", // "extra-large" -> "large" для уменьшения
        fields: [
            // Пункт 1: Filter by Project закомментирован
            // {
            //     fieldname: "project_filter",
            //     fieldtype: "Link",
            //     options: "Project",
            //     label: __("Filter by Project"),
            //     default: ""
            // },
            {
                fieldname: "html_details",
                fieldtype: "HTML",
                label: __("Details")
            }
        ],
        // Пункт 2: кнопка Export to Excel убрана
        primary_action_label: __("Export to Excel"),
        primary_action: function() {
            exportBudgetDetailsToExcel(dialog);
        }
    });
    
    dialog.show();
    
    // Загружаем детальные данные (без фильтра по проекту)
    loadBudgetDetails(account, year, month, type, dialog);
    
    // Пункт 1: обработчик фильтра тоже закомментирован
    // dialog.fields_dict.project_filter.df.onchange = function() {
    //     loadBudgetDetails(account, year, month, type, dialog);
    // };
}
/*
function loadBudgetDetails(account, year, month, type, dialog) {
    // var projectFilter = dialog.get_value("project_filter"); // закомментировано
    
    frappe.call({
        method: "dinord_erpnext_customization.dinord_erpnext_customization.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast.get_budget_details",
        args: {
            account: account,
            year: year,
            month: month,
            data_type: type,
            project: null // всегда null, так как фильтр убран
        },
        callback: function(response) {
            if (response.message && response.message.length > 0) {
                renderBudgetDetails(response.message, dialog);
            } else {
                showNoDataMessage(dialog);
            }
        },
        error: function(err) {
            console.error("Error loading budget details:", err);
            frappe.msgprint(__("Error loading budget details: {0}", [err]));
        }
    });
}
*/

function loadBudgetDetails(account, year, month, type, dialog) {
    // Получаем все фильтры из отчета
    var filters = frappe.query_report.get_filter_values();
    
    frappe.call({
        method: "dinord_erpnext_customization.dinord_erpnext_customization.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast.get_budget_details",
        args: {
            account: account,
            year: year,
            month: month,
            data_type: type,
            project: filters.project || null,
            project_portfolio: filters.project_portfolio || null,
            cost_center: filters.cost_center || null,
            business_area: filters.business_area || null,
            company: filters.company
        },
        callback: function(response) {
            if (response.message && response.message.length > 0) {
                renderBudgetDetails(response.message, dialog);
            } else {
                showNoDataMessage(dialog);
            }
        },
        error: function(err) {
            console.error("Error loading budget details:", err);
            frappe.msgprint(__("Error loading budget details: {0}", [err]));
        }
    });
}

function renderBudgetDetails(details, dialog) {
    var html = '';
    
    if (details.length > 0) {
        var amountType = details[0].amount_type;
        
        html += '<div style="max-height: 400px; overflow-y: auto;">';
        html += '<table class="budget-detail-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th>' + __('Project') + '</th>';
        html += '<th>' + __('Account') + '</th>';
        html += '<th>' + __('Year') + '</th>';
        
        // Пункт 3: уменьшаем ширину колонки Month
        html += '<th style="width: 60px;">' + __('Month') + '</th>';
        
        html += '<th style="text-align: right;">' + __(amountType) + '</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';
        
        var total = 0;
        details.forEach(function(row) {
            total += row.amount;
            
            html += '<tr>';
            html += '<td>' + row.project + '</td>';
            html += '<td>' + row.account + '</td>';
            html += '<td>' + row.year + '</td>';
            
            // Пункт 3: месяц без ведущего нуля и центрированный
            html += '<td style="text-align: center;">' + row.month + '</td>';
            
            html += '<td style="text-align: right;">' + formatCurrency(row.amount) + '</td>';
            html += '</tr>';
        });
        
        html += '<tr style="border-top: 2px solid #dee2e6; font-weight: bold; background-color: #f8f9fa;">';
        html += '<td colspan="4" style="text-align: right;">' + __('Total') + ':</td>';
        html += '<td style="text-align: right;">' + formatCurrency(total) + '</td>';
        html += '</tr>';
        html += '</tbody>';
        html += '</table>';
        html += '</div>';
        
        // Добавляем только количество записей внизу
        html += '<div style="margin-top: 10px; font-size: 12px; color: #666; text-align: right;">';
        html += __('Total Records') + ': ' + details.length;
        html += '</div>';
    } else {
        html = '<div class="alert alert-info" style="margin: 10px;">' + 
               __('No budget records found for this account and period') + 
               '</div>';
    }
    
    dialog.fields_dict.html_details.set_value(html);
}

function showNoDataMessage(dialog) {
    var html = '<div class="alert alert-warning" style="margin: 10px;">' + 
               __('No budget data found for this account and period') + 
               '</div>';
    dialog.fields_dict.html_details.set_value(html);
}

function formatCurrency(value) {
    if (value === undefined || value === null) return '0';
    var num = flt(value);
    var rounded = Math.round(num);
    return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function exportBudgetDetailsToExcel(dialog) {
    console.log("=== EXPORT TO EXCEL START ===");
    
    // Пробуем разные способы получить HTML
    
    // Способ 1: через jQuery найти элемент в диалоге
    var $dialog = $(dialog.$wrapper);
    console.log("Dialog wrapper found:", $dialog.length > 0);
    
    // Ищем таблицу напрямую в диалоге
    var $table = $dialog.find('.budget-detail-table');
    console.log("Table found in dialog:", $table.length > 0);
    
    if ($table.length > 0) {
        console.log("Found table directly in dialog, extracting data...");
        extractTableToCSV($table[0]);
        return;
    }
    
    // Способ 2: ищем div с HTML содержимым
    var $htmlContainer = $dialog.find('[data-fieldname="html_details"] .form-control');
    console.log("HTML container found:", $htmlContainer.length > 0);
    
    if ($htmlContainer.length > 0) {
        var htmlContent = $htmlContainer.html();
        console.log("HTML content from container:", htmlContent ? htmlContent.substring(0, 200) : "empty");
        
        if (htmlContent) {
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            var table = tempDiv.querySelector('.budget-detail-table');
            
            if (table) {
                extractTableToCSV(table);
                return;
            }
        }
    }
    
    // Способ 3: через fields_dict но с поиском HTML содержимого в DOM
    var htmlField = dialog.fields_dict.html_details;
    if (htmlField && htmlField.$wrapper) {
        console.log("HTML field wrapper found");
        var $fieldContainer = htmlField.$wrapper.find('.html-content');
        console.log("HTML content div found:", $fieldContainer.length > 0);
        
        if ($fieldContainer.length > 0) {
            var htmlContent = $fieldContainer.html();
            console.log("HTML content from field wrapper:", htmlContent ? htmlContent.substring(0, 200) : "empty");
            
            if (htmlContent) {
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlContent;
                var table = tempDiv.querySelector('.budget-detail-table');
                
                if (table) {
                    extractTableToCSV(table);
                    return;
                }
            }
        }
    }
    
    console.error("Could not find table data using any method");
    frappe.show_alert({
        message: __("Export failed: Could not find table data"),
        indicator: "red"
    });
}

function extractTableToCSV(table) {
    console.log("Extracting table to Excel format...");
    
    try {
        // Собираем данные
        var headers = [];
        table.querySelectorAll('thead th').forEach(th => {
            headers.push(th.innerText.trim());
        });
        
        var dataRows = [];
        var rows = table.querySelectorAll('tbody tr');
        
        // Обрабатываем строки данных
        rows.forEach((tr) => {
            var rowData = [];
            var cells = tr.querySelectorAll('td');
            
            cells.forEach((td, index) => {
                var text = td.innerText.trim();
                
                // Убираем пробелы из чисел
                if (text.match(/[\d\s]+/)) {
                    text = text.replace(/\s/g, '');
                }
                
                rowData.push(text);
            });
            
            // Проверяем, что строка не пустая
            if (rowData.length > 0 && rowData.some(cell => cell.trim() !== '')) {
                dataRows.push(rowData);
            }
        });
        
        console.log("Headers:", headers);
        console.log("Data rows:", dataRows);
        
        // Создаем CSV с правильным разделителем для русской версии Excel
        var csvRows = [];
        
        // Заголовки с разделителем ;
        csvRows.push(headers.join(';'));
        
        // Данные с разделителем ;
        dataRows.forEach(row => {
            // Экранируем только если нужно (для русской версии обычно не требуется)
            var escapedRow = row.map(cell => {
                if (cell.includes(';') || cell.includes('"')) {
                    return '"' + cell.replace(/"/g, '""') + '"';
                }
                return cell;
            });
            csvRows.push(escapedRow.join(';'));
        });
        
        var csvContent = csvRows.join('\n');
        console.log("CSV Content preview:", csvContent.substring(0, 200));
        
        // Добавляем BOM для UTF-8 и используем правильное расширение .csv
        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        var url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute('download', 'budget_details.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        frappe.show_alert({
            message: __("Exported successfully. Open in Excel."),
            indicator: "green"
        });
        console.log("=== EXPORT SUCCESS ===");
        
    } catch (error) {
        console.error("Export error:", error);
        frappe.show_alert({
            message: __("Export error: {0}", [error.message]),
            indicator: "red"
        });
    }
} 

function showTotalBudgetDetails(account, type, amount) {
    // Получаем текущие фильтры отчета
    var filters = frappe.query_report.get_filter_values();
    var from_year = parseInt(filters.from_year);
    var to_year = parseInt(filters.to_year);
    var from_month = parseInt(filters.from_month);
    var to_month = parseInt(filters.to_month);
    
    // Создаем диалог для итогов
    var dialog = new frappe.ui.Dialog({
        title: __("Total {0} Details: {1}", [type === 'plan' ? 'Plan' : 'Forecast', account]),
        size: "large",
        fields: [
            {
                fieldname: "html_details",
                fieldtype: "HTML",
                label: __("Details")
            }
        ],
        primary_action_label: __("Export to Excel"),
        primary_action: function() {
            exportBudgetDetailsToExcel(dialog);
        }
    });
    
    dialog.show();
    
    // Показываем сообщение о загрузке
    dialog.fields_dict.html_details.set_value(`
        <div class="alert alert-info" style="margin: 10px;">
            ${__("Loading data for period {0}-{1} to {2}-{3}...", [from_year, from_month, to_year, to_month])}
        </div>
    `);
    
    // Загружаем данные для каждого месяца
    var allResults = [];
    var monthsToLoad = [];
    
    // Собираем все месяцы в периоде
    for (var year = from_year; year <= to_year; year++) {
        var startMonth = (year === from_year) ? from_month : 1;
        var endMonth = (year === to_year) ? to_month : 12;
        
        for (var month = startMonth; month <= endMonth; month++) {
            monthsToLoad.push({year: year, month: month});
        }
    }
    
    // Загружаем месяцы последовательно
    function loadMonth(index) {
        if (index >= monthsToLoad.length) {
            // Все месяцы загружены - рендерим результат
            renderTotalBudgetDetails(allResults, dialog, type);
            return;
        }
        
        var ym = monthsToLoad[index];
        
        frappe.call({
            method: "dinord_erpnext_customization.dinord_erpnext_customization.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast.get_budget_details",
            args: {
                account: account,
                year: ym.year,
                month: ym.month,
                data_type: type,
                project: null
            },
            callback: function(response) {
                if (response.message && response.message.length > 0) {
                    // Добавляем год и месяц к каждому результату
                    response.message.forEach(row => {
                        row.year = ym.year;
                        row.month = ym.month;
                        allResults.push(row);
                    });
                }
                
                // Загружаем следующий месяц
                loadMonth(index + 1);
            },
            error: function(err) {
                console.error(`Error loading ${ym.year}-${ym.month}:`, err);
                loadMonth(index + 1);
            }
        });
    }
    
    // Начинаем загрузку с первого месяца
    loadMonth(0);
}

function renderTotalBudgetDetails(details, dialog, type) {
    var html = '';
    
    if (details.length > 0) {
        var amountType = type === 'plan' ? 'Plan' : 'Exp.';
        
        html += '<div style="max-height: 400px; overflow-y: auto;">';
        html += '<table class="budget-detail-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th>' + __('Project') + '</th>';
        html += '<th>' + __('Account') + '</th>';
        html += '<th>' + __('Year') + '</th>';
        html += '<th style="width: 60px;">' + __('Month') + '</th>';
        html += '<th style="text-align: right;">' + __(amountType) + '</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';
        
        // Сортируем по году, месяцу и проекту
        details.sort((a, b) => {
            if (a.year !== b.year) return a.year - b.year;
            if (a.month !== b.month) return a.month - b.month;
            return (a.project || '').localeCompare(b.project || '');
        });
        
        var total = 0;
        details.forEach(function(row) {
            total += row.amount;
            
            html += '<tr>';
            html += '<td>' + row.project + '</td>';
            html += '<td>' + row.account + '</td>';
            html += '<td>' + row.year + '</td>';
            html += '<td style="text-align: center;">' + row.month + '</td>';
            html += '<td style="text-align: right;">' + formatCurrency(row.amount) + '</td>';
            html += '</tr>';
        });
        
        html += '<tr style="border-top: 2px solid #dee2e6; font-weight: bold; background-color: #f8f9fa;">';
        html += '<td colspan="4" style="text-align: right;">' + __('Total') + ':</td>';
        html += '<td style="text-align: right;">' + formatCurrency(total) + '</td>';
        html += '</tr>';
        html += '</tbody>';
        html += '</table>';
        html += '</div>';
        
        // Добавляем информацию о периоде и количестве записей
        html += '<div style="margin-top: 10px; font-size: 12px; color: #666; display: flex; justify-content: space-between;">';
        html += '<span>' + __('Period') + ': ' + details[0].year + '-' + details[0].month + ' to ' + 
                details[details.length-1].year + '-' + details[details.length-1].month + '</span>';
        html += '<span>' + __('Total Records') + ': ' + details.length + '</span>';
        html += '</div>';
    } else {
        html = '<div class="alert alert-info" style="margin: 10px;">' + 
               __('No data found for this period') + '</div>';
    }
    
    dialog.fields_dict.html_details.set_value(html);
}