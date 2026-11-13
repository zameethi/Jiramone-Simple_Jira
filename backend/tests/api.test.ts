import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcryptjs';

import app from '../src/index';
import prisma from '../src/lib/prisma';
import { generateToken } from '../src/middleware/auth';

type AnyRecord = Record<string, any>;

let server: http.Server;
let baseUrl: string;

const originals = {
  $queryRaw: prisma.$queryRaw.bind(prisma),
  userFindUnique: prisma.user.findUnique.bind(prisma.user),
  userFindMany: prisma.user.findMany.bind(prisma.user),
  userCreate: prisma.user.create.bind(prisma.user),
  userUpsert: prisma.user.upsert.bind(prisma.user),
  userCount: prisma.user.count.bind(prisma.user),
  projectFindMany: prisma.project.findMany.bind(prisma.project),
  projectFindFirst: prisma.project.findFirst.bind(prisma.project),
  projectFindUnique: prisma.project.findUnique.bind(prisma.project),
  projectCreate: prisma.project.create.bind(prisma.project),
  projectUpdate: prisma.project.update.bind(prisma.project),
  projectDelete: prisma.project.delete.bind(prisma.project),
  projectCount: prisma.project.count.bind(prisma.project),
  taskFindMany: prisma.task.findMany.bind(prisma.task),
  taskFindFirst: prisma.task.findFirst.bind(prisma.task),
  taskFindUnique: prisma.task.findUnique.bind(prisma.task),
  taskCreate: prisma.task.create.bind(prisma.task),
  taskUpdate: prisma.task.update.bind(prisma.task),
  taskDelete: prisma.task.delete.bind(prisma.task),
  taskDeleteMany: prisma.task.deleteMany.bind(prisma.task),
  commentFindMany: prisma.comment.findMany.bind(prisma.comment),
  commentFindUnique: prisma.comment.findUnique.bind(prisma.comment),
  commentCreate: prisma.comment.create.bind(prisma.comment),
  commentDelete: prisma.comment.delete.bind(prisma.comment),
};

let db: {
  users: AnyRecord[];
  projects: AnyRecord[];
  tasks: AnyRecord[];
  comments: AnyRecord[];
  queryRawOk: boolean;
};

