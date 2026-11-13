// Jiramone Frontend Controller
const API_URL = (window.__JIRAMONE_CONFIG__ && window.__JIRAMONE_CONFIG__.API_URL) || 'http://localhost:3000';

const DEFAULT_COLUMNS = [
  { id: 'BACKLOG', title: 'Backlog' },
  { id: 'TODO', title: 'A Fazer' },
  { id: 'IN_PROGRESS', title: 'Em Progresso' },
  { id: 'IN_REVIEW', title: 'Em Revisão' },
  { id: 'DONE', title: 'Concluído' }
];

const STATE = {
  token: localStorage.getItem('jiramone_token') || null,
  user: JSON.parse(localStorage.getItem('jiramone_user') || 'null'),
  projects: [],
  currentProject: null,
  tasks: [],
  users: [],
  currentView: 'board',
  filters: {
    search: '',
    epic: '',
    type: '',
    priority: '',
    assigneeId: '',
    assigneeIds: []
  },
  collapsedEpics: new Set(),
  authMode: 'login', // 'login' | 'register'
  selectedIssuesForDelete: new Set()
};

const ICONS = {
  STORY: {
    icon: '<svg class="issue-type-svg type-story" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    label: 'História (Story)'
  },
  TASK: {
    icon: '<svg class="issue-type-svg type-task" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    label: 'Tarefa (Task)'
  },
  BUG: {
    icon: '<svg class="issue-type-svg type-bug" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>',
    label: 'Bug (Defeito)'
  },
  EPIC: {
    icon: '<svg class="issue-type-svg type-epic" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    label: 'Épico (Epic)'
  }
};

const PRIORITIES = {
  URGENT: {
    label: 'Urgente',
    symbol: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>'
  },
  HIGH: {
    label: 'Alta',
    symbol: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>'
  },
  MEDIUM: {
    label: 'Média',
    symbol: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>'
  },
  LOW: {
    label: 'Baixa',
    symbol: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>'
  }
};

function buildEpicHierarchy(tasks = []) {
  const epicsList = tasks.filter(t => t.type === 'EPIC');
  const epicKeySet = new Set(epicsList.map(e => e.key).filter(Boolean));
  const nonEpics = tasks.filter(t => t.type !== 'EPIC');

  const directChildrenByParent = new Map();
  nonEpics.forEach(t => {
    if (t.parentKey) {
      const pk = String(t.parentKey).trim().toUpperCase();
      if (!directChildrenByParent.has(pk)) directChildrenByParent.set(pk, []);
      directChildrenByParent.get(pk).push(t);
    }
  });

  const assignedIds = new Set();

  const epics = epicsList.map(epic => {
    const directChildren = epic.key ? (directChildrenByParent.get(epic.key.toUpperCase()) || []) : [];
    const nestedChildrenMap = {};
    let totalChildren = 0;
    let doneChildren = 0;
    let totalPoints = 0;
    let donePoints = 0;

    directChildren.forEach(child => {
      assignedIds.add(child.id);
      totalChildren += 1;
      if (child.status === 'DONE') doneChildren += 1;
      const pts = Number(child.storyPoints) || 0;
      totalPoints += pts;
      if (child.status === 'DONE') donePoints += pts;

      if (child.key) {
        const subChildren = directChildrenByParent.get(child.key.toUpperCase()) || [];
        if (subChildren.length > 0) {
          nestedChildrenMap[child.key] = subChildren;
          subChildren.forEach(sub => {
            assignedIds.add(sub.id);
            totalChildren += 1;
            if (sub.status === 'DONE') doneChildren += 1;
            const sPts = Number(sub.storyPoints) || 0;
            totalPoints += sPts;
            if (sub.status === 'DONE') donePoints += sPts;
          });
        }
      }
    });

    const progressPct = totalChildren > 0 ? Math.round((doneChildren / totalChildren) * 100) : (epic.status === 'DONE' ? 100 : 0);
    return {
      epic,
      children: directChildren,
      nestedChildrenMap,
      totalChildren,
      doneChildren,
      progressPct,
      totalPoints,
      donePoints
    };
  });

  // External or non-epic parent groups not already assigned under an Epic
  const externalMap = new Map();
  const unassigned = [];

  nonEpics.forEach(t => {
    if (assignedIds.has(t.id)) return;
    if (t.parentKey && !epicKeySet.has(String(t.parentKey).trim().toUpperCase())) {
      const pk = String(t.parentKey).trim().toUpperCase();
      if (!externalMap.has(pk)) externalMap.set(pk, []);
      externalMap.get(pk).push(t);
    } else {
      unassigned.push(t);
    }
  });

  const externalParents = Array.from(externalMap.entries()).map(([parentKey, children]) => {
    const doneChildren = children.filter(c => c.status === 'DONE').length;
    const progressPct = children.length > 0 ? Math.round((doneChildren / children.length) * 100) : 0;
    return {
      parentKey,
      children,
      totalChildren: children.length,
      doneChildren,
      progressPct
    };
  });

  const totalLinked = assignedIds.size + externalParents.reduce((acc, g) => acc + g.totalChildren, 0);
  const avgProgress = epics.length > 0
    ? Math.round(epics.reduce((acc, e) => acc + e.progressPct, 0) / epics.length)
    : 0;

  return {
    epics,
    externalParents,
    unassigned,
    stats: {
      totalEpics: epics.length,
      totalLinked,
      totalUnassigned: unassigned.length,
      avgProgress
    }
  };
}

function getProjectColumns() {
  if (STATE.currentProject && STATE.currentProject.columns) {
    try {
      const cols = typeof STATE.currentProject.columns === 'string'
        ? JSON.parse(STATE.currentProject.columns)
        : STATE.currentProject.columns;
      if (Array.isArray(cols) && cols.length > 0) return cols;
    } catch (e) {
      console.warn('Erro ao ler colunas do projeto:', e);
    }
  }
  return DEFAULT_COLUMNS;
}

// API Helper
async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (STATE.token) {
    headers['Authorization'] = `Bearer ${STATE.token}`;
  }
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if ((res.status === 401 || res.status === 403) && STATE.token && !path.startsWith('/api/auth/')) {
      logout(false);
      openAuthModal();
      throw new Error('Sua sessão expirou. Faça login novamente.');
    }
    throw new Error(data.error || 'Erro na requisição à API.');
  }
  return data;
}

// Toast
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// Initialization
async function init() {
  setupEventListeners();
  renderUser();
  await loadUsers();
  await loadProjects();
}

function setupEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      switchView(view);
    });
  });

  // Modals closing
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      document.getElementById(modalId).classList.add('hidden');
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.add('hidden');
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => m.classList.add('hidden'));
    } else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      document.getElementById('searchInput').focus();
    }
  });

  // Delete Project
  document.getElementById('btnDeleteProject').addEventListener('click', async () => {
    if (!STATE.currentProject) return;
    if (!STATE.token) {
      openAuthModal();
      return;
    }
    if (!confirm(`Deseja realmente excluir o projeto "${STATE.currentProject.name}" e todas as suas issues?`)) return;
    try {
      await api(`/api/projects/${STATE.currentProject.id}`, { method: 'DELETE' });
      showToast('Projeto excluído com sucesso.');
      STATE.currentProject = null;
      await loadProjects();
    } catch (err) {
      showToast(err.message);
    }
  });

  // Open Project Modal
  document.getElementById('btnNewProject').addEventListener('click', () => {
    if (!STATE.token) {
      openAuthModal();
      return;
    }
    document.getElementById('projectForm').reset();
    document.getElementById('projectModal').classList.remove('hidden');
  });

  // Project Form Submit
  document.getElementById('projectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('projectName').value;
    const key = document.getElementById('projectKey').value;
    const category = document.getElementById('projectCategory').value;
    const description = document.getElementById('projectDescription').value;

    try {
      const newProj = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, key, category, description })
      });
      showToast(`Projeto ${newProj.name} criado com sucesso!`);
      document.getElementById('projectModal').classList.add('hidden');
      await loadProjects(newProj.id);
    } catch (err) {
      alert(err.message);
    }
  });

  // Open Manage Columns Modal
  document.getElementById('btnManageColumns').addEventListener('click', () => {
    if (!STATE.token) {
      openAuthModal();
      return;
    }
    if (!STATE.currentProject) {
      showToast('Selecione um projeto primeiro.');
      return;
    }
    openColumnsModal();
  });

  // Add Column Form Submit
  document.getElementById('addColumnForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('newColumnTitle');
    const title = input.value.trim();
    if (!title || !STATE.currentProject) return;

    const id = title
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    const currentCols = getProjectColumns();
    if (currentCols.some(c => c.id === id)) {
      alert('Já existe uma coluna com identificador similar.');
      return;
    }

    const updatedCols = [...currentCols, { id, title }];
    try {
      await saveProjectColumns(updatedCols);
      input.value = '';
      renderColumnsManagerList();
      renderFiltered();
      showToast(`Coluna "${title}" adicionada com sucesso!`);
    } catch (err) {
      alert(err.message);
    }
  });

  // Open Issue Modal (Create)
  document.getElementById('btnCreateIssue').addEventListener('click', () => {
    if (!STATE.token) {
      openAuthModal();
      return;
    }
    if (!STATE.currentProject) {
      showToast('Selecione um projeto primeiro.');
      return;
    }
    openIssueModal();
  });

  // Issue Form Submit
  document.getElementById('issueForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!STATE.token) {
      openAuthModal();
      return;
    }
    const id = document.getElementById('issueId').value;
    const title = document.getElementById('issueTitle').value;
    const description = document.getElementById('issueDescription').value;
    const labels = document.getElementById('issueLabels').value;
    const status = document.getElementById('issueStatus').value;
    const type = document.getElementById('issueType').value;
    const priority = document.getElementById('issuePriority').value;
    const assigneeId = document.getElementById('issueAssignee').value || null;
    const storyPoints = document.getElementById('issuePoints').value;
    const sprint = document.getElementById('issueSprint').value;
    const dueDate = document.getElementById('issueDueDate').value || null;
    const environment = document.getElementById('issueEnvironment').value;
    const components = document.getElementById('issueComponents').value;
    const parentKey = document.getElementById('issueParentKey').value;
    const resolution = document.getElementById('issueResolution').value;

    const payload = {
      title,
      description,
      labels,
      status,
      type,
      priority,
      assigneeId,
      storyPoints: storyPoints !== '' ? Number(storyPoints) : null,
      sprint,
      dueDate,
      environment,
      components,
      parentKey,
      resolution,
      projectId: STATE.currentProject.id
    };

    try {
      if (id) {
        await api(`/api/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        showToast('Issue atualizada!');
      } else {
        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        showToast('Nova issue criada!');
      }
      document.getElementById('issueModal').classList.add('hidden');
      await loadTasks();
    } catch (err) {
      showToast(err.message);
    }
  });

  // Delete Issue
  document.getElementById('btnDeleteIssue').addEventListener('click', async () => {
    if (!STATE.token) {
      openAuthModal();
      return;
    }
    const id = document.getElementById('issueId').value;
    if (!id || !confirm('Deseja realmente excluir esta issue?')) return;

    try {
      await api(`/api/tasks/${id}`, { method: 'DELETE' });
      showToast('Issue excluída com sucesso.');
      document.getElementById('issueModal').classList.add('hidden');
      await loadTasks();
    } catch (err) {
      showToast(err.message);
    }
  });

  // Add Comment
  async function submitComment() {
    if (!STATE.token) {
      openAuthModal();
      return;
    }
    const taskId = document.getElementById('issueId').value;
    const input = document.getElementById('newCommentInput');
    const content = input.value.trim();
    if (!content) return;

    try {
      await api(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content })
      });
      input.value = '';
      await loadComments(taskId);
      await loadTasks();
      showToast('Comentário adicionado!');
    } catch (err) {
      showToast(err.message);
    }
  }

  document.getElementById('btnAddComment').addEventListener('click', submitComment);
  const newCommentEl = document.getElementById('newCommentInput');
  newCommentEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submitComment();
    }
  });

  function wrapCommentSelection(before, after, placeholder) {
    const start = newCommentEl.selectionStart || 0;
    const end = newCommentEl.selectionEnd || 0;
    const val = newCommentEl.value;
    const selected = val.slice(start, end) || placeholder;
    newCommentEl.value = val.slice(0, start) + before + selected + after + val.slice(end);
    newCommentEl.focus();
    const cursorPos = start + before.length + selected.length + after.length;
    newCommentEl.setSelectionRange(cursorPos, cursorPos);
  }

  function insertCommentImageFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const safeName = (file.name || 'imagem').replace(/[[\]()]/g, '');
        const md = `\n![${safeName}](${reader.result})\n`;
        const pos = newCommentEl.selectionStart || newCommentEl.value.length;
        newCommentEl.value = newCommentEl.value.slice(0, pos) + md + newCommentEl.value.slice(pos);
        newCommentEl.focus();
      }
    };
    reader.readAsDataURL(file);
  }

  const btnCommentBold = document.getElementById('btnCommentBold');
  if (btnCommentBold) {
    btnCommentBold.addEventListener('click', () => wrapCommentSelection('**', '**', 'texto em negrito'));
  }

  const btnCommentCode = document.getElementById('btnCommentCode');
  if (btnCommentCode) {
    btnCommentCode.addEventListener('click', () => {
      const start = newCommentEl.selectionStart || 0;
      const end = newCommentEl.selectionEnd || 0;
      const selected = newCommentEl.value.slice(start, end);
      if (!selected || selected.includes('\n')) {
        wrapCommentSelection('```\n', '\n```', 'código aqui');
      } else {
        wrapCommentSelection('`', '`', 'código');
      }
    });
  }

  const btnCommentImage = document.getElementById('btnCommentImage');
  const commentImageInput = document.getElementById('commentImageInput');
  if (btnCommentImage && commentImageInput) {
    btnCommentImage.addEventListener('click', () => commentImageInput.click());
    commentImageInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) insertCommentImageFile(file);
      commentImageInput.value = '';
    });
  }

  newCommentEl.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault();
        insertCommentImageFile(item.getAsFile());
        break;
      }
    }
  });

  // Filters
  document.getElementById('searchInput').addEventListener('input', (e) => {
    STATE.filters.search = e.target.value.toLowerCase();
    renderFiltered();
  });
  const filterEpicEl = document.getElementById('filterEpic');
  if (filterEpicEl) {
    filterEpicEl.addEventListener('change', (e) => {
      STATE.filters.epic = e.target.value;
      renderFiltered();
    });
  }
  document.getElementById('filterType').addEventListener('change', (e) => {
    STATE.filters.type = e.target.value;
    renderFiltered();
  });
  document.getElementById('filterPriority').addEventListener('change', (e) => {
    STATE.filters.priority = e.target.value;
    renderFiltered();
  });
  document.getElementById('btnClearFilters').addEventListener('click', () => {
    STATE.filters = { search: '', epic: '', type: '', priority: '', assigneeId: '', assigneeIds: [] };
    document.getElementById('searchInput').value = '';
    if (filterEpicEl) filterEpicEl.value = '';
    document.getElementById('filterType').value = '';
    document.getElementById('filterPriority').value = '';
    document.querySelectorAll('.avatar-filter-item').forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-pressed', 'false');
    });
    const avatarContainer = document.getElementById('avatarFilters');
    if (avatarContainer) avatarContainer.classList.remove('has-selection');
    renderFiltered();
  });

  const btnCreateEpicFromView = document.getElementById('btnCreateEpicFromView');
  if (btnCreateEpicFromView) {
    btnCreateEpicFromView.addEventListener('click', () => {
      if (!STATE.token) {
        openAuthModal();
        showToast('Faça login para criar um épico.');
        return;
      }
      openIssueModal(null, null, 'EPIC');
    });
  }

  // Manage Panel Batch & Clear Listeners
  const checkAll = document.getElementById('checkSelectAllIssues');
  if (checkAll) {
    checkAll.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      STATE.selectedIssuesForDelete.clear();
      if (isChecked) {
        STATE.tasks.forEach(t => STATE.selectedIssuesForDelete.add(t.id));
      }
      updateSelectedIssuesUI();
    });
  }

  const btnBulkDelete = document.getElementById('btnBulkDeleteIssues');
  if (btnBulkDelete) {
    btnBulkDelete.addEventListener('click', async () => {
      if (!STATE.token) {
        openAuthModal();
        return;
      }
      const count = STATE.selectedIssuesForDelete.size;
      if (count === 0) return;
      if (!confirm(`Deseja realmente excluir as ${count} issues selecionadas?`)) return;

      try {
        const ids = Array.from(STATE.selectedIssuesForDelete);
        for (const id of ids) {
          await api(`/api/tasks/${id}`, { method: 'DELETE' });
        }
        STATE.selectedIssuesForDelete.clear();
        showToast(`${count} issues excluídas com sucesso!`);
        await loadProjects(STATE.currentProject ? STATE.currentProject.id : null);
        renderManagePanel();
      } catch (err) {
        showToast('Erro ao excluir issues: ' + err.message);
      }
    });
  }

  const btnClearAll = document.getElementById('btnClearAllIssuesFromProject');
  if (btnClearAll) {
    btnClearAll.addEventListener('click', async () => {
      if (!STATE.token) {
        openAuthModal();
        return;
      }
      if (!STATE.currentProject) {
        showToast('Nenhum projeto selecionado.');
        return;
      }
      if (STATE.tasks.length === 0) {
        showToast('Este projeto já não possui nenhuma issue.');
        return;
      }
      if (!confirm(`ATENÇÃO: Deseja apagar TODAS as ${STATE.tasks.length} issues do projeto "${STATE.currentProject.name}"?`)) return;

      try {
        for (const t of STATE.tasks) {
          await api(`/api/tasks/${t.id}`, { method: 'DELETE' });
        }
        STATE.selectedIssuesForDelete.clear();
        showToast(`Todas as issues do projeto foram apagadas!`);
        await loadProjects(STATE.currentProject.id);
        renderManagePanel();
      } catch (err) {
        showToast('Erro ao limpar issues: ' + err.message);
      }
    });
  }

  // Import Form Submit Listener -> abre modal perguntando se deseja remover itens atuais
  const importForm = document.getElementById('importForm');
  if (importForm) {
    importForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!STATE.token) {
        openAuthModal();
        return;
      }

      const fileInput = document.getElementById('importCsvFile');
      const selectedFile = fileInput && fileInput.files && fileInput.files[0];
      const fileLabel = document.getElementById('importConfirmFileLabel');
      if (fileLabel) {
        fileLabel.textContent = selectedFile
          ? `Arquivo selecionado: ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`
          : 'Arquivo padrão: Jira.csv (raiz do projeto)';
      }

      document.getElementById('importConfirmModal').classList.remove('hidden');
    });
  }

  async function executeJiraImport(clearExisting) {
    document.getElementById('importConfirmModal').classList.add('hidden');

    const limit = Number(document.getElementById('importLimit').value);
    const projectKeyOverride = document.getElementById('importProjectKeyOverride').value.trim();
    const projectNameOverride = document.getElementById('importProjectNameOverride').value.trim();
    const fileInput = document.getElementById('importCsvFile');
    const selectedFile = fileInput && fileInput.files && fileInput.files[0];

    const btnSubmit = document.getElementById('btnStartImport');
    const progressText = document.getElementById('importProgressText');
    const resultBox = document.getElementById('importResultBox');
    const statsBox = document.getElementById('importResultStats');

    btnSubmit.disabled = true;
    progressText.textContent = selectedFile
      ? `Lendo e importando "${selectedFile.name}", aguarde...`
      : 'Importando dados do Jira.csv, aguarde...';
    resultBox.classList.add('hidden');

    try {
      let csvContent;
      if (selectedFile) {
        csvContent = await selectedFile.text();
      }

      const res = await api('/api/import/run', {
        method: 'POST',
        body: JSON.stringify({
          limit: limit === 0 ? 0 : limit,
          projectKeyOverride: projectKeyOverride || undefined,
          projectNameOverride: projectNameOverride || undefined,
          clearExisting: Boolean(clearExisting),
          csvContent
        })
      });

      const s = res.stats || {};
      statsBox.innerHTML = `
        <div><strong>Linhas analisadas:</strong> ${s.totalRowsRead || 0}</div>
        ${clearExisting ? `<div><strong>Tarefas antigas removidas:</strong> ${s.tasksDeleted || 0}</div>` : ''}
        <div><strong>Tarefas (Issues) criadas:</strong> ${s.tasksCreated || 0}</div>
        <div><strong>Tarefas atualizadas:</strong> ${s.tasksUpdated || 0}</div>
        <div><strong>Comentários importados:</strong> ${s.commentsCreated || 0}</div>
        <div><strong>Usuários criados/mapeados:</strong> ${s.usersCreatedOrFound || 0}</div>
        <div><strong>Projetos criados/mapeados:</strong> ${s.projectsCreatedOrFound || 0}</div>
      `;
      resultBox.classList.remove('hidden');
      progressText.textContent = 'Concluído!';
      showToast('Importação do Jira finalizada com sucesso!');
      await loadProjects();
      await loadUsers();
    } catch (err) {
      progressText.textContent = '';
      showToast('Erro ao importar: ' + err.message);
    } finally {
      btnSubmit.disabled = false;
    }
  }

  const btnConfirmClear = document.getElementById('btnConfirmImportClear');
  if (btnConfirmClear) {
    btnConfirmClear.addEventListener('click', () => executeJiraImport(true));
  }
  const btnConfirmKeep = document.getElementById('btnConfirmImportKeep');
  if (btnConfirmKeep) {
    btnConfirmKeep.addEventListener('click', () => executeJiraImport(false));
  }

  const btnGoToBoard = document.getElementById('btnGoToBoardAfterImport');
  if (btnGoToBoard) {
    btnGoToBoard.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      const boardBtn = document.querySelector('.nav-item[data-view="board"]');
      if (boardBtn) boardBtn.classList.add('active');
      switchView('board');
    });
  }

  // Auth Modal & Form
  document.getElementById('btnDemoLogin').addEventListener('click', async () => {
    try {
      const data = await api('/api/auth/demo', { method: 'POST' });
      setAuth(data.token, data.user);
      document.getElementById('authModal').classList.add('hidden');
      showToast('Conectado como usuário Demo!');
      await loadProjects();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btnToggleAuthMode').addEventListener('click', () => {
    STATE.authMode = STATE.authMode === 'login' ? 'register' : 'login';
    const isReg = STATE.authMode === 'register';
    document.getElementById('authModalTitle').textContent = isReg ? 'Criar Conta no Jiramone' : 'Entrar no Jiramone';
    document.getElementById('authNameGroup').classList.toggle('hidden', !isReg);
    document.getElementById('btnAuthSubmit').textContent = isReg ? 'Cadastrar' : 'Entrar';
    document.getElementById('authSwitchText').textContent = isReg ? 'Já possui conta?' : 'Não tem conta?';
    document.getElementById('btnToggleAuthMode').textContent = isReg ? 'Fazer login' : 'Criar conta';
  });

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const name = document.getElementById('authName').value;

    const endpoint = STATE.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = STATE.authMode === 'register' ? { email, password, name } : { email, password };

    try {
      const data = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setAuth(data.token, data.user);
      document.getElementById('authModal').classList.add('hidden');
      showToast(`Bem-vindo, ${data.user.name || data.user.email}!`);
      await loadProjects();
    } catch (err) {
      alert(err.message);
    }
  });
}

function setAuth(token, user) {
  STATE.token = token;
  STATE.user = user;
  localStorage.setItem('jiramone_token', token);
  localStorage.setItem('jiramone_user', JSON.stringify(user));
  renderUser();
  updateProjectActionsVisibility();
}

function logout(notify = true) {
  STATE.token = null;
  STATE.user = null;
  localStorage.removeItem('jiramone_token');
  localStorage.removeItem('jiramone_user');
  renderUser();
  updateProjectActionsVisibility();
  if (notify) showToast('Sessão encerrada.');
}

function updateProjectActionsVisibility() {
  const btnDeleteProj = document.getElementById('btnDeleteProject');
  if (!btnDeleteProj) return;
  const isOwner = STATE.user && STATE.currentProject && STATE.currentProject.ownerId === STATE.user.id;
  btnDeleteProj.classList.toggle('hidden', !isOwner);
}

function openAuthModal() {
  document.getElementById('authModal').classList.remove('hidden');
}

function renderUser() {
  const box = document.getElementById('userBox');
  if (STATE.user) {
    const displayName = STATE.user.name || STATE.user.email || 'Usuário';
    const initials = displayName.substring(0, 2).toUpperCase();
    box.innerHTML = `
      <div class="user-profile">
        <div class="user-avatar" style="background:${escapeHtml(STATE.user.avatarColor || '#0052cc')}">${escapeHtml(initials)}</div>
        <div class="user-info">
          <span class="user-name">${escapeHtml(displayName)}</span>
          <span class="user-role">${escapeHtml(STATE.user.role || 'Member')}</span>
        </div>
      </div>
      <button id="btnLogout" class="btn-icon" title="Sair">🚪</button>
    `;
    document.getElementById('btnLogout').addEventListener('click', () => logout(true));
  } else {
    box.innerHTML = `
      <button id="btnOpenLogin" class="btn btn-secondary btn-block">Entrar / Demo</button>
    `;
    document.getElementById('btnOpenLogin').addEventListener('click', openAuthModal);
  }
}

async function loadUsers() {
  try {
    const users = await api('/api/users');
    STATE.users = users;
    renderAssigneeSelect();
    renderAvatarFilters();
  } catch (err) {
    console.error('Falha ao carregar usuários:', err);
  }
}

function renderAssigneeSelect() {
  const select = document.getElementById('issueAssignee');
  select.innerHTML = '<option value="">Não atribuído</option>';
  STATE.users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.name || u.email;
    select.appendChild(opt);
  });
}

function renderAvatarFilters() {
  const container = document.getElementById('avatarFilters');
  if (!container) return;
  container.innerHTML = '';

  // Prioritize assignees present in the current project's tasks (most frequent first)
  const assigneeCounts = new Map();
  STATE.tasks.forEach(t => {
    if (t.assignee && t.assignee.id) {
      const existing = assigneeCounts.get(t.assignee.id);
      if (existing) {
        existing.count += 1;
      } else {
        assigneeCounts.set(t.assignee.id, { user: t.assignee, count: 1 });
      }
    }
  });

  let usersToShow = Array.from(assigneeCounts.values())
    .sort((a, b) => b.count - a.count)
    .map(entry => entry.user);

  if (usersToShow.length === 0) {
    usersToShow = STATE.users;
  }

  const selectedIds = Array.isArray(STATE.filters.assigneeIds) ? STATE.filters.assigneeIds : [];
  container.classList.toggle('has-selection', selectedIds.length > 0);

  usersToShow.slice(0, 5).forEach(u => {
    const displayName = u.name || u.email || '?';
    const initials = displayName.substring(0, 2).toUpperCase();
    const isSelected = selectedIds.includes(u.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `avatar-filter-item${isSelected ? ' active' : ''}`;
    btn.setAttribute('aria-pressed', String(isSelected));
    btn.style.background = u.avatarColor || '#4F46E5';
    btn.title = `${displayName}${isSelected ? ' (Selecionado)' : ''}`;
    btn.textContent = initials;
    btn.addEventListener('click', () => {
      const idx = STATE.filters.assigneeIds.indexOf(u.id);
      if (idx >= 0) {
        STATE.filters.assigneeIds.splice(idx, 1);
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      } else {
        STATE.filters.assigneeIds.push(u.id);
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      }
      container.classList.toggle('has-selection', STATE.filters.assigneeIds.length > 0);
      renderFiltered();
    });
    container.appendChild(btn);
  });
}

async function loadProjects(selectProjectId = null) {
  try {
    const projects = await api('/api/projects');
    STATE.projects = projects;
    renderProjectList();

    if (projects.length > 0) {
      const target = selectProjectId 
        ? projects.find(p => p.id === selectProjectId) || projects[0]
        : projects[0];
      selectProject(target);
    } else {
      document.getElementById('currentProjectName').textContent = 'Nenhum projeto encontrado';
      document.getElementById('currentProjectKey').textContent = '-';
      document.getElementById('currentProjectDesc').textContent = 'Crie seu primeiro projeto no botão "+" acima.';
    }
  } catch (err) {
    console.error('Erro ao carregar projetos:', err);
  }
}

function renderProjectList() {
  const container = document.getElementById('projectList');
  container.innerHTML = '';
  STATE.projects.forEach(p => {
    const btn = document.createElement('button');
    btn.className = `project-item ${STATE.currentProject && STATE.currentProject.id === p.id ? 'active' : ''}`;
    btn.innerHTML = `
      <span>${escapeHtml(p.name)}</span>
      <span class="project-item-key">${escapeHtml(p.key)}</span>
    `;
    btn.addEventListener('click', () => selectProject(p));
    container.appendChild(btn);
  });
}

function selectProject(proj) {
  STATE.currentProject = proj;
  document.getElementById('currentProjectName').textContent = proj.name;
  document.getElementById('currentProjectKey').textContent = proj.key;
  document.getElementById('currentProjectDesc').textContent = proj.description || '';
  renderProjectList();
  renderIssueStatusOptions();
  updateProjectActionsVisibility();
  loadTasks();
}

function renderIssueStatusOptions() {
  const select = document.getElementById('issueStatus');
  const columns = getProjectColumns();
  select.innerHTML = columns.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join('');
}

async function loadTasks() {
  if (!STATE.currentProject) return;
  try {
    const tasks = await api(`/api/tasks?projectId=${STATE.currentProject.id}`);
    STATE.tasks = tasks;
    renderEpicFilterOptions();
    renderAvatarFilters();
    if (STATE.currentView === 'manage') {
      renderManagePanel();
    } else {
      renderFiltered();
    }
  } catch (err) {
    console.error('Erro ao buscar tarefas:', err);
  }
}

function renderEpicFilterOptions() {
  const select = document.getElementById('filterEpic');
  if (!select) return;
  const currentVal = STATE.filters.epic || '';
  const epics = STATE.tasks.filter(t => t.type === 'EPIC');
  select.innerHTML = '<option value="">Todos os Épicos</option><option value="__NONE__">Sem Épico vinculado</option>';
  epics.forEach(epic => {
    const opt = document.createElement('option');
    opt.value = epic.key || '';
    const titleShort = epic.title.length > 38 ? `${epic.title.slice(0, 38)}...` : epic.title;
    opt.textContent = `${epic.key ? `${epic.key} — ` : ''}${titleShort}`;
    select.appendChild(opt);
  });
  select.value = currentVal;
}

function renderParentKeySelect(selectedParentKey = '', currentTaskKey = '') {
  const select = document.getElementById('issueParentKey');
  if (!select) return;
  const normalizedSelected = selectedParentKey ? String(selectedParentKey).trim().toUpperCase() : '';
  const normalizedSelf = currentTaskKey ? String(currentTaskKey).trim().toUpperCase() : '';

  select.innerHTML = '<option value="">Nenhum (Item raiz)</option>';

  const truncateTitle = (title, max = 52) => (title && title.length > max ? `${title.slice(0, max)}...` : (title || ''));

  const epics = STATE.tasks.filter(t => t.type === 'EPIC' && t.key && t.key.toUpperCase() !== normalizedSelf);
  if (epics.length > 0) {
    const epicGroup = document.createElement('optgroup');
    epicGroup.label = 'Épicos (Entregas de Valor)';
    epics.forEach(epic => {
      const opt = document.createElement('option');
      opt.value = epic.key;
      opt.textContent = `${epic.key} — ${truncateTitle(epic.title)}`;
      epicGroup.appendChild(opt);
    });
    select.appendChild(epicGroup);
  }

  const storiesAndTasks = STATE.tasks.filter(
    t => t.type !== 'EPIC' && t.key && t.key.toUpperCase() !== normalizedSelf
  );
  if (storiesAndTasks.length > 0) {
    const itemGroup = document.createElement('optgroup');
    itemGroup.label = 'Histórias / Tarefas (para Subtarefas)';
    storiesAndTasks.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.key;
      opt.textContent = `${item.key} — ${truncateTitle(item.title)}`;
      itemGroup.appendChild(opt);
    });
    select.appendChild(itemGroup);
  }

  if (normalizedSelected) {
    const exists = Array.from(select.options).some(o => o.value.toUpperCase() === normalizedSelected);
    if (!exists) {
      const extOpt = document.createElement('option');
      extOpt.value = normalizedSelected;
      extOpt.textContent = `${normalizedSelected} (Chave externa)`;
      select.appendChild(extOpt);
    }
    select.value = normalizedSelected;
  } else {
    select.value = '';
  }
}

function renderFiltered() {
  let list = STATE.tasks;

  if (STATE.filters.search) {
    const q = STATE.filters.search;
    list = list.filter(t => 
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.key && t.key.toLowerCase().includes(q)) ||
      (t.parentKey && t.parentKey.toLowerCase().includes(q)) ||
      (t.labels && t.labels.toLowerCase().includes(q))
    );
  }

  if (STATE.filters.epic) {
    if (STATE.filters.epic === '__NONE__') {
      list = list.filter(t => t.type !== 'EPIC' && !t.parentKey);
    } else {
      const epicKey = STATE.filters.epic.toUpperCase();
      const directChildKeys = new Set(
        STATE.tasks
          .filter(t => t.parentKey && t.parentKey.toUpperCase() === epicKey && t.key)
          .map(t => t.key.toUpperCase())
      );
      list = list.filter(
        t =>
          (t.key && t.key.toUpperCase() === epicKey) ||
          (t.parentKey && (t.parentKey.toUpperCase() === epicKey || directChildKeys.has(t.parentKey.toUpperCase())))
      );
    }
  }

  if (STATE.filters.type) {
    list = list.filter(t => t.type === STATE.filters.type);
  }

  if (STATE.filters.priority) {
    list = list.filter(t => t.priority === STATE.filters.priority);
  }

  if (Array.isArray(STATE.filters.assigneeIds) && STATE.filters.assigneeIds.length > 0) {
    list = list.filter(t => STATE.filters.assigneeIds.includes(t.assigneeId));
  } else if (STATE.filters.assigneeId) {
    list = list.filter(t => t.assigneeId === STATE.filters.assigneeId);
  }

  if (STATE.currentView === 'board') {
    renderKanban(list);
  } else if (STATE.currentView === 'epics') {
    renderEpicsView(list);
  } else if (STATE.currentView === 'backlog') {
    renderBacklog(list);
  } else if (STATE.currentView === 'dashboard') {
    renderDashboard();
  }
}

function switchView(viewName) {
  STATE.currentView = viewName;
  document.getElementById('viewBoard').classList.toggle('active', viewName === 'board');
  const viewEpicsEl = document.getElementById('viewEpics');
  if (viewEpicsEl) viewEpicsEl.classList.toggle('active', viewName === 'epics');
  document.getElementById('viewBacklog').classList.toggle('active', viewName === 'backlog');
  document.getElementById('viewDashboard').classList.toggle('active', viewName === 'dashboard');
  document.getElementById('viewManage').classList.toggle('active', viewName === 'manage');
  document.getElementById('viewImport').classList.toggle('active', viewName === 'import');
  if (viewName === 'manage') {
    renderManagePanel();
  } else if (viewName === 'import') {
    checkImportFileInfo();
  } else {
    renderFiltered();
  }
}

/* Kanban Board & Drag and Drop */
function renderKanban(tasks) {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = '';

  const columns = getProjectColumns();

  columns.forEach(col => {
    const colTasks = tasks.filter(t => t.status === col.id);

    const colEl = document.createElement('div');
    colEl.className = 'kanban-column';
    colEl.dataset.status = col.id;

    colEl.innerHTML = `
      <div class="kanban-column-header">
        <span>${escapeHtml(col.title)}</span>
        <span class="column-count">${colTasks.length}</span>
      </div>
      <div class="kanban-cards" data-column="${col.id}"></div>
    `;

    const cardsContainer = colEl.querySelector('.kanban-cards');

    // Drag-over events
    cardsContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      cardsContainer.classList.add('drag-over');
    });

    cardsContainer.addEventListener('dragleave', () => {
      cardsContainer.classList.remove('drag-over');
    });

    cardsContainer.addEventListener('drop', async (e) => {
      e.preventDefault();
      cardsContainer.classList.remove('drag-over');
      if (!STATE.token) {
        openAuthModal();
        showToast('Faça login para mover issues no quadro.');
        return;
      }
      const taskId = e.dataTransfer.getData('text/plain');
      if (!taskId) return;

      const targetStatus = col.id;
      const task = STATE.tasks.find(t => t.id === taskId);
      if (task && task.status !== targetStatus) {
        const previousStatus = task.status;
        task.status = targetStatus;
        renderFiltered(); // optimistic update
        try {
          await api(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: targetStatus })
          });
        } catch (err) {
          task.status = previousStatus;
          renderFiltered();
          showToast('Erro ao atualizar status: ' + err.message);
        }
      }
    });

    colTasks.forEach(task => {
      const card = createCardElement(task);
      cardsContainer.appendChild(card);
    });

    board.appendChild(colEl);
  });
}

function createCardElement(task) {
  const el = document.createElement('div');
  el.className = task.type === 'EPIC' ? 'kanban-card kanban-card-epic' : 'kanban-card';
  el.draggable = true;
  el.dataset.id = task.id;

  el.addEventListener('dragstart', (e) => {
    el.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
  });

  el.addEventListener('click', () => openIssueModal(task));

  const typeInfo = ICONS[task.type] || ICONS.TASK;
  const priorityInfo = PRIORITIES[task.priority] || PRIORITIES.MEDIUM;
  const labelsArr = task.labels ? task.labels.split(',').map(s => s.trim()).filter(Boolean) : [];
  const assigneeName = task.assignee ? (task.assignee.name || task.assignee.email) : 'Não atribuído';
  const assigneeInitials = task.assignee ? assigneeName.substring(0, 2).toUpperCase() : '?';
  const commentsCount = task._count && typeof task._count.comments === 'number' ? task._count.comments : 0;

  let parentPillHtml = '';
  if (task.parentKey) {
    const parentTask = STATE.tasks.find(
      t => t.key && t.key.toUpperCase() === String(task.parentKey).trim().toUpperCase()
    );
    const parentLabel = parentTask
      ? `${task.parentKey} · ${parentTask.title}`
      : task.parentKey;
    parentPillHtml = `<div class="card-epic-pill" title="${escapeHtml(parentLabel)}">${ICONS.EPIC.icon}<span>${escapeHtml(parentLabel)}</span></div>`;
  }

  let epicChildrenBadgeHtml = '';
  if (task.type === 'EPIC' && task.key) {
    const childCount = STATE.tasks.filter(
      t => t.parentKey && t.parentKey.toUpperCase() === task.key.toUpperCase()
    ).length;
    if (childCount > 0) {
      epicChildrenBadgeHtml = `<span class="epic-children-count" title="${childCount} sub-item(ns) vinculado(s)">${childCount} sub-itens</span>`;
    }
  }

  let dueBadgeHtml = '';
  if (task.dueDate) {
    const due = new Date(task.dueDate);
    if (!Number.isNaN(due.getTime())) {
      const isOverdue = task.status !== 'DONE' && due < new Date(new Date().toDateString());
      const dueLabel = due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      dueBadgeHtml = `<span class="tag-badge ${isOverdue ? 'tag-overdue' : ''}" title="Data de entrega">${dueLabel}</span>`;
    }
  }

  el.innerHTML = `
    ${parentPillHtml}
    <div class="card-title">${escapeHtml(task.title)}</div>
    ${labelsArr.length > 0 || dueBadgeHtml || epicChildrenBadgeHtml ? `
      <div class="card-tags">
        ${epicChildrenBadgeHtml}
        ${labelsArr.map(l => `<span class="tag-badge">${escapeHtml(l)}</span>`).join('')}
        ${dueBadgeHtml}
      </div>
    ` : ''}
    <div class="card-footer">
      <div class="card-footer-left">
        <span class="type-indicator" title="${escapeHtml(typeInfo.label)}">${typeInfo.icon}</span>
        <span class="card-key">${escapeHtml(task.key || '')}</span>
        <span class="priority-indicator ${escapeHtml(task.priority)}" title="Prioridade: ${escapeHtml(priorityInfo.label)}">${priorityInfo.symbol}</span>
        ${commentsCount > 0 ? `<span class="card-comments-count" title="${commentsCount} comentário(s)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> ${commentsCount}</span>` : ''}
      </div>
      <div class="card-footer-right">
        ${task.storyPoints !== null && task.storyPoints !== undefined ? `
          <span class="story-points-badge" title="Story Points">${task.storyPoints}</span>
        ` : ''}
        <div class="card-avatar" style="background:${escapeHtml(task.assignee ? (task.assignee.avatarColor || '#4F46E5') : '#94A3B8')}" title="${escapeHtml(assigneeName)}">
          ${escapeHtml(assigneeInitials)}
        </div>
      </div>
    </div>
  `;

  return el;
}

/* Epics & Hierarchy View */
function renderEpicsView(tasks) {
  const summaryEl = document.getElementById('epicsSummary');
  const listEl = document.getElementById('epicsHierarchyList');
  if (!summaryEl || !listEl) return;

  const hierarchy = buildEpicHierarchy(tasks);
  const columns = getProjectColumns();
  const colMap = Object.fromEntries(columns.map(c => [c.id, c.title]));

  summaryEl.innerHTML = `
    <div class="epic-stat-card">
      <span class="epic-stat-label">Épicos (Entregas de Valor)</span>
      <strong class="epic-stat-value">${hierarchy.stats.totalEpics}</strong>
    </div>
    <div class="epic-stat-card">
      <span class="epic-stat-label">Sub-itens Vinculados</span>
      <strong class="epic-stat-value">${hierarchy.stats.totalLinked}</strong>
    </div>
    <div class="epic-stat-card">
      <span class="epic-stat-label">Progresso Médio</span>
      <strong class="epic-stat-value">${hierarchy.stats.avgProgress}%</strong>
    </div>
    <div class="epic-stat-card">
      <span class="epic-stat-label">Sem Épico Vinculado</span>
      <strong class="epic-stat-value">${hierarchy.stats.totalUnassigned}</strong>
    </div>
  `;

  listEl.innerHTML = '';

  const renderChildRow = (item, isNested = false) => {
    const typeInfo = ICONS[item.type] || ICONS.TASK;
    const priorityInfo = PRIORITIES[item.priority] || PRIORITIES.MEDIUM;
    const statusLabel = colMap[item.status] || item.status;
    const assigneeName = item.assignee ? (item.assignee.name || item.assignee.email) : 'Não atribuído';
    const assigneeInitials = item.assignee ? assigneeName.substring(0, 2).toUpperCase() : '?';

    const row = document.createElement('div');
    row.className = `hierarchy-child-row ${isNested ? 'hierarchy-child-nested' : ''}`;
    row.addEventListener('click', () => openIssueModal(item));

    row.innerHTML = `
      <div class="hierarchy-child-left">
        <span class="type-indicator" title="${escapeHtml(typeInfo.label)}">${typeInfo.icon}</span>
        <span class="card-key">${escapeHtml(item.key || '-')}</span>
        <span class="hierarchy-child-title">${escapeHtml(item.title)}</span>
      </div>
      <div class="hierarchy-child-right">
        <span class="priority-indicator ${escapeHtml(item.priority)}" title="${escapeHtml(priorityInfo.label)}">${priorityInfo.symbol}</span>
        ${item.storyPoints !== null && item.storyPoints !== undefined ? `<span class="story-points-badge">${item.storyPoints}</span>` : ''}
        <span class="type-pill ${item.status === 'DONE' ? 'pill-done' : ''}">${escapeHtml(statusLabel)}</span>
        <div class="card-avatar" style="background:${escapeHtml(item.assignee ? (item.assignee.avatarColor || '#4F46E5') : '#94A3B8')}" title="${escapeHtml(assigneeName)}">
          ${escapeHtml(assigneeInitials)}
        </div>
      </div>
    `;
    return row;
  };

  if (hierarchy.epics.length === 0 && hierarchy.externalParents.length === 0 && hierarchy.unassigned.length === 0) {
    listEl.innerHTML = '<div class="empty-state-box">Nenhuma issue encontrada com os filtros atuais.</div>';
    return;
  }

  hierarchy.epics.forEach(group => {
    const { epic, children, nestedChildrenMap, totalChildren, doneChildren, progressPct, totalPoints } = group;
    const isCollapsed = STATE.collapsedEpics.has(epic.id);
    const statusLabel = colMap[epic.status] || epic.status;

    const card = document.createElement('div');
    card.className = 'epic-hierarchy-card';

    const header = document.createElement('div');
    header.className = 'epic-hierarchy-header';
    header.innerHTML = `
      <div class="epic-header-left">
        <button type="button" class="epic-toggle-btn" title="Expandir ou recolher sub-itens" aria-expanded="${!isCollapsed}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate(${isCollapsed ? '-90deg' : '0deg'}); transition: transform 0.15s;"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <span class="type-indicator">${ICONS.EPIC.icon}</span>
        <span class="epic-key-chip">${escapeHtml(epic.key || 'EPIC')}</span>
        <span class="epic-hierarchy-title">${escapeHtml(epic.title)}</span>
      </div>
      <div class="epic-header-right">
        <div class="epic-progress-inline" title="${doneChildren} de ${totalChildren} sub-itens concluídos">
          <div class="epic-progress-bar">
            <div class="epic-progress-fill" style="width:${progressPct}%"></div>
          </div>
          <span class="epic-progress-text">${doneChildren}/${totalChildren} (${progressPct}%)</span>
        </div>
        ${totalPoints > 0 ? `<span class="badge-neutral">${totalPoints} pts</span>` : ''}
        <span class="type-pill ${epic.status === 'DONE' ? 'pill-done' : ''}">${escapeHtml(statusLabel)}</span>
        <button type="button" class="btn btn-secondary btn-sm epic-add-child-btn">+ Sub-item</button>
      </div>
    `;

    header.querySelector('.epic-toggle-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (STATE.collapsedEpics.has(epic.id)) STATE.collapsedEpics.delete(epic.id);
      else STATE.collapsedEpics.add(epic.id);
      renderEpicsView(tasks);
    });

    header.querySelector('.epic-hierarchy-title').addEventListener('click', () => openIssueModal(epic));
    header.querySelector('.epic-key-chip').addEventListener('click', () => openIssueModal(epic));

    header.querySelector('.epic-add-child-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!STATE.token) {
        openAuthModal();
        showToast('Faça login para adicionar um sub-item ao épico.');
        return;
      }
      openIssueModal(null, epic.key, 'STORY');
    });

    card.appendChild(header);

    if (!isCollapsed) {
      const body = document.createElement('div');
      body.className = 'epic-hierarchy-body';
      if (children.length === 0) {
        body.innerHTML = '<div class="epic-empty-children">Nenhuma História, Bug ou Tarefa vinculada a este Épico ainda.</div>';
      } else {
        children.forEach(child => {
          body.appendChild(renderChildRow(child, false));
          const subItems = child.key ? (nestedChildrenMap[child.key] || []) : [];
          subItems.forEach(sub => body.appendChild(renderChildRow(sub, true)));
        });
      }
      card.appendChild(body);
    }

    listEl.appendChild(card);
  });

  // External parent groups (e.g. SDD-8885 from another Jira project)
  hierarchy.externalParents.forEach(group => {
    const card = document.createElement('div');
    card.className = 'epic-hierarchy-card epic-external-card';
    card.innerHTML = `
      <div class="epic-hierarchy-header">
        <div class="epic-header-left">
          <span class="type-indicator">${ICONS.EPIC.icon}</span>
          <span class="epic-key-chip">${escapeHtml(group.parentKey)}</span>
          <span class="epic-hierarchy-title">Épico Externo / Referência (${escapeHtml(group.parentKey)})</span>
        </div>
        <div class="epic-header-right">
          <span class="epic-progress-text">${group.doneChildren}/${group.totalChildren} (${group.progressPct}%)</span>
        </div>
      </div>
    `;
    const body = document.createElement('div');
    body.className = 'epic-hierarchy-body';
    group.children.forEach(child => body.appendChild(renderChildRow(child, false)));
    card.appendChild(body);
    listEl.appendChild(card);
  });

  // Unassigned items
  if (hierarchy.unassigned.length > 0) {
    const card = document.createElement('div');
    card.className = 'epic-hierarchy-card epic-unassigned-card';
    card.innerHTML = `
      <div class="epic-hierarchy-header">
        <div class="epic-header-left">
          <span class="epic-hierarchy-title">Itens sem Épico vinculado</span>
          <span class="badge-neutral">${hierarchy.unassigned.length} itens</span>
        </div>
      </div>
    `;
    const body = document.createElement('div');
    body.className = 'epic-hierarchy-body';
    hierarchy.unassigned.forEach(item => body.appendChild(renderChildRow(item, false)));
    card.appendChild(body);
    listEl.appendChild(card);
  }
}

/* Manage Panel Functions */
function updateSelectedIssuesUI() {
  const count = STATE.selectedIssuesForDelete.size;
  const countSpan = document.getElementById('selectedIssuesCount');
  const btnBulk = document.getElementById('btnBulkDeleteIssues');
  const checkAll = document.getElementById('checkSelectAllIssues');

  if (countSpan) countSpan.textContent = count;
  if (btnBulk) btnBulk.disabled = count === 0;

  if (checkAll) {
    checkAll.checked = STATE.tasks.length > 0 && count === STATE.tasks.length;
    checkAll.indeterminate = count > 0 && count < STATE.tasks.length;
  }

  document.querySelectorAll('.check-issue-item').forEach(chk => {
    chk.checked = STATE.selectedIssuesForDelete.has(chk.dataset.id);
  });
}

function renderManagePanel() {
  renderManageProjectsTable();
  renderManageIssuesTable();
}

function renderManageProjectsTable() {
  const tbody = document.getElementById('manageProjectsTableBody');
  const countSpan = document.getElementById('manageProjectsCount');
  if (!tbody) return;

  tbody.innerHTML = '';
  countSpan.textContent = `${STATE.projects.length} projetos`;

  if (STATE.projects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#8993a4; padding:20px;">Nenhum projeto encontrado.</td></tr>`;
    return;
  }

  STATE.projects.forEach(p => {
    const tr = document.createElement('tr');
    const isCurrent = STATE.currentProject && STATE.currentProject.id === p.id;
    const taskCount = p.stats ? p.stats.totalTasks : (p.tasks ? p.tasks.length : 0);
    const completionRate = p.stats ? p.stats.completionRate : 0;
    const ownerName = p.owner ? (p.owner.name || p.owner.email) : 'Desconhecido';

    tr.innerHTML = `
      <td><strong>${escapeHtml(p.key)}</strong></td>
      <td>
        <span style="font-weight:600; color:var(--jira-text-main);">${escapeHtml(p.name)}</span>
        ${isCurrent ? '<span class="badge-neutral" style="margin-left:6px; background:#deebff; color:#0052cc;">Ativo</span>' : ''}
      </td>
      <td>${taskCount} issues</td>
      <td>
        <div style="display:flex; align-items:center; gap:6px;">
          <div style="flex:1; height:6px; background:#ebecf0; border-radius:3px; max-width:60px;">
            <div style="width:${completionRate}%; height:100%; background:#36b37e; border-radius:3px;"></div>
          </div>
          <span style="font-size:11px;">${completionRate}%</span>
        </div>
      </td>
      <td>${escapeHtml(ownerName)}</td>
      <td style="text-align:right;">
        <button class="btn btn-danger btn-sm btn-delete-project-row" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" data-tasks="${taskCount}">
          🗑️ Apagar Projeto
        </button>
      </td>
    `;

    tr.querySelector('.btn-delete-project-row').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!STATE.token) {
        openAuthModal();
        return;
      }
      const projId = e.currentTarget.dataset.id;
      const projName = e.currentTarget.dataset.name;
      const tasks = e.currentTarget.dataset.tasks;

      if (!confirm(`TEM CERTEZA ABSOLUTA?\n\nExcluir o projeto "${projName}" irá apagar definitivamente todas as suas ${tasks} issues e comentários vinculados!`)) {
        return;
      }

      try {
        await api(`/api/projects/${projId}`, { method: 'DELETE' });
        showToast(`Projeto "${projName}" e suas issues foram excluídos!`);
        await loadProjects();
        renderManagePanel();
      } catch (err) {
        showToast('Erro ao excluir projeto: ' + err.message);
      }
    });

    tbody.appendChild(tr);
  });
}

