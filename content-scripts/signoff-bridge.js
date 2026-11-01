// main world so it can read each employee's widget and its knockout rows
(function () {
    'use strict';

    if (window.__SIGNOFF_BRIDGE_ALREADY_RUN__) {
        return;
    }
    window.__SIGNOFF_BRIDGE_ALREADY_RUN__ = true;

    const WIDGET_SELECTOR = '.employeeSignOff';
    const WIDGET_DATA_KEY = 'custom-employeeSignOff';
    const REFRESH_DELAY = 150;
    const MAX_REPEATS = 3;
    const MEETING_CATEGORY = /meeting/i;
    // meetings also get captured under delivery categories, so the category alone misses them
    const MEETING_DESCRIPTION = /meeting|stand[\s-]?up|sync|retro|refinement|planning|catch[\s-]?up|daily|ceremon|1:1/i;
    const MISSING_DAY = /^No hours captured/;
    // context rather than a problem, the row's own info hover still shows them
    const IGNORED_FLAG = /^(Public Holiday|Has Timesheet Exception)/;
    const DAY_MS = 86400000;

    let nextId = 1;
    let lastPublished;
    let refreshTimer;

    // Date comes as 2026/10/01 00:00:00 and Created as 2026-10-05T09:12:33.12
    function dayNumber(value) {
        const match = /^(\d{4})\D(\d{2})\D(\d{2})/.exec(value || '');
        return match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) / DAY_MS : null;
    }

    function durationInHours(duration) {
        const parts = String(duration).split('h');
        return (parseFloat(parts[0]) || 0) + (parseFloat(parts[1]) || 0) / 60;
    }

    function averageLogDelay(entries) {
        const delays = entries
            .map((entry) => [dayNumber(entry.Date), dayNumber(entry.Created)])
            .filter(([worked, created]) => worked !== null && created !== null)
            // leave gets captured ahead of time, which isn't a negative delay
            .map(([worked, created]) => Math.max(created - worked, 0));
        return delays.length ? delays.reduce((total, delay) => total + delay, 0) / delays.length : null;
    }

    function addHours(rows, row, hours) {
        const projectName = row.selectedProject.Name;
        const categoryName = row.selectedCategory.Name || 'Unknown category';
        const project = rows[projectName] = rows[projectName] || { name: projectName, hours: 0, categories: {} };
        project.hours += hours;
        project.categories[categoryName] = (project.categories[categoryName] || 0) + hours;
    }

    function findRepeatedDescriptions(rows) {
        const repeats = new Map();
        rows.forEach((row) => {
            const text = (row.description || '').trim();
            if (!text || MEETING_DESCRIPTION.test(text) || MEETING_CATEGORY.test(row.selectedCategory.Name || '')) return;
            const key = text.toLowerCase().replace(/\s+/g, ' ');
            const repeat = repeats.get(key) || { text, count: 0 };
            repeat.count += 1;
            repeats.set(key, repeat);
        });
        return Array.from(repeats.values()).filter((repeat) => repeat.count > MAX_REPEATS).sort((a, b) => b.count - a.count);
    }

    function countFlags(allRows, rows) {
        const flags = {};
        const add = (name) => { flags[name] = (flags[name] || 0) + 1; };
        allRows.forEach((row) => {
            if (!row.isFirstRow) return;
            [].concat(...row.infoText()).forEach((text) => {
                if (IGNORED_FLAG.test(text) || MISSING_DAY.test(text)) return;
                add(/^The default for /.test(text) ? 'Billable differs from category' : text);
            });
        });
        rows.filter((row) => !(row.description || '').trim()).forEach(() => add('Empty description'));
        return Object.entries(flags).map(([name, count]) => ({ name, count }));
    }

    function summarise(element, widget) {
        const data = widget.data;
        const allRows = widget.koViewModel.datarow();
        const rows = allRows.filter((row) => !row.empty && !row.shouldDelete());
        const entries = data.Days.reduce((all, day) => all.concat(day.TimesheetEntries || []), []);
        const unsigned = entries.filter((entry) => !entry.IsSignedOff && !entry.IsDisabled).length;
        const submitted = widget.koViewModel.hasBeenSubmitted();

        let totalHours = 0;
        let billableHours = 0;
        const projects = {};
        const days = new Set();
        rows.forEach((row) => {
            const hours = durationInHours(row.duration());
            totalHours += hours;
            if (row.billable()) billableHours += hours;
            if (hours > 0) days.add(row.datetext);
            addHours(projects, row, hours);
        });

        const missing = allRows.filter((row) => {
            const info = [].concat(...row.infoText());
            return row.empty && info.some((text) => MISSING_DAY.test(text)) && !info.includes('Public Holiday');
        }).length;

        return {
            id: element.dataset.tbSignoffId,
            employeeId: data.EmployeeId,
            name: `${data.Name} (${data.Country} - ${data.Region})`,
            canSignOff: !!data.CurrentEmployeeAuthorisedToUpdate,
            entryCount: entries.length,
            unsigned: submitted ? 0 : unsigned,
            totalHours,
            billableHours,
            daysCaptured: days.size,
            daysMissing: missing,
            averageDelay: averageLogDelay(entries),
            projects: Object.values(projects)
                .map((project) => ({
                    name: project.name,
                    hours: project.hours,
                    categories: Object.entries(project.categories).map(([name, hours]) => ({ name, hours })).sort((a, b) => b.hours - a.hours)
                }))
                .sort((a, b) => b.hours - a.hours),
            flags: countFlags(allRows, rows),
            repeats: findRepeatedDescriptions(rows)
        };
    }

    function publish() {
        const $ = window.jQuery;
        if (!$) return;

        const summaries = [];
        const people = new Set();
        document.querySelectorAll(WIDGET_SELECTOR).forEach((element) => {
            const widget = $(element).data(WIDGET_DATA_KEY);
            if (!widget || !widget.koViewModel || !widget.data) return;
            people.add(widget.data.EmployeeId);
            // employees with nothing left in the period get the site's "Signed Off" banner and no rows
            if (!widget.data.Days.length) return;
            if (!element.dataset.tbSignoffId) element.dataset.tbSignoffId = String(nextId++);
            summaries.push(summarise(element, widget));
        });

        const detail = JSON.stringify({ summaries, peopleCount: people.size });
        // the render script's own dom writes land back here, so unchanged results have to stop
        if (detail === lastPublished) return;
        lastPublished = detail;
        document.dispatchEvent(new CustomEvent('tb:signoff-updated', { detail }));
    }

    function schedulePublish() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(publish, REFRESH_DELAY);
    }

    document.addEventListener('tb:signoff-ready', () => {
        lastPublished = undefined;
        schedulePublish();
    });
    // description and duration edits don't touch the dom, and a delete only swaps an icon's class
    document.addEventListener('change', schedulePublish, true);
    document.addEventListener('click', schedulePublish, true);
    new MutationObserver(schedulePublish).observe(document.body, { childList: true, subtree: true });
    schedulePublish();
})();
