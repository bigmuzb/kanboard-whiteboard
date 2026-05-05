#!/usr/bin/env node
/*
 * Seed a reusable demo Kanboard + Whiteboard stack with fake projects, users,
 * tasks, comments, and local magic-link auth users.
 *
 * Safe to rerun: it reuses existing demo projects/tasks/users where possible.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const auth = require('../auth');

const samplePath = process.env.DEMO_SAMPLE_DATA || path.join(__dirname, '..', 'demo', 'sample-data.json');
const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

const KANBOARD_URL = process.env.KANBOARD_URL || 'http://kanboard:80/jsonrpc.php';
const KANBOARD_USER = process.env.KANBOARD_USER || 'jsonrpc';
const KANBOARD_KEY = process.env.KANBOARD_KEY || process.env.API_AUTHENTICATION_TOKEN || 'demo-jsonrpc-token';
const WHITEBOARD_URL = process.env.WHITEBOARD_URL || 'http://localhost:3000';

let rpcId = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestJson(url, payload) {
  const body = JSON.stringify(payload);
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  const authHeader = Buffer.from(`${KANBOARD_USER}:${KANBOARD_KEY}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = client.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Basic ${authHeader}`,
      },
      timeout: 10000,
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          resolve(parsed.result);
        } catch (e) {
          reject(new Error(`Invalid JSON from Kanboard (${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.write(body);
    req.end();
  });
}

async function api(method, params = {}) {
  return requestJson(KANBOARD_URL, { jsonrpc: '2.0', method, id: ++rpcId, params });
}

async function waitForKanboard() {
  for (let i = 1; i <= 60; i++) {
    try {
      const version = await api('getVersion');
      console.log(`Kanboard ready: ${version}`);
      return version;
    } catch (e) {
      if (i === 60) throw e;
      await sleep(2000);
    }
  }
}

async function getOrCreateUser(user, index) {
  if (user.username === 'admin') return { id: 1, ...user };

  let users = [];
  try {
    users = await api('getAllUsers');
  } catch {
    users = [];
  }

  const existing = users.find(u => u.username === user.username || u.name === user.name);
  if (existing) return { id: parseInt(existing.id, 10), ...user };

  try {
    const id = await api('createUser', {
      username: user.username,
      password: `demo-${user.username}-${index}-change-me`,
      name: user.name,
      email: `${user.username}@example.invalid`,
      role: 'app-user',
    });
    return { id: parseInt(id, 10), ...user };
  } catch (e) {
    console.warn(`Could not create Kanboard user ${user.name}: ${e.message}`);
    return { id: 0, ...user };
  }
}

async function getOrCreateProject(name) {
  const projects = await api('getAllProjects');
  const existing = (projects || []).find(p => p.name === name);
  if (existing) return parseInt(existing.id, 10);
  const id = await api('createProject', { name });
  return parseInt(id, 10);
}

async function addUserToProject(projectId, userId) {
  if (!userId) return;
  try {
    await api('addProjectUser', { project_id: projectId, user_id: userId, role: 'project-member' });
  } catch {
    // Already a member or method unavailable. Non-fatal for demo seeding.
  }
}

function normaliseColumn(name) {
  return String(name || '').toLowerCase().replace(/[-_]/g, ' ').trim();
}

async function getColumns(projectId) {
  const board = await api('getBoard', { project_id: projectId });
  const columns = [];
  for (const swimlane of board || []) {
    for (const col of swimlane.columns || []) {
      let existing = columns.find(c => c.id === parseInt(col.id, 10));
      if (!existing) {
        existing = {
          id: parseInt(col.id, 10),
          title: col.title || col.name,
          position: parseInt(col.position || 0, 10),
          tasks: [],
        };
        columns.push(existing);
      }
      existing.tasks.push(...(col.tasks || []));
    }
  }
  return columns.sort((a, b) => a.position - b.position);
}

function pickColumn(columns, wanted) {
  const target = normaliseColumn(wanted);
  const aliases = {
    'backlog': ['backlog', 'pending', 'todo', 'to do'],
    'ready': ['ready', 'next'],
    'work in progress': ['work in progress', 'in progress', 'wip', 'doing'],
    'done': ['done', 'completed', 'complete'],
  }[target] || [target];

  return columns.find(c => aliases.includes(normaliseColumn(c.title))) || columns[0];
}

async function createTaskIfMissing(projectId, columns, task, usersByName) {
  const allTasks = columns.flatMap(c => c.tasks || []);
  const existing = allTasks.find(t => t.title === task.title);
  if (existing) return parseInt(existing.id, 10);

  const column = pickColumn(columns, task.column);
  const owner = usersByName.get(task.owner);
  const params = {
    project_id: projectId,
    title: task.title,
    description: task.description || '',
    column_id: column.id,
  };
  if (owner && owner.id) params.owner_id = owner.id;
  if (task.color) params.color_id = task.color;

  const taskId = await api('createTask', params);
  if (!taskId) throw new Error(`Kanboard did not create task: ${task.title}`);
  return parseInt(taskId, 10);
}

async function addComment(taskId, userId, content) {
  try {
    await api('createComment', { task_id: taskId, user_id: userId || 1, content });
  } catch {
    // Comments are nice-to-have in the demo. Do not fail the seed if unavailable.
  }
}

async function seedWhiteboardAuth(users, projectIds) {
  auth.init();
  const allowed = projectIds.map(Number);

  for (const u of users) {
    if (!u.id) continue;
    const role = u.role === 'admin' ? 'admin' : 'user';
    const existing = auth.getUserByKanboardId(u.id);
    if (existing) {
      auth.updateUser(existing.id, { name: existing.name || u.name, role: existing.role || role, allowed_projects: allowed, is_active: 1 });
      continue;
    }
    auth.createUser(u.id, u.name, role, allowed);
  }

  const admin = auth.getUserByKanboardId(1) || auth.getUsers().find(u => u.role === 'admin');
  if (!admin) return null;
  return auth.createMagicLink(admin.id, 'demo-admin', 0);
}

async function main() {
  console.log('Seeding Kanboard Whiteboard demo...');
  await waitForKanboard();

  const users = [];
  for (let i = 0; i < sample.users.length; i++) {
    users.push(await getOrCreateUser(sample.users[i], i + 1));
  }
  const usersByName = new Map(users.map(u => [u.name, u]));

  const projectIds = [];
  for (const project of sample.projects) {
    const projectId = await getOrCreateProject(project.name);
    projectIds.push(projectId);

    for (const u of users) await addUserToProject(projectId, u.id);

    let columns = await getColumns(projectId);
    for (let i = 0; i < project.tasks.length; i++) {
      const taskId = await createTaskIfMissing(projectId, columns, project.tasks[i], usersByName);
      if (i % 3 === 0) await addComment(taskId, 1, sample.comments[i % sample.comments.length]);
      columns = await getColumns(projectId);
    }
  }

  const link = await seedWhiteboardAuth(users, projectIds);

  console.log('Demo seed complete.');
  if (link) {
    console.log(`Admin magic link: ${WHITEBOARD_URL}/auth/login?token=${link.token}`);
  }
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
