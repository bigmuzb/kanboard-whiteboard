// Kanboard Whiteboard — Application Logic
// Talks to Kanboard JSON-RPC API via /api proxy

// ===== STATE =====
const state = {
  projects: [],
  currentProjectId: null,
  board: [],           // processed columns with tasks
  users: [],           // [{id, name}] for current project
  tasks: new Map(),    // taskId -> task object
  editingTaskId: null,
  refreshTimer: null,
  panelOpen: false,
  authUser: null,
};

// ===== BACK BUTTON STATE =====
let historyPanelPushed = false;
let addFormColumnId = null;
let addFormHistoryPushed = false;

// ===== PERSON COLOURS =====
const PERSON_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#e11d48', // rose
  '#6366f1', // indigo
];

function getUserColor(userId) {
  if (!userId || userId === '0' || userId == 0) return '#64748b';
  const idx = (parseInt(userId) - 1) % PERSON_COLORS.length;
  return PERSON_COLORS[Math.abs(idx)];
}

// ===== COLUMN HEADER COLOURS =====
const COLUMN_COLORS = ['#64748b', '#3b82f6', '#f59e0b', '#22c55e', '#8b5cf6', '#ec4899'];

// ===== API =====
let rpcId = 0;

async function api(method, params = {}) {
  rpcId++;
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, id: rpcId, params }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'API error');
  return data.result;
}

// ===== PROJECTS =====
async function loadProjects() {
  if (!state.authUser) {
    try {
      const res = await fetch('/auth/me');
      if (res.ok) state.authUser = await res.json();
    } catch (e) {
      console.warn('Could not load auth user', e);
    }
  }

  const projects = await api('getAllProjects');
  // projects is an array of project objects
  let all = Array.isArray(projects) ? projects : [];

  // Filter by authenticated user's allowed projects
  const userId = getCurrentUserId();
  if (userId) {
    try {
      const res = await fetch('/allowed-projects');
      if (res.ok) {
        const data = await res.json();
        if (data.projectIds && Array.isArray(data.projectIds)) {
          all = all.filter(p => data.projectIds.includes(parseInt(p.id)));
        }
      }
    } catch (e) {
      console.warn('Could not fetch allowed projects:', e);
    }
  }

  state.projects = all;
  renderProjectTabs();

  if (state.projects.length > 0) {
    // Select first active project
    const active = state.projects.find(p => p.is_active == 1) || state.projects[0];
    await selectProject(parseInt(active.id));
  }
}

function renderProjectTabs() {
  const container = document.getElementById('project-tabs');
  container.innerHTML = state.projects
    .filter(p => p.is_active == 1)
    .map(p => `
      <button class="project-tab px-4 py-1.5 rounded-full text-sm font-medium border
        ${state.currentProjectId == p.id
          ? 'bg-blue-600 border-blue-500 text-white'
          : 'bg-kw-card border-kw-border text-kw-muted hover:text-kw-text hover:border-slate-500'
        }"
        onclick="selectProject(${p.id})">
        ${escapeHtml(p.name)}
      </button>
    `).join('');
}

async function selectProject(projectId) {
  if (state.currentProjectId === projectId && state.board.length > 0) return;
  state.currentProjectId = projectId;
  renderProjectTabs();
  showLoading();
  try {
    await Promise.all([loadBoard(), loadUsers(projectId)]);
    hideLoading();
    renderBoard();
    checkIdentity();
    startRefresh();
  } catch (err) {
    console.error('Failed to load project:', err);
    showError('Failed to load project: ' + err.message);
  }
}

// ===== USERS =====
async function loadUsers(projectId) {
  const result = await api('getProjectUsers', { project_id: projectId });
  // result is {id: username} object
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    state.users = Object.entries(result).map(([id, name]) => ({
      id: parseInt(id),
      name: name,
    }));
  } else {
    state.users = [];
  }
}

// ===== BOARD =====
async function loadBoard() {
  const boardData = await api('getBoard', { project_id: state.currentProjectId });
  state.board = processBoard(boardData);
}

function processBoard(boardData) {
  // boardData is array of swimlanes, each with columns, each with tasks
  // Merge all swimlanes into flat columns
  const columnMap = {};

  if (!Array.isArray(boardData)) return [];

  for (const swimlane of boardData) {
    if (!swimlane.columns) continue;
    for (const col of swimlane.columns) {
      const colId = parseInt(col.id);
      if (!columnMap[colId]) {
        columnMap[colId] = {
          id: colId,
          title: col.title,
          position: parseInt(col.position),
          tasks: [],
        };
      }
      if (Array.isArray(col.tasks)) {
        columnMap[colId].tasks.push(...col.tasks);
      }
    }
  }

  // Sort columns by position
  const columns = Object.values(columnMap).sort((a, b) => a.position - b.position);

  // Build task lookup and sort tasks by position within each column
  state.tasks.clear();
  for (const col of columns) {
    col.tasks.sort((a, b) => parseInt(a.position) - parseInt(b.position));
    col.tasks.forEach(t => state.tasks.set(parseInt(t.id), t));
  }

  return columns;
}

// ===== MOBILE COLUMN MANAGEMENT =====
const MOBILE_BREAKPOINT = 768;

function isMobile() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function getMobileColumnOrder(title) {
  const t = title.toUpperCase();
  if (t.includes('PROGRESS') || t.includes('WORKING')) return 0;
  if (t.includes('READY')) return 1;
  if (t.includes('PENDING') || t.includes('BACKLOG')) return 2;
  if (t.includes('COMPLETED') || t.includes('DONE')) return 3;
  return 4;
}