function renderManageIssuesTable() {
  const tbody = document.getElementById('manageIssuesTableBody');
  const titleEl = document.getElementById('manageIssuesSectionTitle');
  const badgeEl = document.getElementById('manageIssuesProjectBadge');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!STATE.currentProject) {
    titleEl.textContent = 'Issues do Projeto';
    badgeEl.textContent = '-';
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#8993a4; padding:20px;">Nenhum projeto ativo selecionado.</td></tr>`;
    updateSelectedIssuesUI();
    return;
  }

  titleEl.textContent = `Issues de "${STATE.currentProject.name}"`;
  badgeEl.textContent = STATE.currentProject.key;

  if (STATE.tasks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#8993a4; padding:20px;">Nenhuma issue cadastrada neste projeto.</td></tr>`;
    updateSelectedIssuesUI();
    return;
  }

  const columns = getProjectColumns();
  const colMap = Object.fromEntries(columns.map(c => [c.id, c.title]));

  STATE.tasks.forEach(task => {
    const tr = document.createElement('tr');
    const typeInfo = ICONS[task.type] || ICONS.TASK;
    const priorityInfo = PRIORITIES[task.priority] || PRIORITIES.MEDIUM;
    const statusLabel = colMap[task.status] || task.status;
    const assigneeName = task.assignee ? (task.assignee.name || task.assignee.email) : 'Não atribuído';

    tr.innerHTML = `
      <td>
        <input type="checkbox" class="check-issue-item" data-id="${escapeHtml(task.id)}" />
      </td>
      <td><span title="${escapeHtml(typeInfo.label)}">${typeInfo.icon}</span></td>
      <td><strong>${escapeHtml(task.key || '-')}</strong></td>
      <td><span style="font-weight:500;">${escapeHtml(task.title)}</span></td>
      <td><span class="type-pill">${escapeHtml(statusLabel)}</span></td>
      <td><span class="priority-indicator ${escapeHtml(task.priority)}">${priorityInfo.symbol} ${escapeHtml(priorityInfo.label)}</span></td>
      <td>${escapeHtml(assigneeName)}</td>
      <td style="text-align:right;">
        <button class="btn btn-ghost btn-sm btn-delete-single-issue" data-id="${escapeHtml(task.id)}" style="color:#de350b;" title="Excluir esta issue">
          ✕
        </button>
      </td>
    `;

    const chk = tr.querySelector('.check-issue-item');
    chk.addEventListener('change', (e) => {
      if (e.target.checked) {
        STATE.selectedIssuesForDelete.add(task.id);
      } else {
        STATE.selectedIssuesForDelete.delete(task.id);
      }
      updateSelectedIssuesUI();
    });

    tr.querySelector('.btn-delete-single-issue').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!STATE.token) {
        openAuthModal();
        return;
      }
      if (!confirm(`Deseja excluir a issue ${task.key || task.title}?`)) return;

      try {
        await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
        STATE.selectedIssuesForDelete.delete(task.id);
        showToast('Issue excluída com sucesso.');
        await loadProjects(STATE.currentProject.id);
        renderManagePanel();
      } catch (err) {
        showToast('Erro ao excluir: ' + err.message);
      }
    });

    tbody.appendChild(tr);
  });

  updateSelectedIssuesUI();
}

