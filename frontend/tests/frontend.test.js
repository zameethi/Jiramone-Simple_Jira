const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { server } = require('../server');

// Lightweight browser environment shim for testing app.js functions in Node
function createMockElement(tag = 'div') {
  const classes = new Set();
  const listeners = {};
  return {
    tagName: tag.toUpperCase(),
    innerHTML: '',
    textContent: '',
    value: '',
    draggable: false,
    dataset: {},
    style: {},
    children: [],
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (x, force) => {
        if (force === undefined) {
          if (classes.has(x)) classes.delete(x);
          else classes.add(x);
        } else if (force) {
          classes.add(x);
        } else {
          classes.delete(x);
        }
      },
      contains: (x) => classes.has(x),
    },
    setAttribute: () => {},
    addEventListener: (ev, fn) => {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(fn);
    },
    appendChild: function (child) {
      this.children.push(child);
      return child;
    },
    querySelector: function (sel) {
      if (sel === '.kanban-cards') {
        return createMockElement('div');
      }
      return createMockElement('div');
    },
    querySelectorAll: () => [],
  };
}

const mockStore = new Map();
const mockElements = new Map();

global.localStorage = {
  getItem: (k) => (mockStore.has(k) ? mockStore.get(k) : null),
  setItem: (k, v) => mockStore.set(k, String(v)),
  removeItem: (k) => mockStore.delete(k),
};

global.document = {
  getElementById: (id) => {
    if (!mockElements.has(id)) {
      mockElements.set(id, createMockElement('div'));
    }
    return mockElements.get(id);
  },
  createElement: (tag) => createMockElement(tag),
  querySelectorAll: () => [],
  querySelector: () => null,
};

global.window = {
  __JIRAMONE_CONFIG__: { API_URL: 'http://localhost:3000' },
  addEventListener: () => {},
};

const app = require('../public/app');