function isDefaultCollapsed(title) {
  const t = title.toUpperCase();
  return t.includes('PENDING') || t.includes('BACKLOG') || t.includes('COMPLETED') || t.includes('DONE');
}

function getCollapseState() {
  try { return JSON.parse(localStorage.getItem('kw-column-collapse') || '{}'); }
  catch { return {}; }
}

function isColumnCollapsed(column) {
  // Collapse works on all screen sizes
  const saved = getCollapseState();
  if (saved.hasOwnProperty(column.id)) return saved[column.id];
  return isDefaultCollapsed(column.title);
}

function toggleColumn(columnId) {
  // Don't toggle when dragging a task onto a collapsed column
  if (_isDragging) return;
  // Toggle works on all screen sizes
  const column = state.board.find(c => c.id === columnId);
  if (!column) return;
  const collapsed = isColumnCollapsed(column);
  const saved = getCollapseState();
  saved[columnId] = !collapsed;
  localStorage.setItem('kw-column-collapse', JSON.stringify(saved));
  renderBoard();
  savePrefsToServer();
}

function renderBoard() {
  renderFilterBar();
  updateIdentityLabel();
  const container = document.getElementById('columns');
  let columns = [...state.board];

  if (isMobile()) {
    columns.sort((a, b) => getMobileColumnOrder(a.title) - getMobileColumnOrder(b.title));
  }

  container.innerHTML = columns.map(col => {
    const origIndex = state.board.indexOf(col);
    return renderColumn(col, origIndex);
  }).join('');
  initSortable();
}

function renderColumn(column, index) {
  const colorAccent = COLUMN_COLORS[index % COLUMN_COLORS.length];
  const filteredTasks = getFilteredTasks(column.tasks);
  const taskCount = filteredTasks.length;
  const mobile = isMobile();
  const collapsed = isColumnCollapsed(column);
  const isCompletedCol = column.title.toUpperCase().includes('COMPLETED') || column.title.toUpperCase().includes('DONE');
  const cards = filteredTasks.map(t => renderCard(t, isCompletedCol)).join('');

  const chevronHtml = `<span class="text-kw-dim text-xs inline-block transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}">&#9654;</span>`;
  const headerClick = `onclick="toggleColumn(${column.id})"`;
  const headerCursor = 'cursor-pointer select-none';

  // Collapsed columns on desktop: narrow vertical strip. On mobile: full width, just hidden content.
  const isDesktop = !isMobile();
  const collapsedDesktop = collapsed && isDesktop;

  if (collapsedDesktop) {
    // Narrow vertical strip — rotated title, count badge, clickable to expand
    // Includes a hidden .task-list so SortableJS can use it as a drop target
    return `
      <div class="board-column flex flex-col items-center shrink-0" data-column-id="${column.id}"
           style="width: 48px; min-width: 48px; max-width: 48px; cursor: pointer;"
           onclick="toggleColumn(${column.id})">
        <div class="collapsed-drop-zone rounded-lg border border-kw-border bg-kw-header w-full h-full min-h-[200px] flex flex-col items-center py-4 gap-3 hover:border-slate-500 transition-colors relative"
             style="border-top: 3px solid ${colorAccent}" data-column-id="${column.id}">
          <span class="collapsed-count bg-kw-card/80 text-kw-muted text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center border border-kw-border">${taskCount}</span>
          <span class="text-kw-dim text-xs inline-block">&#9654;</span>
          <div class="flex-1 flex items-center">
            <span class="text-kw-dim text-xs font-semibold tracking-widest uppercase whitespace-nowrap"
                  style="writing-mode: vertical-rl; text-orientation: mixed;">${escapeHtml(column.title)}</span>
          </div>
          <div class="task-list collapsed-task-list absolute inset-0 opacity-0" data-column-id="${column.id}"
               style="min-height: 100%;"></div>
        </div>
      </div>
    `;
  }

  return `
    <div class="board-column flex flex-col flex-1 min-w-0" data-column-id="${column.id}">
      <div class="${collapsed ? 'rounded-lg' : 'rounded-t-lg'} px-4 py-3 border border-kw-border bg-kw-header ${headerCursor}"
           style="border-top: 3px solid ${colorAccent}"
           ${headerClick}>
        <div class="flex justify-between items-center">
          <h2 class="font-semibold text-[15px] tracking-wide uppercase">${escapeHtml(column.title)}</h2>
          <div class="flex items-center gap-2">
            <span class="task-count text-kw-dim text-sm font-medium">${taskCount}</span>
            ${chevronHtml}
          </div>
        </div>
      </div>
      ${!collapsed ? `
      ${CONFIG.DEMO_MODE ? `
      <div class="border-x border-kw-border text-center text-xs text-kw-dim py-2">Public demo: drag cards between columns. Edits reset hourly.</div>
      ` : `
      <div class="column-add-top border-x border-kw-border" data-column-id="${column.id}">
        <button class="add-task-btn w-full text-kw-dim hover:text-kw-text hover:bg-kw-card/50 py-2 text-sm transition-colors"
                onclick="showAddForm(${column.id})">
          + Add Task
        </button>
      </div>
      `}
      <div class="task-list flex-1 space-y-3 p-3 border-x border-kw-border bg-kw-bg/50"
           data-column-id="${column.id}">
        ${cards}
      </div>
      <div class="column-footer border border-t-0 border-kw-border rounded-b-lg" data-column-id="${column.id}"></div>` : ''}
    </div>
  `;
}