/* Import CSV Info Checker */
async function checkImportFileInfo() {
  const badge = document.getElementById('importFileStatusBadge');
  const desc = document.getElementById('importFileDesc');
  if (!badge || !desc) return;

  badge.textContent = 'Verificando...';
  badge.className = 'badge-neutral';

  try {
    const info = await api('/api/import/info');
    if (info.available) {
      badge.textContent = 'Disponível';
      badge.className = 'badge-neutral';
      badge.style.background = '#e3fcef';
      badge.style.color = '#006644';
      desc.innerHTML = `
        Arquivo <strong>${escapeHtml(info.fileName)}</strong> encontrado na raiz do projeto com <strong>${escapeHtml(info.sizeFormatted)}</strong>.
      `;
    } else {
      badge.textContent = 'Não Encontrado';
      badge.className = 'badge-neutral';
      badge.style.background = '#ffebe6';
      badge.style.color = '#de350b';
      desc.textContent = info.message || 'O arquivo Jira.csv não foi localizado.';
    }
  } catch (err) {
    badge.textContent = 'Erro ao verificar';
    desc.textContent = 'Não foi possível consultar o backend: ' + err.message;
  }
}

/* Gerenciador de Colunas do Kanban */
function openColumnsModal() {
  renderColumnsManagerList();
  document.getElementById('columnsModal').classList.remove('hidden');
}

