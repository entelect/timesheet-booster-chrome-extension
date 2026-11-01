(function () {
    'use strict';

    if (window.__SIGNOFF_RENDER_SCRIPT_ALREADY_RUN__) {
        return;
    }
    window.__SIGNOFF_RENDER_SCRIPT_ALREADY_RUN__ = true;

    const COLLAPSED_CLASS = 'tb-signoff-collapsed';

    let bar;
    let expandAll = false;

    document.addEventListener('tb:signoff-updated', (event) => render(JSON.parse(event.detail)));
    document.dispatchEvent(new CustomEvent('tb:signoff-ready'));

    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        Object.entries(attrs).forEach(([key, value]) => {
            if (value === undefined || value === false) return;
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else node.setAttribute(key, value === true ? '' : value);
        });
        children.forEach((child) => child && node.append(child));
        return node;
    }

    function formatHours(hours) {
        const minutes = Math.round(hours * 60);
        return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
    }

    function formatDelay(days) {
        if (days === null) return 'Unknown';
        const rounded = Math.round(days * 10) / 10;
        return rounded === 0 ? 'Same day' : `${rounded} day${rounded === 1 ? '' : 's'}`;
    }

    function statusOf(summary) {
        if (!summary.canSignOff) return { text: 'View only', className: 'tb-signoff-status-muted' };
        if (!summary.entryCount) return { text: 'No entries', className: 'tb-signoff-status-muted' };
        if (!summary.unsigned) return { text: 'Signed off', className: 'tb-signoff-status-done' };
        return { text: `${summary.unsigned} ${summary.unsigned === 1 ? 'entry' : 'entries'} to sign off`, className: 'tb-signoff-status-todo' };
    }

    function stat(label, value) {
        return el('span', { class: 'tb-signoff-stat' }, [
            el('span', { class: 'tb-signoff-stat-label', text: label }),
            el('strong', { text: value })
        ]);
    }

    function setCollapsed(widget, collapsed) {
        widget.classList.toggle(COLLAPSED_CLASS, collapsed);
        const toggle = widget.querySelector(':scope > .tb-signoff-card .tb-signoff-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', String(!collapsed));
    }

    function buildHeader(summary, widget) {
        const status = statusOf(summary);
        const flagCount = summary.flags.reduce((total, flag) => total + flag.count, 0) + summary.repeats.length;
        const billable = summary.totalHours ? Math.round(summary.billableHours / summary.totalHours * 100) : 0;

        return el('button', {
            type: 'button',
            class: 'tb-signoff-toggle',
            'aria-expanded': String(!widget.classList.contains(COLLAPSED_CLASS)),
            onclick: () => setCollapsed(widget, !widget.classList.contains(COLLAPSED_CLASS))
        }, [
            el('span', { class: 'tb-signoff-chevron', 'aria-hidden': 'true' }),
            el('span', { class: 'tb-signoff-name', text: summary.name }),
            el('span', { class: `tb-signoff-status ${status.className}`, text: status.text }),
            el('span', { class: 'tb-signoff-stats' }, [
                stat('Hours', formatHours(summary.totalHours)),
                stat('Billable', `${billable}%`),
                stat('Days', `${summary.daysCaptured} captured, ${summary.daysMissing} missing`),
                stat('Avg time to log', formatDelay(summary.averageDelay)),
                stat('Flags', String(flagCount))
            ])
        ]);
    }

    function buildProjects(projects) {
        return el('section', { class: 'tb-signoff-section' }, [
            el('h4', { text: 'Hours by project' }),
            el('ul', { class: 'tb-signoff-projects' }, projects.map((project) => el('li', {}, [
                el('div', { class: 'tb-signoff-line tb-signoff-project' }, [
                    el('span', { text: project.name }),
                    el('strong', { text: formatHours(project.hours) })
                ]),
                ...project.categories.map((category) => el('div', { class: 'tb-signoff-line tb-signoff-category' }, [
                    el('span', { text: category.name }),
                    el('span', { text: formatHours(category.hours) })
                ]))
            ])))
        ]);
    }

    function buildFlags(summary) {
        if (!summary.flags.length && !summary.repeats.length) {
            return el('section', { class: 'tb-signoff-section' }, [
                el('h4', { text: 'Flags' }),
                el('p', { class: 'tb-signoff-clear', text: 'Nothing flagged' })
            ]);
        }
        return el('section', { class: 'tb-signoff-section' }, [
            el('h4', { text: 'Flags' }),
            el('ul', { class: 'tb-signoff-flags' }, summary.flags.map((flag) => el('li', {}, [
                el('div', { class: 'tb-signoff-line' }, [
                    el('span', { text: flag.name }),
                    el('strong', { text: `x${flag.count}` })
                ])
            ]))),
            summary.repeats.length ? el('h4', { text: 'Repeated descriptions' }) : null,
            summary.repeats.length ? el('ul', { class: 'tb-signoff-flags' }, summary.repeats.map((repeat) => el('li', {}, [
                el('div', { class: 'tb-signoff-line' }, [
                    el('span', { text: repeat.text }),
                    el('strong', { text: `x${repeat.count}` })
                ])
            ]))) : null
        ]);
    }

    function renderCard(summary) {
        const widget = document.querySelector(`[data-tb-signoff-id="${summary.id}"]`);
        if (!widget) return;

        let card = widget.querySelector(':scope > .tb-signoff-card');
        if (!card) {
            card = el('div', { class: 'tb-signoff-card' });
            widget.prepend(card);
            widget.classList.toggle(COLLAPSED_CLASS, !expandAll);
        }
        card.replaceChildren(
            buildHeader(summary, widget),
            el('div', { class: 'tb-signoff-details' }, [buildProjects(summary.projects), buildFlags(summary)])
        );
    }

    function renderBar(summaries, peopleCount) {
        const anchor = document.getElementById('contentdiv');
        if (!anchor) return;
        if (!bar) {
            bar = el('div', { class: 'tb-signoff-bar' });
            anchor.prepend(bar);
        }

        // an employee on two teams has two tables but is still one person to sign off
        const waiting = new Set(summaries.filter((summary) => summary.canSignOff && summary.unsigned).map((summary) => summary.employeeId));
        const count = el('span', { class: 'tb-signoff-count' }, [
            el('strong', { text: String(waiting.size) }),
            ` of ${peopleCount} ${peopleCount === 1 ? 'person' : 'people'} to sign off`
        ]);
        const toggle = el('button', {
            type: 'button',
            class: 'tb-signoff-toggle-all',
            text: expandAll ? 'Collapse all' : 'Expand all',
            onclick: () => {
                expandAll = !expandAll;
                document.querySelectorAll('[data-tb-signoff-id]').forEach((widget) => setCollapsed(widget, !expandAll));
                toggle.textContent = expandAll ? 'Collapse all' : 'Expand all';
            }
        });
        bar.replaceChildren(count, toggle);
    }

    function render({ summaries, peopleCount }) {
        summaries.forEach(renderCard);
        if (peopleCount) {
            renderBar(summaries, peopleCount);
        } else if (bar) {
            bar.remove();
            bar = undefined;
        }
    }
})();