describe('Frontend Static Server (server.js)', () => {
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves index.html on / with import file picker, confirmation modal, and epics view', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /id="importCsvFile"/);
    assert.match(html, /id="importConfirmModal"/);
    assert.match(html, /id="viewEpics"/);
    assert.match(html, /id="filterEpic"/);
  });

  it('serves /config.js with API_URL', async () => {
    const res = await fetch(`${baseUrl}/config.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/javascript/);
    const body = await res.text();
    assert.match(body, /window\.__JIRAMONE_CONFIG__/);
  });

  it('serves /styles.css and /app.js with proper MIME types', async () => {
    const cssRes = await fetch(`${baseUrl}/styles.css`);
    assert.equal(cssRes.status, 200);
    assert.match(cssRes.headers.get('content-type'), /text\/css/);

    const jsRes = await fetch(`${baseUrl}/app.js`);
    assert.equal(jsRes.status, 200);
    assert.match(jsRes.headers.get('content-type'), /application\/javascript/);
  });

  it('falls back to index.html for unknown SPA routes', async () => {
    const res = await fetch(`${baseUrl}/kanban/board`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });
});

describe('Frontend App Logic (public/app.js)', () => {
  beforeEach(() => {
    mockStore.clear();
    mockElements.clear();
    app.STATE.token = null;
    app.STATE.user = null;
    app.STATE.currentProject = null;
    app.STATE.tasks = [];
    app.STATE.currentView = 'board';
    app.STATE.filters = { search: '', epic: '', type: '', priority: '', assigneeId: '', assigneeIds: [] };
  });

  it('formatRichComment renders bold, inline code, code blocks, safe images, and blocks XSS', () => {
    const raw = [
      'Texto **importante** com `npm test` e <script>alert(1)</script>',
      '```js\nconst x = 1;\n```',
      '![print](data:image/png;base64,iVBORw0KGgo=)',
      '![bad](javascript:alert(1))',
    ].join('\n');

    const html = app.formatRichComment(raw);
    assert.match(html, /<strong>importante<\/strong>/);
    assert.match(html, /<code class="comment-inline-code">npm test<\/code>/);
    assert.match(html, /<pre class="comment-code-block"><code>const x = 1;<\/code><\/pre>/);
    assert.match(html, /<img class="comment-image" src="data:image\/png;base64,iVBORw0KGgo="/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /javascript:alert/);
  });

  it('escapeHtml escapes XSS characters safely', () => {
    assert.equal(app.escapeHtml(''), '');
    assert.equal(app.escapeHtml(null), '');
    assert.equal(
      app.escapeHtml('<script>"alert(\'xss\') &"</script>'),
      '&lt;script&gt;&quot;alert(&#039;xss&#039;) &amp;&quot;&lt;/script&gt;'
    );
  });

  it('getProjectColumns returns project columns or falls back to DEFAULT_COLUMNS', () => {
    assert.deepEqual(app.getProjectColumns(), app.DEFAULT_COLUMNS);

    app.STATE.currentProject = { columns: JSON.stringify([{ id: 'QA', title: 'Em Teste' }]) };
    assert.deepEqual(app.getProjectColumns(), [{ id: 'QA', title: 'Em Teste' }]);

    app.STATE.currentProject = { columns: [{ id: 'CUSTOM', title: 'Custom' }] };
    assert.deepEqual(app.getProjectColumns(), [{ id: 'CUSTOM', title: 'Custom' }]);

    app.STATE.currentProject = { columns: 'invalid-json' };
    assert.deepEqual(app.getProjectColumns(), app.DEFAULT_COLUMNS);
  });

  it('setAuth and logout manage STATE and localStorage', () => {
    app.setAuth('jwt-123', { id: 'u1', email: 'ana@jiramone.dev', name: 'Ana' });
    assert.equal(app.STATE.token, 'jwt-123');
    assert.equal(localStorage.getItem('jiramone_token'), 'jwt-123');

    app.logout();
    assert.equal(app.STATE.token, null);
    assert.equal(app.STATE.user, null);
    assert.equal(localStorage.getItem('jiramone_token'), null);
  });

  it('createCardElement creates a draggable card with key, title, tags, epic pill, and story points', () => {
    app.STATE.tasks = [
      { id: 'e-1', key: 'LR-1', title: 'Épico Principal', type: 'EPIC', status: 'IN_PROGRESS' },
    ];
    const card = app.createCardElement({
      id: 't-1',
      key: 'LR-10',
      title: 'Corrigir <bug>',
      type: 'BUG',
      priority: 'URGENT',
      status: 'TODO',
      parentKey: 'LR-1',
      labels: 'backend,api',
      storyPoints: 5,
      assignee: { name: 'Maria Silva', avatarColor: '#0052cc' },
      _count: { comments: 2 },
    });

    assert.equal(card.draggable, true);
    assert.equal(card.dataset.id, 't-1');
    assert.match(card.innerHTML, /Corrigir &lt;bug&gt;/);
    assert.match(card.innerHTML, /LR-10/);
    assert.match(card.innerHTML, /card-epic-pill/);
    assert.match(card.innerHTML, /LR-1 · Épico Principal/);
    assert.match(card.innerHTML, /backend/);
    assert.match(card.innerHTML, /card-comments-count/);
  });

  it('buildEpicHierarchy groups stories/bugs/tasks under Epics, nested subtasks, external parents, and unassigned', () => {
    const tasks = [
      { id: 'e1', key: 'LR-100', title: 'Entrega Fiscal', type: 'EPIC', status: 'IN_PROGRESS' },
      { id: 's1', key: 'LR-101', title: 'História API', type: 'STORY', status: 'DONE', parentKey: 'LR-100', storyPoints: 5 },
      { id: 'b1', key: 'LR-102', title: 'Bug NFe', type: 'BUG', status: 'TODO', parentKey: 'LR-100', storyPoints: 3 },
      { id: 'sub1', key: 'LR-103', title: 'Subtarefa Testes', type: 'TASK', status: 'DONE', parentKey: 'LR-101', storyPoints: 2 },
      { id: 'ext1', key: 'LR-104', title: 'Item Pai Externo', type: 'STORY', status: 'TODO', parentKey: 'SDD-99' },
      { id: 'u1', key: 'LR-105', title: 'Tarefa Avulsa', type: 'TASK', status: 'BACKLOG', parentKey: null },
    ];

    const h = app.buildEpicHierarchy(tasks);
    assert.equal(h.stats.totalEpics, 1);
    assert.equal(h.epics[0].children.length, 2);
    assert.equal(h.epics[0].nestedChildrenMap['LR-101'].length, 1);
    assert.equal(h.epics[0].totalChildren, 3);
    assert.equal(h.epics[0].doneChildren, 2);
    assert.equal(h.epics[0].progressPct, 67);
    assert.equal(h.epics[0].totalPoints, 10);
    assert.equal(h.externalParents.length, 1);
    assert.equal(h.externalParents[0].parentKey, 'SDD-99');
    assert.equal(h.unassigned.length, 1);
    assert.equal(h.unassigned[0].key, 'LR-105');
  });

  it('renderFiltered filters by epic and renders epics view', () => {
    app.STATE.currentProject = { id: 'p-1', columns: app.DEFAULT_COLUMNS };
    app.STATE.tasks = [
      { id: 'e1', key: 'JIR-1', title: 'Epic 1', type: 'EPIC', priority: 'HIGH', status: 'IN_PROGRESS' },
      { id: 's1', key: 'JIR-2', title: 'Story 1', type: 'STORY', priority: 'HIGH', status: 'TODO', parentKey: 'JIR-1' },
      { id: 'b1', key: 'JIR-3', title: 'Orphan Bug', type: 'BUG', priority: 'LOW', status: 'DONE', parentKey: null },
    ];

    app.STATE.currentView = 'backlog';
    app.STATE.filters.epic = 'JIR-1';
    app.renderFiltered();

    assert.equal(global.document.getElementById('backlogCount').textContent, '2 itens');

    app.STATE.filters.epic = '';
    app.STATE.currentView = 'epics';
    app.renderFiltered();
    assert.match(global.document.getElementById('epicsSummary').innerHTML, /Épicos \(Entregas de Valor\)/);
    assert.equal(global.document.getElementById('epicsHierarchyList').children.length, 2);
  });

  it('renderAvatarFilters prioritizes assignees from current project tasks over global users', () => {
    app.STATE.users = [
      { id: 'u-id-1', name: '557058:abc', email: '557058@jira' },
      { id: 'u-id-2', name: '631022:def', email: '631022@jira' },
    ];
    app.STATE.tasks = [
      { id: 't1', assignee: { id: 'u-pr', name: 'Priscila', email: 'pr@x.com' } },
      { id: 't2', assignee: { id: 'u-pr', name: 'Priscila', email: 'pr@x.com' } },
      { id: 't3', assignee: { id: 'u-ma', name: 'Maria', email: 'ma@x.com' } },
    ];

    app.renderAvatarFilters();
    const container = global.document.getElementById('avatarFilters');
    assert.equal(container.children.length, 2);
    assert.equal(container.children[0].textContent, 'PR');
    assert.equal(container.children[1].textContent, 'MA');
  });

  it('renderFiltered supports multi-select assigneeIds filter', () => {
    app.STATE.currentProject = { id: 'p-1', columns: app.DEFAULT_COLUMNS };
    app.STATE.tasks = [
      { id: '1', key: 'JIR-1', title: 'Task A', type: 'TASK', priority: 'HIGH', status: 'TODO', assigneeId: 'u-pr' },
      { id: '2', key: 'JIR-2', title: 'Task B', type: 'TASK', priority: 'HIGH', status: 'TODO', assigneeId: 'u-ma' },
      { id: '3', key: 'JIR-3', title: 'Task C', type: 'TASK', priority: 'HIGH', status: 'TODO', assigneeId: 'u-ca' },
    ];
    app.STATE.currentView = 'backlog';
    app.STATE.filters.assigneeIds = ['u-pr', 'u-ca'];
    app.renderFiltered();

    assert.equal(global.document.getElementById('backlogCount').textContent, '2 itens');
  });

  it('renderFiltered filters tasks for board and backlog views', () => {
    app.STATE.currentProject = { id: 'p-1', columns: app.DEFAULT_COLUMNS };
    app.STATE.tasks = [
      { id: '1', key: 'JIR-1', title: 'Auth JWT', type: 'STORY', priority: 'HIGH', status: 'TODO', assigneeId: 'u1' },
      { id: '2', key: 'JIR-2', title: 'Fix CSS', type: 'BUG', priority: 'LOW', status: 'DONE', assigneeId: 'u2' },
    ];

    app.STATE.currentView = 'backlog';
    app.STATE.filters.type = 'BUG';
    app.renderFiltered();

    const backlogCount = global.document.getElementById('backlogCount');
    assert.equal(backlogCount.textContent, '1 itens');

    const tbody = global.document.getElementById('backlogTableBody');
    assert.equal(tbody.children.length, 1);
  });
});