async function request(path: string, options: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  (prisma as any).$queryRaw = originals.$queryRaw;
  prisma.user.findUnique = originals.userFindUnique;
  prisma.user.findMany = originals.userFindMany;
  prisma.user.create = originals.userCreate;
  prisma.user.upsert = originals.userUpsert;
  prisma.user.count = originals.userCount;
  prisma.project.findMany = originals.projectFindMany;
  prisma.project.findFirst = originals.projectFindFirst;
  prisma.project.findUnique = originals.projectFindUnique;
  prisma.project.create = originals.projectCreate;
  prisma.project.update = originals.projectUpdate;
  prisma.project.delete = originals.projectDelete;
  prisma.project.count = originals.projectCount;
  prisma.task.findMany = originals.taskFindMany;
  prisma.task.findFirst = originals.taskFindFirst;
  prisma.task.findUnique = originals.taskFindUnique;
  prisma.task.create = originals.taskCreate;
  prisma.task.update = originals.taskUpdate;
  prisma.task.delete = originals.taskDelete;
  prisma.task.deleteMany = originals.taskDeleteMany;
  prisma.comment.findMany = originals.commentFindMany;
  prisma.comment.findUnique = originals.commentFindUnique;
  prisma.comment.create = originals.commentCreate;
  prisma.comment.delete = originals.commentDelete;

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const passwordHash = await bcrypt.hash('secret123', 4);
  db = {
    queryRawOk: true,
    users: [
      {
        id: 'user-1',
        email: 'alex@jiramone.dev',
        name: 'Alex Rivera',
        password: passwordHash,
        avatarColor: '#0052CC',
        role: 'ADMIN',
        createdAt: new Date(),
      },
      {
        id: 'user-2',
        email: 'bia@jiramone.dev',
        name: 'Beatriz Costa',
        password: passwordHash,
        avatarColor: '#00875A',
        role: 'MEMBER',
        createdAt: new Date(),
      },
    ],
    projects: [
      {
        id: 'proj-1',
        key: 'JIR',
        name: 'Jiramone Core',
        description: 'Projeto principal',
        category: 'SOFTWARE',
        columns: JSON.stringify([
          { id: 'TODO', title: 'A Fazer' },
          { id: 'IN_PROGRESS', title: 'Em Progresso' },
          { id: 'DONE', title: 'Concluído' },
        ]),
        ownerId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    tasks: [
      {
        id: 'task-1',
        key: 'JIR-1',
        title: 'Configurar CI',
        description: 'Pipeline',
        status: 'DONE',
        priority: 'HIGH',
        type: 'TASK',
        storyPoints: 5,
        sprint: 'Sprint 1',
        labels: 'devops,ci',
        environment: 'PROD',
        components: 'Backend',
        parentKey: null,
        resolution: 'Done',
        dueDate: null,
        projectId: 'proj-1',
        assigneeId: 'user-1',
        reporterId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'task-2',
        key: 'JIR-2',
        title: 'Corrigir login',
        description: 'Bug no token',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        type: 'BUG',
        storyPoints: 3,
        sprint: 'Sprint 1',
        labels: 'auth',
        environment: 'HLG',
        components: 'Auth',
        parentKey: null,
        resolution: null,
        dueDate: null,
        projectId: 'proj-1',
        assigneeId: null,
        reporterId: 'user-2',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    comments: [
      {
        id: 'comm-1',
        content: 'Primeiro comentário',
        taskId: 'task-1',
        authorId: 'user-1',
        createdAt: new Date(),
      },
    ],
  };

  (prisma as any).$queryRaw = async () => {
    if (!db.queryRawOk) throw new Error('DB down');
    return [{ '?column?': 1 }];
  };

  (prisma.user as any).findUnique = async ({ where }: AnyRecord) => {
    return db.users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) || null;
  };
  (prisma.user as any).findMany = async () => db.users;
  (prisma.user as any).count = async () => db.users.length;
  (prisma.user as any).create = async ({ data }: AnyRecord) => {
    const user = { id: `user-${db.users.length + 1}`, createdAt: new Date(), ...data };
    db.users.push(user);
    return user;
  };
  (prisma.user as any).upsert = async ({ where, create }: AnyRecord) => {
    const existing = db.users.find((u) => u.email === where.email);
    if (existing) return existing;
    const created = { id: `user-${db.users.length + 1}`, createdAt: new Date(), ...create };
    db.users.push(created);
    return created;
  };

  (prisma.project as any).count = async () => db.projects.length;
  (prisma.project as any).findMany = async () => {
    return db.projects.map((p) => ({
      ...p,
      owner: db.users.find((u) => u.id === p.ownerId) || null,
      tasks: db.tasks.filter((t) => t.projectId === p.id),
    }));
  };
  (prisma.project as any).findFirst = async ({ where }: AnyRecord) => {
    const ors = where?.OR || [];
    const found = db.projects.find((p) =>
      ors.some((cond: AnyRecord) => (cond.id && p.id === cond.id) || (cond.key && p.key === cond.key))
    );
    if (!found) return null;
    return {
      ...found,
      owner: db.users.find((u) => u.id === found.ownerId) || null,
      tasks: db.tasks.filter((t) => t.projectId === found.id),
    };
  };
  (prisma.project as any).findUnique = async ({ where }: AnyRecord) => {
    return db.projects.find((p) => (where.id ? p.id === where.id : p.key === where.key)) || null;
  };
  (prisma.project as any).create = async ({ data }: AnyRecord) => {
    const proj = {
      id: `proj-${db.projects.length + 1}`,
      columns: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    db.projects.push(proj);
    return { ...proj, owner: db.users.find((u) => u.id === proj.ownerId) || null };
  };
  (prisma.project as any).update = async ({ where, data }: AnyRecord) => {
    const idx = db.projects.findIndex((p) => p.id === where.id);
    db.projects[idx] = { ...db.projects[idx], ...data, updatedAt: new Date() };
    return {
      ...db.projects[idx],
      owner: db.users.find((u) => u.id === db.projects[idx].ownerId) || null,
    };
  };
  (prisma.project as any).delete = async ({ where }: AnyRecord) => {
    const idx = db.projects.findIndex((p) => p.id === where.id);
    const [removed] = db.projects.splice(idx, 1);
    db.tasks = db.tasks.filter((t) => t.projectId !== where.id);
    return removed;
  };

  (prisma.task as any).findMany = async ({ where = {} }: AnyRecord = {}) => {
    return db.tasks
      .filter((t) => {
        if (where.projectId && t.projectId !== where.projectId) return false;
        if (where.status && t.status !== where.status) return false;
        if (where.priority && t.priority !== where.priority) return false;
        if (where.type && t.type !== where.type) return false;
        if ('assigneeId' in where && t.assigneeId !== where.assigneeId) return false;
        if (where.sprint && t.sprint !== where.sprint) return false;
        if (where.OR) {
          const q = String(where.OR[0]?.title?.contains || '').toLowerCase();
          const match =
            (t.title && t.title.toLowerCase().includes(q)) ||
            (t.description && t.description.toLowerCase().includes(q)) ||
            (t.key && t.key.toLowerCase().includes(q)) ||
            (t.labels && t.labels.toLowerCase().includes(q));
          if (!match) return false;
        }
        return true;
      })
      .map((t) => ({
        ...t,
        project: db.projects.find((p) => p.id === t.projectId) || null,
        assignee: db.users.find((u) => u.id === t.assigneeId) || null,
        reporter: db.users.find((u) => u.id === t.reporterId) || null,
        _count: { comments: db.comments.filter((c) => c.taskId === t.id).length },
      }));
  };
  (prisma.task as any).findFirst = async ({ where }: AnyRecord) => {
    const ors = where?.OR || [];
    const found = db.tasks.find((t) =>
      ors.some((cond: AnyRecord) => (cond.id && t.id === cond.id) || (cond.key && t.key === cond.key))
    );
    if (!found) return null;
    return {
      ...found,
      project: db.projects.find((p) => p.id === found.projectId) || null,
      assignee: db.users.find((u) => u.id === found.assigneeId) || null,
      reporter: db.users.find((u) => u.id === found.reporterId) || null,
      comments: db.comments.filter((c) => c.taskId === found.id),
    };
  };
  (prisma.task as any).findUnique = async ({ where }: AnyRecord) => {
    return db.tasks.find((t) => t.id === where.id) || null;
  };
  (prisma.task as any).create = async ({ data }: AnyRecord) => {
    const task = {
      id: `task-${db.tasks.length + 1}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    db.tasks.push(task);
    return {
      ...task,
      project: db.projects.find((p) => p.id === task.projectId) || null,
      assignee: db.users.find((u) => u.id === task.assigneeId) || null,
      reporter: db.users.find((u) => u.id === task.reporterId) || null,
      _count: { comments: 0 },
    };
  };
  (prisma.task as any).update = async ({ where, data }: AnyRecord) => {
    const idx = db.tasks.findIndex((t) => t.id === where.id);
    db.tasks[idx] = { ...db.tasks[idx], ...data, updatedAt: new Date() };
    const task = db.tasks[idx];
    return {
      ...task,
      project: db.projects.find((p) => p.id === task.projectId) || null,
      assignee: db.users.find((u) => u.id === task.assigneeId) || null,
      reporter: db.users.find((u) => u.id === task.reporterId) || null,
      _count: { comments: db.comments.filter((c) => c.taskId === task.id).length },
    };
  };
  (prisma.task as any).delete = async ({ where }: AnyRecord) => {
    const idx = db.tasks.findIndex((t) => t.id === where.id);
    const [removed] = db.tasks.splice(idx, 1);
    db.comments = db.comments.filter((c) => c.taskId !== where.id);
    return removed;
  };
  (prisma.task as any).deleteMany = async ({ where = {} }: AnyRecord = {}) => {
    const before = db.tasks.length;
    db.tasks = db.tasks.filter((t) => (where.projectId ? t.projectId !== where.projectId : false));
    return { count: before - db.tasks.length };
  };

  (prisma.comment as any).findMany = async ({ where = {} }: AnyRecord = {}) => {
    return db.comments
      .filter((c) => {
        if (where.taskId && c.taskId !== where.taskId) return false;
        if (where.task?.projectId) {
          const t = db.tasks.find((task) => task.id === c.taskId);
          if (!t || t.projectId !== where.task.projectId) return false;
        }
        return true;
      })
      .map((c) => ({
        ...c,
        author: db.users.find((u) => u.id === c.authorId) || null,
        task: db.tasks.find((t) => t.id === c.taskId) || null,
      }));
  };
  (prisma.comment as any).findUnique = async ({ where }: AnyRecord) => {
    return db.comments.find((c) => c.id === where.id) || null;
  };
  (prisma.comment as any).create = async ({ data }: AnyRecord) => {
    const comment = { id: `comm-${db.comments.length + 1}`, createdAt: new Date(), ...data };
    db.comments.push(comment);
    return {
      ...comment,
      author: db.users.find((u) => u.id === comment.authorId) || null,
    };
  };
  (prisma.comment as any).delete = async ({ where }: AnyRecord) => {
    const idx = db.comments.findIndex((c) => c.id === where.id);
    const [removed] = db.comments.splice(idx, 1);
    return removed;
  };
});

describe('API Health & Root', () => {
  it('GET / returns API metadata', async () => {
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'online');
  });

  it('GET /api/health returns ok when DB is connected and 503 when disconnected', async () => {
    const okRes = await request('/api/health');
    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.database, 'connected');

    db.queryRawOk = false;
    const errRes = await request('/api/health');
    assert.equal(errRes.status, 503);
    assert.equal(errRes.body.database, 'disconnected');
  });

  it('returns 400 on malformed JSON body', async () => {
    const raw = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });
    assert.equal(raw.status, 400);
  });
});

describe('API Auth & Users', () => {
  it('POST /api/auth/register validates input, prevents duplicates, and creates user', async () => {
    const bad = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(bad.status, 400);

    const dup = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'alex@jiramone.dev', password: 'secret123' }),
    });
    assert.equal(dup.status, 409);

    const ok = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'novo@jiramone.dev', password: 'secret123', name: 'Novo User' }),
    });
    assert.equal(ok.status, 201);
    assert.ok(ok.body.token);
    assert.equal(ok.body.user.email, 'novo@jiramone.dev');
  });

  it('POST /api/auth/login authenticates valid credentials and rejects invalid ones', async () => {
    const fail = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'alex@jiramone.dev', password: 'wrong' }),
    });
    assert.equal(fail.status, 401);

    const ok = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'alex@jiramone.dev', password: 'secret123' }),
    });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
  });

  it('GET /api/auth/me requires JWT and returns profile', async () => {
    const unauth = await request('/api/auth/me');
    assert.equal(unauth.status, 401);

    const token = generateToken({ userId: 'user-1', email: 'alex@jiramone.dev' });
    const ok = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.email, 'alex@jiramone.dev');
  });

  it('GET /api/users returns user list', async () => {
    const res = await request('/api/users');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
  });
});

describe('API Projects', () => {
  it('GET /api/projects returns projects with computed stats', async () => {
    const res = await request('/api/projects');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.deepEqual(res.body[0].stats, {
      totalTasks: 2,
      doneTasks: 1,
      inProgressTasks: 1,
      completionRate: 50,
      totalPoints: 8,
      donePoints: 5,
    });
  });

  it('GET /api/projects/:id finds by id or key and returns 404 when missing', async () => {
    const byKey = await request('/api/projects/jir');
    assert.equal(byKey.status, 200);
    assert.equal(byKey.body.id, 'proj-1');

    const missing = await request('/api/projects/nao-existe');
    assert.equal(missing.status, 404);
  });

  it('POST, PATCH, and DELETE /api/projects enforce auth and validate columns', async () => {
    const token = generateToken({ userId: 'user-1', email: 'alex@jiramone.dev' });

    const created = await request('/api/projects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Mobile App', key: 'MOB' }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.key, 'MOB');

    const badCols = await request(`/api/projects/${created.body.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ columns: [] }),
    });
    assert.equal(badCols.status, 400);

    const updated = await request(`/api/projects/${created.body.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ columns: [{ id: 'QA', title: 'Em Teste' }] }),
    });
    assert.equal(updated.status, 200);

    const deleted = await request(`/api/projects/${created.body.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(deleted.status, 200);
  });
});

describe('API Tasks & Comments', () => {
  it('GET /api/tasks supports filtering by status, priority, assigneeId=UNASSIGNED, and search', async () => {
    const bugs = await request('/api/tasks?type=BUG&assigneeId=UNASSIGNED');
    assert.equal(bugs.status, 200);
    assert.equal(bugs.body.length, 1);
    assert.equal(bugs.body[0].key, 'JIR-2');

    const search = await request('/api/tasks?search=pipeline');
    assert.equal(search.status, 200);
    assert.equal(search.body.length, 1);
    assert.equal(search.body[0].key, 'JIR-1');
  });

  it('POST, PATCH, DELETE /api/tasks validate inputs and auto-increment issue key', async () => {
    const token = generateToken({ userId: 'user-1', email: 'alex@jiramone.dev' });

    const badPoints = await request('/api/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'Test', projectId: 'proj-1', storyPoints: 999 }),
    });
    assert.equal(badPoints.status, 400);

    const created = await request('/api/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: 'Nova Entrega',
        projectId: 'proj-1',
        status: 'EM_TESTE',
        priority: 'HIGH',
        type: 'STORY',
        storyPoints: 8,
        environment: 'PROD',
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.key, 'JIR-3');
    assert.equal(created.body.status, 'EM_TESTE');

    const updated = await request(`/api/tasks/${created.body.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'DONE' }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, 'DONE');

    const deleted = await request(`/api/tasks/${created.body.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(deleted.status, 200);
  });

  it('Comments endpoints create, list, enforce author check on delete, and delete', async () => {
    const ownerToken = generateToken({ userId: 'user-1', email: 'alex@jiramone.dev' });
    const otherToken = generateToken({ userId: 'user-2', email: 'bia@jiramone.dev' });

    const list = await request('/api/tasks/task-1/comments');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);

    const created = await request('/api/tasks/task-1/comments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ content: 'Novo comentário' }),
    });
    assert.equal(created.status, 201);

    const forbidden = await request(`/api/tasks/task-1/comments/${created.body.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal(forbidden.status, 403);

    const deleted = await request(`/api/tasks/task-1/comments/${created.body.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(deleted.status, 200);
  });
});

describe('API Dashboard & Import', () => {
  it('GET /api/dashboard/stats aggregates metrics accurately', async () => {
    const res = await request('/api/dashboard/stats?projectId=proj-1');
    assert.equal(res.status, 200);
    assert.equal(res.body.totalTasks, 2);
    assert.equal(res.body.completionRate, 50);
    assert.deepEqual(res.body.storyPoints, { total: 8, completed: 5 });
    assert.equal(res.body.byType.BUG, 1);
    assert.equal(res.body.byType.TASK, 1);
  });

  it('GET /api/import/info requires auth and checks CSV availability', async () => {
    const unauth = await request('/api/import/info');
    assert.equal(unauth.status, 401);

    const token = generateToken({ userId: 'user-1', email: 'alex@jiramone.dev' });
    const ok = await request('/api/import/info', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(ok.status, 200);
    assert.equal(typeof ok.body.available, 'boolean');
  });

  it('POST /api/import/run imports uploaded csvContent and clears existing items when clearExisting=true', async () => {
    const token = generateToken({ userId: 'user-1', email: 'alex@jiramone.dev' });
    const csvContent = [
      'Resumo,Chave da item,Tipo de item,Status,Chave do projeto,Nome do projeto,Prioridade',
      'Nova Tarefa CSV,JIR-99,História,PARA FAZER,JIR,Jiramone Core,High',
    ].join('\n');

    const res = await request('/api/import/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        csvContent,
        clearExisting: true,
        limit: 10,
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.stats.tasksDeleted, 2);
    assert.equal(res.body.stats.tasksCreated, 1);
    assert.equal(db.tasks.length, 1);
    assert.equal(db.tasks[0].key, 'JIR-99');
    assert.equal(db.tasks[0].status, 'TODO');
  });
});