function renderColumnsManagerList() {
  const container = document.getElementById('columnsManagerList');
  const cols = getProjectColumns();
  container.innerHTML = '';

  cols.forEach((c, index) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.padding = '8px 12px';
    row.style.background = '#f4f5f7';
    row.style.borderRadius = '3px';

    row.innerHTML = `
      <div>
        <strong>${escapeHtml(c.title)}</strong>
        <span style="font-size:10px; color:#8993a4; margin-left:6px;">(${escapeHtml(c.id)})</span>
      </div>
      <div style="display:flex; gap:4px;">
        <button class="btn-icon" data-action="up" ${index === 0 ? 'disabled style="opacity:0.3"' : ''} title="Mover para esquerda">◀</button>
        <button class="btn-icon" data-action="down" ${index === cols.length - 1 ? 'disabled style="opacity:0.3"' : ''} title="Mover para direita">▶</button>
        <button class="btn-icon" data-action="remove" style="color:#de350b;" title="Remover coluna">✕</button>
      </div>
    `;

    row.querySelector('[data-action="up"]').addEventListener('click', async () => {
      if (index > 0) {
        const next = [...cols];
        const temp = next[index - 1];
        next[index - 1] = next[index];
        next[index] = temp;
        await saveProjectColumns(next);
        renderColumnsManagerList();
        renderFiltered();
      }
    });

    row.querySelector('[data-action="down"]').addEventListener('click', async () => {
      if (index < cols.length - 1) {
        const next = [...cols];
        const temp = next[index + 1];
        next[index + 1] = next[index];
        next[index] = temp;
        await saveProjectColumns(next);
        renderColumnsManagerList();
        renderFiltered();
      }
    });

    row.querySelector('[data-action="remove"]').addEventListener('click', async () => {
      if (cols.length <= 1) {
        showToast('O quadro deve possuir pelo menos uma coluna.');
        return;
      }
      const tasksInCol = STATE.tasks.filter(t => t.status === c.id);
      const next = cols.filter((_, i) => i !== index);
      const fallbackStatus = next[0].id;
      const confirmMsg = tasksInCol.length > 0
        ? `A coluna "${c.title}" possui ${tasksInCol.length} issue(s). Elas serão movidas para "${next[0].title}". Deseja remover?`
        : `Deseja remover a coluna "${c.title}"?`;
      if (!confirm(confirmMsg)) return;

      try {
        if (tasksInCol.length > 0) {
          await Promise.all(
            tasksInCol.map(t =>
              api(`/api/tasks/${t.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: fallbackStatus })
              })
            )
          );
          tasksInCol.forEach(t => { t.status = fallbackStatus; });
        }
        await saveProjectColumns(next);
        renderColumnsManagerList();
        renderFiltered();
        showToast(`Coluna "${c.title}" removida.`);
      } catch (err) {
        showToast('Erro ao remover coluna: ' + err.message);
      }
    });

    container.appendChild(row);
  });
}

async function saveProjectColumns(cols) {
  if (!STATE.currentProject) return;
  STATE.currentProject.columns = cols;
  renderIssueStatusOptions();
  await api(`/api/projects/${STATE.currentProject.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ columns: cols })
  });
}

/* Backlog Table View */
function renderBacklog(tasks) {
  const tbody = document.getElementById('backlogTableBody');
  tbody.innerHTML = '';
  document.getElementById('backlogCount').textContent = `${tasks.length} itens`;

  if (tasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 32px; color: var(--jira-text-sub);">
          Nenhuma issue encontrada com os filtros atuais.
        </td>
      </tr>
    `;
    return;
  }

  const columns = getProjectColumns();
  const colMap = Object.fromEntries(columns.map(c => [c.id, c.title]));

  tasks.forEach(task => {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => openIssueModal(task));

    const typeInfo = ICONS[task.type] || ICONS.TASK;
    const priorityInfo = PRIORITIES[task.priority] || PRIORITIES.MEDIUM;
    const assigneeName = task.assignee ? (task.assignee.name || task.assignee.email) : '-';
    const statusLabel = colMap[task.status] || task.status;
    const parentBadge = task.parentKey
      ? `<span class="backlog-epic-tag">${escapeHtml(task.parentKey)}</span>`
      : '';

    tr.innerHTML = `
      <td><span title="${escapeHtml(typeInfo.label)}">${typeInfo.icon}</span></td>
      <td><strong class="mono-key">${escapeHtml(task.key || '-')}</strong></td>
      <td><div class="backlog-title-cell"><span>${escapeHtml(task.title)}</span>${parentBadge}</div></td>
      <td><span class="badge-neutral">${escapeHtml(task.sprint || 'Sem sprint')}</span></td>
      <td><span class="priority-indicator ${escapeHtml(task.priority)}">${priorityInfo.symbol} ${escapeHtml(priorityInfo.label)}</span></td>
      <td><strong>${task.storyPoints !== null && task.storyPoints !== undefined ? task.storyPoints : '-'}</strong></td>
      <td>${escapeHtml(assigneeName)}</td>
      <td><span class="type-pill ${task.status === 'DONE' ? 'pill-done' : ''}">${escapeHtml(statusLabel)}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

/* Dashboard View */
async function renderDashboard() {
  const container = document.getElementById('dashboardContent');
  if (!STATE.currentProject) return;

  try {
    const stats = await api(`/api/dashboard/stats?projectId=${STATE.currentProject.id}`);
    const columns = getProjectColumns();

    const byStatus = stats.byStatus || {};
    const byPriority = stats.byPriority || {};
    const byType = stats.byType || {};
    const recentComments = stats.recentComments || [];
    const total = stats.totalTasks || 0;

    container.innerHTML = `
      <div class="dash-card">
        <div class="dash-card-header">Taxa de Conclusão</div>
        <div class="dash-metric-big">${stats.completionRate}%</div>
        <div class="dash-metric-sub">${byStatus.DONE || 0} de ${total} tarefas finalizadas</div>
      </div>

      <div class="dash-card">
        <div class="dash-card-header">Story Points da Sprint</div>
        <div class="dash-metric-big">${stats.storyPoints.completed} / ${stats.storyPoints.total}</div>
        <div class="dash-metric-sub">Velocidade e esforço entregue</div>
      </div>

      <div class="dash-card">
        <div class="dash-card-header">Por Prioridade</div>
        <div class="stat-bars">
          ${Object.entries(PRIORITIES).map(([k, info]) => {
            const count = byPriority[k] || 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return `
              <div class="stat-bar-row">
                <div style="display:flex; justify-content:space-between;">
                  <span>${info.symbol} ${escapeHtml(info.label)}</span>
                  <strong>${count} (${pct}%)</strong>
                </div>
                <div class="stat-bar-track">
                  <div class="stat-bar-fill" style="width: ${pct}%; background: var(--jira-primary);"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="dash-card">
        <div class="dash-card-header">Por Tipo de Issue</div>
        <div class="stat-bars">
          ${Object.entries(ICONS).map(([k, info]) => {
            const count = byType[k] || 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return `
              <div class="stat-bar-row">
                <div style="display:flex; justify-content:space-between;">
                  <span>${info.icon} ${escapeHtml(info.label)}</span>
                  <strong>${count} (${pct}%)</strong>
                </div>
                <div class="stat-bar-track">
                  <div class="stat-bar-fill" style="width: ${pct}%; background: #6554c0;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="dash-card" style="grid-column: span 2;">
        <div class="dash-card-header">Distribuição por Colunas (Kanban)</div>
        <div class="stat-bars">
          ${columns.map(col => {
            const count = STATE.tasks.filter(t => t.status === col.id).length;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return `
              <div class="stat-bar-row">
                <div style="display:flex; justify-content:space-between;">
                  <span>${escapeHtml(col.title)}</span>
                  <strong>${count} (${pct}%)</strong>
                </div>
                <div class="stat-bar-track">
                  <div class="stat-bar-fill" style="width: ${pct}%; background: var(--jira-primary);"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="dash-card" style="grid-column: span 2;">
        <div class="dash-card-header">Comentários Recentes</div>
        ${recentComments.length === 0
          ? '<p style="font-size:13px; color:var(--jira-text-sub);">Nenhum comentário recente neste projeto.</p>'
          : `<div style="display:flex; flex-direction:column; gap:10px;">
              ${recentComments.map(c => {
                const authorName = c.author ? c.author.name : 'Usuário';
                const taskKey = c.task ? c.task.key : '';
                return `
                  <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 10px; background:#f4f5f7; border-radius:4px;">
                    <div>
                      <strong>${escapeHtml(authorName)}</strong>
                      <span style="color:var(--jira-text-sub); font-size:12px;"> em ${escapeHtml(taskKey)}</span>:
                      <span>${escapeHtml(c.content)}</span>
                    </div>
                    <span style="font-size:11px; color:var(--jira-text-muted); white-space:nowrap;">
                      ${new Date(c.createdAt).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                `;
              }).join('')}
            </div>`
        }
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="padding:20px; color:#de350b;">Falha ao carregar métricas: ${escapeHtml(err.message)}</p>`;
  }
}

/* Issue Modal & Comments */
async function openIssueModal(task = null, prefillParentKey = null, prefillType = null) {
  const modal = document.getElementById('issueModal');
  const form = document.getElementById('issueForm');
  form.reset();

  renderIssueStatusOptions();

  const commentsSection = document.getElementById('commentsSection');
  const btnDelete = document.getElementById('btnDeleteIssue');
  const parentLinkBox = document.getElementById('issueParentLinkBox');
  const childrenSection = document.getElementById('issueChildrenSection');
  const childrenList = document.getElementById('issueChildrenList');
  const childrenProgress = document.getElementById('issueChildrenProgress');
  const btnAddChild = document.getElementById('btnAddChildToEpic');

  if (parentLinkBox) {
    parentLinkBox.classList.add('hidden');
    parentLinkBox.innerHTML = '';
  }
  if (childrenSection) childrenSection.classList.add('hidden');

  if (task) {
    document.getElementById('issueId').value = task.id;
    document.getElementById('modalIssueKey').textContent = task.key || 'DETALHES DA ISSUE';
    document.getElementById('modalIssueTypeBadge').textContent = task.type;
    document.getElementById('issueTitle').value = task.title;
    document.getElementById('issueDescription').value = task.description || '';
    document.getElementById('issueLabels').value = task.labels || '';
    const statusSelect = document.getElementById('issueStatus');
    const hasStatus = Array.from(statusSelect.options).some(o => o.value === task.status);
    if (!hasStatus && task.status) {
      const opt = document.createElement('option');
      opt.value = task.status;
      opt.textContent = task.status;
      statusSelect.appendChild(opt);
    }
    statusSelect.value = task.status;
    document.getElementById('issueType').value = task.type;
    document.getElementById('issuePriority').value = task.priority;
    document.getElementById('issueAssignee').value = task.assigneeId || '';
    document.getElementById('issuePoints').value =
      task.storyPoints !== null && task.storyPoints !== undefined ? task.storyPoints : '';
    document.getElementById('issueSprint').value = task.sprint || '';
    document.getElementById('issueDueDate').value = task.dueDate
      ? new Date(task.dueDate).toISOString().split('T')[0]
      : '';
    document.getElementById('issueEnvironment').value = task.environment || '';
    document.getElementById('issueComponents').value = task.components || '';
    renderParentKeySelect(task.parentKey || '', task.key || '');
    document.getElementById('issueResolution').value = task.resolution || '';

    if (task.parentKey && parentLinkBox) {
      const parentTask = STATE.tasks.find(
        t => t.key && t.key.toUpperCase() === String(task.parentKey).trim().toUpperCase()
      );
      if (parentTask) {
        parentLinkBox.classList.remove('hidden');
        parentLinkBox.innerHTML = `
          <button type="button" class="parent-jump-btn">
            ${ICONS.EPIC.icon}
            <span>Ir para ${escapeHtml(parentTask.key)}: ${escapeHtml(parentTask.title)}</span>
          </button>
        `;
        parentLinkBox.querySelector('.parent-jump-btn').addEventListener('click', () => {
          openIssueModal(parentTask);
        });
      }
    }

    const linkedChildren = task.key
      ? STATE.tasks.filter(t => t.parentKey && t.parentKey.toUpperCase() === task.key.toUpperCase())
      : [];
    if (childrenSection && (task.type === 'EPIC' || linkedChildren.length > 0)) {
      childrenSection.classList.remove('hidden');
      const doneCount = linkedChildren.filter(c => c.status === 'DONE').length;
      const pct = linkedChildren.length > 0 ? Math.round((doneCount / linkedChildren.length) * 100) : 0;
      if (childrenProgress) {
        childrenProgress.innerHTML = `
          <div class="epic-progress-bar"><div class="epic-progress-fill" style="width:${pct}%"></div></div>
          <span class="epic-progress-text">${doneCount} de ${linkedChildren.length} concluídos (${pct}%)</span>
        `;
      }
      if (childrenList) {
        childrenList.innerHTML = '';
        if (linkedChildren.length === 0) {
          childrenList.innerHTML = '<div class="epic-empty-children">Nenhum sub-item vinculado ainda.</div>';
        } else {
          linkedChildren.forEach(child => {
            const typeInfo = ICONS[child.type] || ICONS.TASK;
            const row = document.createElement('div');
            row.className = 'modal-child-row';
            row.innerHTML = `
              <span class="type-indicator">${typeInfo.icon}</span>
              <span class="card-key">${escapeHtml(child.key || '-')}</span>
              <span class="modal-child-title">${escapeHtml(child.title)}</span>
              <span class="type-pill ${child.status === 'DONE' ? 'pill-done' : ''}">${escapeHtml(child.status)}</span>
            `;
            row.addEventListener('click', () => openIssueModal(child));
            childrenList.appendChild(row);
          });
        }
      }
      if (btnAddChild) {
        btnAddChild.onclick = () => {
          if (!STATE.token) {
            openAuthModal();
            showToast('Faça login para adicionar um sub-item.');
            return;
          }
          openIssueModal(null, task.key, 'STORY');
        };
      }
    }

    commentsSection.classList.remove('hidden');
    btnDelete.classList.remove('hidden');
    await loadComments(task.id);
  } else {
    const initialType = prefillType || 'TASK';
    document.getElementById('issueId').value = '';
    document.getElementById('modalIssueKey').textContent = initialType === 'EPIC' ? 'NOVO ÉPICO' : 'NOVA ISSUE';
    document.getElementById('modalIssueTypeBadge').textContent = initialType;
    const firstCol = getProjectColumns()[0];
    document.getElementById('issueStatus').value = firstCol ? firstCol.id : 'TODO';
    document.getElementById('issueType').value = initialType;
    document.getElementById('issuePriority').value = 'MEDIUM';
    document.getElementById('issueDueDate').value = '';
    document.getElementById('issueEnvironment').value = '';
    document.getElementById('issueComponents').value = '';
    renderParentKeySelect(prefillParentKey || '', '');
    document.getElementById('issueResolution').value = '';
    commentsSection.classList.add('hidden');
    btnDelete.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

async function loadComments(taskId) {
  const container = document.getElementById('commentsList');
  container.innerHTML = '<span style="font-size:12px; color:#8993a4;">Carregando comentários...</span>';
  try {
    const comments = await api(`/api/tasks/${taskId}/comments`);
    if (comments.length === 0) {
      container.innerHTML = '<span style="font-size:12px; color:#8993a4;">Nenhum comentário ainda.</span>';
      return;
    }
    container.innerHTML = comments.map(c => {
      const author = c.author ? (c.author.name || c.author.email) : 'Usuário';
      const initials = author.substring(0, 2).toUpperCase();
      const dateStr = new Date(c.createdAt).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const canDelete = STATE.user && c.authorId === STATE.user.id;
      return `
        <div class="comment-item">
          <div class="card-avatar" style="background:${escapeHtml(c.author ? c.author.avatarColor || '#0052cc' : '#8993a4')}">${escapeHtml(initials)}</div>
          <div class="comment-body" style="flex:1;">
            <div class="comment-header">
              <span class="comment-author">${escapeHtml(author)}</span>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="comment-date">${dateStr}</span>
                ${canDelete ? `<button type="button" class="btn-icon btn-delete-comment" data-comment-id="${escapeHtml(c.id)}" title="Excluir comentário" style="color:#de350b; font-size:12px;">✕</button>` : ''}
              </div>
            </div>
            <div class="comment-text">${formatRichComment(c.content)}</div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-delete-comment').forEach(btn => {
      btn.addEventListener('click', async () => {
        const commentId = btn.dataset.commentId;
        if (!confirm('Deseja excluir este comentário?')) return;
        try {
          await api(`/api/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' });
          await loadComments(taskId);
          await loadTasks();
          showToast('Comentário removido.');
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<span style="color:#de350b;">Erro ao carregar comentários.</span>`;
  }
}

function formatRichComment(str) {
  if (!str) return '';
  let escaped = escapeHtml(str);

  // Extract fenced code blocks first so inner newlines/markdown stay untouched
  const codeBlocks = [];
  escaped = escaped.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="comment-code-block"><code>${code.trim()}</code></pre>`);
    return `__CODE_BLOCK_${idx}__`;
  });

  // Inline code
  escaped = escaped.replace(/`([^`\n]+)`/g, '<code class="comment-inline-code">$1</code>');

  // Bold
  escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // Safe images (http/https/relative/data:image base64)
  escaped = escaped.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, rawUrl) => {
    const url = rawUrl.trim();
    const isSafe =
      /^https?:\/\//i.test(url) ||
      url.startsWith('/') ||
      /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(url);
    if (!isSafe) return alt || '[imagem bloqueada]';
    return `<img class="comment-image" src="${url}" alt="${alt || 'Imagem'}" loading="lazy" />`;
  });

  escaped = escaped.replace(/\n/g, '<br>');

  codeBlocks.forEach((html, idx) => {
    escaped = escaped.replace(`__CODE_BLOCK_${idx}__`, html);
  });

  return escaped;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', init);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATE,
    DEFAULT_COLUMNS,
    ICONS,
    PRIORITIES,
    getProjectColumns,
    buildEpicHierarchy,
    escapeHtml,
    formatRichComment,
    renderFiltered,
    renderKanban,
    renderEpicsView,
    renderBacklog,
    renderAvatarFilters,
    createCardElement,
    setAuth,
    logout,
  };
}