// ===== TASK COLOUR FROM KANBOARD =====
// All 16 standard Kanboard colours mapped for both themes.
// Dark mode: deep muted backgrounds, medium borders, bright accents.
// Light mode: subtle pastel backgrounds, strong accents.
const TASK_COLORS_DARK = {
  yellow:      { bg: '#292713', border: '#b8a924', accent: '#dfe32d' },
  blue:        { bg: '#101e33', border: '#3b82f6', accent: '#60a5fa' },
  green:       { bg: '#0f2416', border: '#22c55e', accent: '#4ade80' },
  purple:      { bg: '#1f1230', border: '#a855f7', accent: '#c084fc' },
  red:         { bg: '#2a1212', border: '#ef4444', accent: '#f87171' },
  orange:      { bg: '#291b0e', border: '#f59e0b', accent: '#fbbf24' },
  grey:        { bg: '#1a1a1a', border: '#6b7280', accent: '#9ca3af' },
  dark_grey:   { bg: '#161b20', border: '#455a64', accent: '#78909c' },
  teal:        { bg: '#0a2421', border: '#0d9488', accent: '#2dd4bf' },
  brown:       { bg: '#221a16', border: '#8d6e63', accent: '#a1887f' },
  deep_orange: { bg: '#2a1510', border: '#e64a19', accent: '#ff7043' },
  pink:        { bg: '#2a1020', border: '#d81b60', accent: '#f06292' },
  cyan:        { bg: '#0a2429', border: '#00bcd4', accent: '#4dd0e1' },
  lime:        { bg: '#1f2410', border: '#afb42b', accent: '#cddc39' },
  light_green: { bg: '#152210', border: '#689f38', accent: '#8bc34a' },
  amber:       { bg: '#292010', border: '#ffa000', accent: '#ffca28' },
};

const TASK_COLORS_LIGHT = {
  yellow:      { bg: '#fefce8', border: '#eab308', accent: '#ca8a04' },
  blue:        { bg: '#eff6ff', border: '#3b82f6', accent: '#2563eb' },
  green:       { bg: '#f0fdf4', border: '#22c55e', accent: '#16a34a' },
  purple:      { bg: '#faf5ff', border: '#a855f7', accent: '#9333ea' },
  red:         { bg: '#fef2f2', border: '#ef4444', accent: '#dc2626' },
  orange:      { bg: '#fff7ed', border: '#f59e0b', accent: '#d97706' },
  grey:        { bg: '#f9fafb', border: '#d1d5db', accent: '#6b7280' },
  dark_grey:   { bg: '#f1f5f9', border: '#94a3b8', accent: '#475569' },
  teal:        { bg: '#f0fdfa', border: '#14b8a6', accent: '#0d9488' },
  brown:       { bg: '#faf6f4', border: '#8d6e63', accent: '#5d4037' },
  deep_orange: { bg: '#fff3e0', border: '#e64a19', accent: '#bf360c' },
  pink:        { bg: '#fce4ec', border: '#d81b60', accent: '#ad1457' },
  cyan:        { bg: '#e0f7fa', border: '#00bcd4', accent: '#00838f' },
  lime:        { bg: '#f9fbe7', border: '#afb42b', accent: '#9e9d24' },
  light_green: { bg: '#f1f8e9', border: '#689f38', accent: '#558b2f' },
  amber:       { bg: '#fff8e1', border: '#ffa000', accent: '#ff8f00' },
};

// Map custom Kanboard colour IDs to standard ones
const COLOR_ALIASES = {
  white_on_blue_grey: 'teal',
  dark_green_on_lime_green: 'light_green',
  white_on_deep_green: 'green',
};

function getTaskColor(task) {
  let colorId = task.color_id || 'yellow';
  colorId = COLOR_ALIASES[colorId] || colorId;
  const palette = getTheme() === 'dark' ? TASK_COLORS_DARK : TASK_COLORS_LIGHT;
  return palette[colorId] || palette['yellow'];
}

function renderCard(task, isCompletedCol = false) {
  const ownerId = parseInt(task.owner_id) || 0;
  const personColor = getUserColor(ownerId);
  const taskColor = getTaskColor(task);
  const assignee = getAssigneeName(task);
  const dateDue = task.date_due && task.date_due !== '0' ? task.date_due : null;
  const overdue = !isCompletedCol && isOverdue(dateDue);
  const priority = parseInt(task.priority) || 0;

  let priorityBadge = '';
  if (priority >= 2) {
    priorityBadge = '<span class="text-[11px] font-semibold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">HIGH</span>';
  }

  const overdueClass = overdue ? 'task-overdue' : '';

  return `
    <div class="task-card ${overdueClass} rounded-lg p-4"
         style="background: ${taskColor.bg}; border: 1px solid ${overdue ? '#ef4444' : taskColor.border}; border-left: 4px solid ${taskColor.accent};"
         data-task-id="${task.id}"
         onclick="openTaskPanel(${task.id})">
      <p class="text-[15px] font-medium leading-snug mb-2">${escapeHtml(task.title)}</p>
      <div class="flex items-center justify-between gap-2 text-sm">
        <span style="color: ${personColor}; font-weight: 500;" class="truncate">${assignee ? escapeHtml(assignee) : '<span class="text-kw-dim italic">Unassigned</span>'}</span>
        <div class="flex items-center gap-2 flex-shrink-0">
          ${priorityBadge}
          ${overdue ? '<span class="text-[11px] font-bold text-red-400 bg-red-400/15 px-1.5 py-0.5 rounded">OVERDUE</span>' : ''}
          ${dateDue ? `<span class="${overdue ? 'text-red-400 font-medium' : 'text-kw-dim'}">${formatDateShort(dateDue)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function getAssigneeName(task) {
  if (task.assignee_name && task.assignee_name.trim()) return task.assignee_name;
  if (task.assignee_username && task.assignee_username.trim()) return task.assignee_username;
  if (task.owner_id && task.owner_id !== '0') {
    const user = state.users.find(u => u.id === parseInt(task.owner_id));
    return user ? user.name : null;
  }
  return null;
}

// ===== DRAG & DROP =====
let _isDragging = false;

function initSortable() {
  document.querySelectorAll('.task-list').forEach(list => {
    new Sortable(list, {
      group: 'tasks',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      delay: 100,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      filter: '.add-task-btn, .column-add-top, .add-form-enter, .column-footer',
      preventOnFilter: false,
      onStart: () => {
        _isDragging = true;
        // Highlight collapsed columns as valid drop targets
        document.querySelectorAll('.collapsed-drop-zone').forEach(el => {
          el.classList.add('drop-target-active');
        });
      },
      onEnd: (evt) => {
        _isDragging = false;
        document.querySelectorAll('.collapsed-drop-zone').forEach(el => {
          el.classList.remove('drop-target-active');
        });
        onTaskMoved(evt);
      },
    });
  });
}

async function onTaskMoved(evt) {
  const taskId = parseInt(evt.item.dataset.taskId);
  const newColumnId = parseInt(evt.to.dataset.columnId);
  const newPosition = evt.newIndex + 1; // Kanboard uses 1-based positions

  updateColumnCounts();

  try {
    const taskData = state.board.flatMap(c => c.tasks).find(t => parseInt(t.id) === taskId);
    const swimlaneId = taskData ? parseInt(taskData.swimlane_id) : 0;
    await api('moveTaskPosition', {
      project_id: state.currentProjectId,
      task_id: taskId,
      column_id: newColumnId,
      position: newPosition,
      swimlane_id: swimlaneId,
    });
    toast('Task moved');
  } catch (err) {
    console.error('Failed to move task:', err);
    toast('Failed to move task', true);
    // Reload board to revert
    await loadBoard();
    renderBoard();
  }
}

function updateColumnCounts() {
  document.querySelectorAll('.board-column').forEach(col => {
    const taskList = col.querySelector('.task-list');
    if (!taskList) return;
    const count = taskList.querySelectorAll('.task-card').length;
    const countEl = col.querySelector('.task-count') || col.querySelector('.collapsed-count');
    if (countEl) countEl.textContent = count;
  });
}

// ===== TASK PANEL =====
async function openTaskPanel(taskId) {
  const task = state.tasks.get(parseInt(taskId));
  if (!task) return;

  state.editingTaskId = parseInt(taskId);
  state.panelOpen = true;

  // Load comments
  let comments = [];
  try {
    comments = await api('getAllComments', { task_id: parseInt(taskId) });
    if (!Array.isArray(comments)) comments = [];
  } catch (e) {
    console.error('Failed to load comments:', e);
  }

  renderPanel(task, comments);

  // Show panel
  document.getElementById('panel-overlay').classList.remove('hidden');
  document.getElementById('task-panel').classList.add('panel-open');

  // Push history state for back button handling
  history.pushState({ panel: 'task' }, '');
  historyPanelPushed = true;
}

function closeTaskPanel() {
  if (!state.panelOpen) return;
  state.editingTaskId = null;
  state.panelOpen = false;
  document.getElementById('panel-overlay').classList.add('hidden');
  document.getElementById('task-panel').classList.remove('panel-open');

  // Clean up history state (only if not triggered by back button)
  if (historyPanelPushed) {
    historyPanelPushed = false;
    history.back();
  }
}

function renderPanel(task, comments) {
  const panel = document.getElementById('task-panel');
  const userOptions = state.users
    .map(u => `<option value="${u.id}" ${u.id == task.owner_id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`)
    .join('');

  const dateDue = task.date_due && task.date_due !== '0' ? task.date_due : '';
  const priority = parseInt(task.priority) || 0;

  const commentHtml = comments.map(c => `
    <div class="bg-kw-card/60 rounded-lg p-3 text-sm">
      <div class="text-kw-dim text-xs mb-1">${escapeHtml(c.name || c.username || 'Unknown')} &mdash; ${formatDateTime(c.date_creation)}</div>
      <div class="text-kw-text whitespace-pre-wrap">${escapeHtml(c.comment || '')}</div>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-lg font-semibold">${CONFIG.DEMO_MODE ? 'Task Details' : 'Edit Task'}</h2>
        <button onclick="closeTaskPanel()" class="text-kw-dim hover:text-kw-text text-2xl leading-none">&times;</button>
      </div>

      <div class="space-y-4">
        <div>
          <label class="block text-sm text-kw-muted mb-1">Task Name</label>
          <input type="text" id="panel-title" value="${escapeAttr(task.title)}" ${CONFIG.DEMO_MODE ? 'readonly' : ''}
            class="w-full bg-kw-card border border-kw-border rounded-lg px-3 py-2 text-kw-text ${CONFIG.DEMO_MODE ? 'opacity-80' : ''}">
        </div>

        <div>
          <label class="block text-sm text-kw-muted mb-1">Assigned To</label>
          <select id="panel-owner" ${CONFIG.DEMO_MODE ? 'disabled' : ''} class="w-full bg-kw-card border border-kw-border rounded-lg px-3 py-2 text-kw-text ${CONFIG.DEMO_MODE ? 'opacity-80' : ''}">
            <option value="0" ${task.owner_id == 0 ? 'selected' : ''}>Unassigned</option>
            ${userOptions}
          </select>
        </div>

        <div>
          <label class="block text-sm text-kw-muted mb-1">Due Date</label>
          <input type="date" id="panel-due" value="${dateDue}" ${CONFIG.DEMO_MODE ? 'disabled' : ''}
            class="w-full bg-kw-card border border-kw-border rounded-lg px-3 py-2 text-kw-text ${CONFIG.DEMO_MODE ? 'opacity-80' : ''}">
        </div>

        <div>
          <label class="block text-sm text-kw-muted mb-1">Priority</label>
          <select id="panel-priority" ${CONFIG.DEMO_MODE ? 'disabled' : ''} class="w-full bg-kw-card border border-kw-border rounded-lg px-3 py-2 text-kw-text ${CONFIG.DEMO_MODE ? 'opacity-80' : ''}">
            <option value="0" ${priority === 0 ? 'selected' : ''}>Low</option>
            <option value="1" ${priority === 1 ? 'selected' : ''}>Normal</option>
            <option value="2" ${priority === 2 ? 'selected' : ''}>High</option>
          </select>
        </div>

        <div>
          <label class="block text-sm text-kw-muted mb-1">Description</label>
          <textarea id="panel-desc" rows="4" ${CONFIG.DEMO_MODE ? 'readonly' : ''}
            class="w-full bg-kw-card border border-kw-border rounded-lg px-3 py-2 text-kw-text resize-y ${CONFIG.DEMO_MODE ? 'opacity-80' : ''}">${escapeHtml(task.description || '')}</textarea>
        </div>

        ${CONFIG.DEMO_MODE ? `
        <div class="rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-200 text-sm p-3">
          Public demo mode: drag cards between columns to try the workflow. Editing, deleting, and commenting are disabled.
        </div>
        ` : `
        <button onclick="saveTask()"
          class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors">
          Save Changes
        </button>

        <hr class="border-kw-border">
        `}

        <div>
          <h3 class="text-sm font-semibold text-kw-muted mb-3">Comments</h3>
          <div id="comments-list" class="space-y-2 mb-3 max-h-[300px] overflow-y-auto">
            ${commentHtml || '<p class="text-kw-dim text-sm italic">No comments yet</p>'}
          </div>
          ${CONFIG.DEMO_MODE ? '' : `
          <div class="flex gap-2">
            <input type="text" id="new-comment" placeholder="Add a comment..."
              class="flex-1 bg-kw-card border border-kw-border rounded-lg px-3 py-2 text-sm text-kw-text"
              onkeydown="if(event.key==='Enter')submitComment()">
            <button onclick="submitComment()"
              class="bg-kw-card border border-kw-border rounded-lg px-4 py-2 text-sm text-kw-muted hover:text-kw-text hover:bg-slate-700 transition-colors">
              Post
            </button>
          </div>
          `}
        </div>

        ${CONFIG.DEMO_MODE ? '' : `
        <hr class="border-kw-border">

        <button id="delete-btn" onclick="confirmDeleteTask()"
          class="w-full border border-red-500/30 text-red-400 hover:bg-red-500/10 py-2 rounded-lg text-sm transition-colors">
          Delete Task
        </button>
        `}
      </div>
    </div>
  `;
}

async function saveTask() {
  if (CONFIG.DEMO_MODE) { toast('Public demo is move-only. Drag cards between columns.', true); return; }
  const taskId = state.editingTaskId;
  if (!taskId) return;

  const title = document.getElementById('panel-title').value.trim();
  if (!title) { toast('Task name is required', true); return; }

  const data = {
    id: taskId,
    title: title,
    owner_id: parseInt(document.getElementById('panel-owner').value),
    date_due: document.getElementById('panel-due').value || '',
    priority: parseInt(document.getElementById('panel-priority').value),
    description: document.getElementById('panel-desc').value,
  };

  try {
    await api('updateTask', data);
    toast('Task saved');
    closeTaskPanel();
    await loadBoard();
    renderBoard();
  } catch (err) {
    console.error('Failed to save task:', err);
    toast('Failed to save: ' + err.message, true);
  }
}

function confirmDeleteTask() {
  if (CONFIG.DEMO_MODE) { toast('Public demo is move-only. Drag cards between columns.', true); return; }
  const btn = document.getElementById('delete-btn');
  btn.textContent = 'Click again to confirm';
  btn.classList.add('bg-red-600/20');
  btn.onclick = deleteTask;
  setTimeout(() => {
    if (btn) {
      btn.textContent = 'Delete Task';
      btn.classList.remove('bg-red-600/20');
      btn.onclick = confirmDeleteTask;
    }
  }, 3000);
}

async function deleteTask() {
  if (CONFIG.DEMO_MODE) { toast('Public demo is move-only. Drag cards between columns.', true); return; }
  const taskId = state.editingTaskId;
  if (!taskId) return;

  try {
    await api('removeTask', { task_id: taskId });
    toast('Task deleted');
    closeTaskPanel();
    await loadBoard();
    renderBoard();
  } catch (err) {
    console.error('Failed to delete task:', err);
    toast('Failed to delete: ' + err.message, true);
  }
}

// ===== COMMENTS =====
async function submitComment() {
  if (CONFIG.DEMO_MODE) { toast('Public demo is move-only. Drag cards between columns.', true); return; }
  const input = document.getElementById('new-comment');
  const content = input.value.trim();
  if (!content || !state.editingTaskId) return;

  try {
    // Get user ID - try multiple sources for reliability
    let commentUserId = getCurrentUserId();
    if (!commentUserId) {
      try {
        const meRes = await fetch('/auth/me');
        if (meRes.ok) {
          const me = await meRes.json();
          commentUserId = me.kanboard_user_id;
          // Cache it for next time
          if (!state.authUser) state.authUser = me;
          setCurrentUser(me.kanboard_user_id, me.name);
        }
      } catch(e) { console.warn('auth/me fetch failed:', e); }
    }
    console.log('submitComment: user_id =', commentUserId);
    const commentParams = { task_id: state.editingTaskId, content: content };
    if (commentUserId) commentParams.user_id = commentUserId;
    await api('createComment', commentParams);
    input.value = '';
    // Reload comments
    const comments = await api('getAllComments', { task_id: state.editingTaskId });
    const listEl = document.getElementById('comments-list');
    if (listEl && Array.isArray(comments)) {
      listEl.innerHTML = comments.map(c => `
        <div class="bg-kw-card/60 rounded-lg p-3 text-sm">
          <div class="text-kw-dim text-xs mb-1">${escapeHtml(c.name || c.username || 'Unknown')} &mdash; ${formatDateTime(c.date_creation)}</div>
          <div class="text-kw-text whitespace-pre-wrap">${escapeHtml(c.comment || '')}</div>
        </div>
      `).join('');
      listEl.scrollTop = listEl.scrollHeight;
    }
    toast('Comment added');
  } catch (err) {
    console.error('Failed to add comment:', err);
    toast('Failed to add comment', true);
  }
}

// ===== ADD TASK =====
function showAddForm(columnId) {
  if (CONFIG.DEMO_MODE) { toast('Public demo is move-only. Drag cards between columns.', true); return; }
  const footer = document.querySelector(`.column-footer[data-column-id="${columnId}"]`);
  if (!footer) return;

  const userOptions = state.users
    .map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`)
    .join('');

  footer.innerHTML = `
    <div class="p-3 space-y-2 add-form-enter" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()">
      <input type="text" id="add-title-${columnId}" placeholder="Task name..."
        class="w-full bg-kw-card border border-kw-border rounded-lg px-3 py-2 text-sm text-kw-text"
        onkeydown="if(event.key==='Enter')submitNewTask(${columnId}); if(event.key==='Escape')hideAddForm(${columnId})">
      <select id="add-owner-${columnId}"
        class="w-full bg-kw-card border border-kw-border rounded-lg px-3 py-2 text-sm text-kw-text">
        <option value="0">Unassigned</option>
        ${userOptions}
      </select>
      <input type="date" id="add-due-${columnId}"
        class="w-full bg-kw-card border border-kw-border rounded-lg px-3 py-2 text-sm text-kw-text">
      <div class="flex gap-2">
        <button onclick="submitNewTask(${columnId})"
          class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">
          Add
        </button>
        <button onclick="hideAddForm(${columnId})"
          class="flex-1 bg-kw-card border border-kw-border hover:bg-slate-700 text-kw-muted py-2 rounded-lg text-sm transition-colors">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.getElementById(`add-title-${columnId}`).focus();

  // Push history state for back button handling
  addFormColumnId = columnId;
  addFormHistoryPushed = true;
  history.pushState({ panel: 'addTask' }, '');
}

function hideAddForm(columnId) {
  const footer = document.querySelector(`.column-footer[data-column-id="${columnId}"]`);
  if (!footer) return;
  footer.innerHTML = `
    <button class="add-task-btn w-full text-kw-dim hover:text-kw-text hover:bg-kw-card/50 py-2.5 text-sm rounded-b-lg transition-colors"
            onclick="showAddForm(${columnId})">
      + Add Task
    </button>
  `;

  // Clean up history state
  const wasHistoryPushed = addFormHistoryPushed;
  addFormColumnId = null;
  addFormHistoryPushed = false;
  if (wasHistoryPushed) {
    history.back();
  }
}

async function submitNewTask(columnId) {
  if (CONFIG.DEMO_MODE) { toast('Public demo is move-only. Drag cards between columns.', true); return; }
  const title = document.getElementById(`add-title-${columnId}`).value.trim();
  if (!title) { toast('Enter a task name', true); return; }

  const ownerId = parseInt(document.getElementById(`add-owner-${columnId}`).value) || 0;
  const dateDue = document.getElementById(`add-due-${columnId}`).value || '';

  try {
    await api('createTask', {
      title: title,
      project_id: state.currentProjectId,
      column_id: columnId,
      owner_id: ownerId,
      date_due: dateDue,
    });
    toast('Task added');
    // Clean up history state from add form
    if (addFormHistoryPushed) {
      addFormHistoryPushed = false;
      addFormColumnId = null;
      history.back();
    }
    await loadBoard();
    renderBoard();
  } catch (err) {
    console.error('Failed to add task:', err);
    toast('Failed to add task: ' + err.message, true);
  }
}

// ===== UTILITIES =====
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDateShort(dateStr) {
  if (!dateStr || dateStr === '0' || dateStr == 0) return '';
  let d;
  if (/^\d+$/.test(String(dateStr))) {
    d = new Date(parseInt(dateStr) * 1000);
  } else {
    d = new Date(dateStr + 'T00:00:00');
  }
  if (isNaN(d)) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatDateTime(timestamp) {
  if (!timestamp) return '';
  // Kanboard returns Unix timestamps as strings or ISO dates
  let d;
  if (/^\d+$/.test(timestamp)) {
    d = new Date(parseInt(timestamp) * 1000);
  } else {
    d = new Date(timestamp);
  }
  if (isNaN(d)) return timestamp;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${months[d.getMonth()]} ${d.getDate()}, ${h12}:${m} ${ampm}`;
}

function isOverdue(dateStr) {
  if (!dateStr || dateStr === '0' || dateStr == 0) return false;
  let due;
  if (/^\d+$/.test(String(dateStr))) {
    due = new Date(parseInt(dateStr) * 1000);
  } else {
    due = new Date(dateStr + 'T23:59:59');
  }
  return due < new Date();
}

function showLoading() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('board').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');
  document.getElementById('error').style.display = 'none';
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('loading').style.display = 'none';
  document.getElementById('board').classList.remove('hidden');
}

function showError(msg) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('loading').style.display = 'none';
  document.getElementById('board').classList.add('hidden');
  document.getElementById('error').classList.remove('hidden');
  document.getElementById('error').style.display = 'flex';
  document.getElementById('error-message').textContent = msg;
}

function toast(message, isError = false) {
  const el = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  msgEl.textContent = message;
  msgEl.className = `px-4 py-2 rounded-lg shadow-lg text-sm border ${
    isError ? 'bg-red-900/80 border-red-700 text-red-200' : 'bg-slate-800 border-kw-border text-kw-text'
  }`;
  el.classList.remove('hidden');
  el.classList.add('toast-show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('toast-show');
  }, 2500);
}

// ===== AUTO REFRESH =====
function startRefresh() {
  stopRefresh();
  state.refreshTimer = setInterval(async () => {
    // Don't refresh while panel is open (would disrupt edits)
    if (state.panelOpen) return;
    try {
      await loadBoard();
      renderBoard();
    } catch (err) {
      console.error('Auto-refresh failed:', err);
    }
  }, CONFIG.REFRESH_INTERVAL);
}

function stopRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

// ===== USER IDENTITY & FILTER =====
function getCurrentUserId() {
  if (state.authUser?.kanboard_user_id) return parseInt(state.authUser.kanboard_user_id);
  const id = localStorage.getItem('kw-user-id');
  return id ? parseInt(id) : null;
}

function getCurrentUserName() {
  if (state.authUser?.name) return state.authUser.name;
  return localStorage.getItem('kw-user-name') || null;
}

function setCurrentUser(userId, userName) {
  localStorage.setItem('kw-user-id', String(userId));
  localStorage.setItem('kw-user-name', userName);
}

function getActiveFilter() {
  if (CONFIG.DEMO_MODE && !localStorage.getItem('kw-filter')) return 'all';
  return localStorage.getItem('kw-filter') || 'mine';
}

function setActiveFilter(filter) {
  localStorage.setItem('kw-filter', filter);
}

function getFilteredTasks(tasks) {
  const filter = getActiveFilter();
  if (filter === 'all') return tasks;
  if (filter === 'mine') {
    const userId = getCurrentUserId();
    if (!userId) return tasks;
    return tasks.filter(t => parseInt(t.owner_id) === userId);
  }
  const filterUserId = parseInt(filter);
  if (isNaN(filterUserId)) return tasks;
  return tasks.filter(t => parseInt(t.owner_id) === filterUserId);
}

function getBoardAssignees() {
  const assignees = new Map();
  for (const col of state.board) {
    for (const task of col.tasks) {
      const ownerId = parseInt(task.owner_id);
      if (ownerId && ownerId !== 0) {
        if (!assignees.has(ownerId)) {
          const name = getAssigneeName(task);
          if (name) assignees.set(ownerId, { id: ownerId, name });
        }
      }
    }
  }
  return Array.from(assignees.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function renderFilterBar() {
  const container = document.getElementById('filter-bar');
  if (!container) return;
  const filter = getActiveFilter();
  const assignees = getBoardAssignees();
  const currentUserId = getCurrentUserId();
  let pills = [];
  pills.push(renderFilterPill('all', 'All', filter === 'all'));
  if (currentUserId) {
    pills.push(renderFilterPill('mine', 'My Tasks', filter === 'mine'));
  }
  for (const user of assignees) {
    if (user.id === currentUserId) continue;
    const firstName = user.name.split(' ')[0];
    pills.push(renderFilterPill(String(user.id), firstName, filter === String(user.id)));
  }
  container.innerHTML = pills.join('');
}

function renderFilterPill(value, label, active) {
  return `<button class="filter-pill px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-colors
    ${active
      ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
      : 'bg-kw-card/50 border-kw-border text-kw-dim hover:text-kw-muted hover:border-slate-500'
    }" onclick="applyFilter('${escapeAttr(value)}')">${escapeHtml(label)}</button>`;
}

function applyFilter(value) {
  setActiveFilter(value);
  renderFilterBar();
  renderBoard();
  savePrefsToServer();
}

function updateIdentityLabel() {
  const label = document.getElementById('identity-label');
  if (!label) return;
  const name = getCurrentUserName();
  label.textContent = name ? name.split(' ')[0] : '';
}

function checkIdentity() {
  if (state.authUser?.kanboard_user_id) {
    const authId = parseInt(state.authUser.kanboard_user_id);
    const authName = state.authUser.name;
    if (!localStorage.getItem('kw-user-id')) {
      setCurrentUser(authId, authName);
      if (!localStorage.getItem('kw-filter')) setActiveFilter(CONFIG.DEMO_MODE ? 'all' : 'mine');
      updateIdentityLabel();
      renderFilterBar();
    }
    closeIdentityModal();
    return;
  }

  if (!getCurrentUserId() && state.users.length > 0) {
    showIdentityModal();
  }
}

function showIdentityModal() {
  const modal = document.getElementById('identity-modal');
  const options = document.getElementById('identity-options');
  if (!modal || !options) return;
  const currentId = getCurrentUserId();
  options.innerHTML = state.users.map(u => `
    <button onclick="selectIdentity(${u.id})"
      class="w-full text-left px-4 py-3 rounded-lg border transition-colors
        ${u.id === currentId
          ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
          : 'bg-kw-card/50 border-kw-border text-kw-text hover:border-slate-500 hover:bg-kw-card'}">
      ${escapeHtml(u.name)}
    </button>
  `).join('');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function selectIdentity(userId) {
  const user = state.users.find(u => u.id === userId);
  if (!user) return;
  setCurrentUser(userId, user.name);
  setActiveFilter('mine');
  closeIdentityModal();
  renderFilterBar();
  updateIdentityLabel();
  renderBoard();
  loadPrefsFromServer().then(() => renderBoard());
}

function closeIdentityModal() {
  const modal = document.getElementById('identity-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function openIdentityModal() {
  showIdentityModal();
}

// ===== THEME (LIGHT/DARK) =====
const THEMES = {
  dark: {
    bg: '#06090e', card: '#0f172a', border: '#1e293b', header: '#020617',
    text: '#fafafa', muted: '#94a3b8', dim: '#64748b',
  },
  light: {
    bg: '#f8fafc', card: '#ffffff', border: '#e2e8f0', header: '#ffffff',
    text: '#0f172a', muted: '#334155', dim: '#64748b',
  },
};

function getTheme() {
  return localStorage.getItem('kw-theme') || 'dark';
}

function setTheme(theme) {
  localStorage.setItem('kw-theme', theme);
  applyTheme(theme);
  // Re-render board so card colours update for the new theme
  if (state.board.length > 0) renderBoard();
  savePrefsToServer();
}

function applyTheme(theme) {
  const t = THEMES[theme] || THEMES.dark;
  // Update Tailwind CSS custom properties via style tag
  let styleEl = document.getElementById('kw-theme-vars');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'kw-theme-vars';
    document.head.appendChild(styleEl);
  }
  // Override the kw- colour classes using CSS custom properties
  styleEl.textContent = `
    .bg-kw-bg { background-color: ${t.bg} !important; }
    .bg-kw-card { background-color: ${t.card} !important; }
    .bg-kw-card\\/50 { background-color: ${t.card}80 !important; }
    .border-kw-border { border-color: ${t.border} !important; }
    .border-kw-border\\/50 { border-color: ${t.border}80 !important; }
    .bg-kw-header { background-color: ${t.header} !important; }
    .text-kw-text { color: ${t.text} !important; }
    .text-kw-muted { color: ${t.muted} !important; }
    .text-kw-dim { color: ${t.dim} !important; }
    body { background-color: ${t.bg}; color: ${t.text}; }
    input, select, textarea { color: ${t.text}; }
    .bg-kw-bg\\/50 { background-color: ${t.bg}80 !important; }
    ${theme === 'light' ? `
    input[type="date"]::-webkit-calendar-picker-indicator { filter: none; }
    .task-card p { color: #0f172a; }
    #panel-overlay { background: rgba(0,0,0,0.3) !important; }
    #task-panel { background-color: #ffffff !important; }
    .sortable-drag { box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2); }
    ` : ''}
  `;
  // Update toggle button icon
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = theme === 'dark'
    ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>'
    : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>';
}

function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

// ===== SERVER-SIDE PREFERENCES =====
let _prefsSaveTimer = null;

function getLocalPrefs() {
  return {
    theme: getTheme(),
    filter: getActiveFilter(),
    collapseState: getCollapseState(),
    currentProjectId: state.currentProjectId,
  };
}

async function savePrefsToServer() {
  // Debounce — save at most every 1s
  if (_prefsSaveTimer) clearTimeout(_prefsSaveTimer);
  _prefsSaveTimer = setTimeout(async () => {
    const userId = getCurrentUserId();
    if (!userId) return;
    try {
      await fetch('/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, prefs: getLocalPrefs() }),
      });
    } catch (e) {
      console.warn('Failed to save prefs:', e);
    }
  }, 1000);
}

async function loadPrefsFromServer() {
  const userId = getCurrentUserId();
  if (!userId) return;
  try {
    const res = await fetch(`/prefs?userId=${userId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.prefs) return;
    const p = data.prefs;

    // Apply theme
    if (p.theme) {
      localStorage.setItem('kw-theme', p.theme);
      applyTheme(p.theme);
    }

    // Apply filter
    if (p.filter) {
      localStorage.setItem('kw-filter', p.filter);
    }

    // Apply collapse state
    if (p.collapseState && typeof p.collapseState === 'object') {
      localStorage.setItem('kw-column-collapse', JSON.stringify(p.collapseState));
    }

    // Restore last active project
    if (p.currentProjectId && state.projects.length > 0) {
      const targetId = parseInt(p.currentProjectId);
      const exists = state.projects.find(proj => parseInt(proj.id) === targetId);
      if (exists && state.currentProjectId !== targetId) {
        await selectProject(targetId);
      }
    }
  } catch (e) {
    console.warn('Failed to load prefs:', e);
  }
}

// ===== INIT =====
async function init() {
  applyTheme(getTheme()); // Apply theme immediately
  showLoading();
  try {
    await loadProjects();
    await loadPrefsFromServer(); // Load server prefs after identity is known
    renderBoard(); // Re-render with loaded prefs
  } catch (err) {
    console.error('Init failed:', err);
    showError('Could not connect to Kanboard. Check that the server is running.');
  }
}

document.addEventListener('DOMContentLoaded', init);

// Keyboard shortcut: Escape closes panel
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.panelOpen) {
    closeTaskPanel();
  }
});

// Back button handling — close overlays instead of navigating away
window.addEventListener('popstate', (e) => {
  if (state.panelOpen) {
    historyPanelPushed = false;
    closeTaskPanel();
  } else if (addFormColumnId !== null) {
    addFormHistoryPushed = false;
    hideAddForm(addFormColumnId);
  }
});

// Re-render board when crossing mobile/desktop breakpoint
let _wasMobile = window.innerWidth < MOBILE_BREAKPOINT;
window.addEventListener('resize', () => {
  const nowMobile = window.innerWidth < MOBILE_BREAKPOINT;
  if (nowMobile !== _wasMobile && state.board.length > 0) {
    _wasMobile = nowMobile;
    renderBoard();
  }
});
