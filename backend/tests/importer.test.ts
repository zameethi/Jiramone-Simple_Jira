import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import prisma from '../src/lib/prisma';
import { importJiraCSV, importJiraCSVContent, normalizeJiraStatus } from '../src/services/jiraImporter';

type AnyRecord = Record<string, any>;

const originals = {
  userUpsert: prisma.user.upsert.bind(prisma.user),
  projectFindUnique: prisma.project.findUnique.bind(prisma.project),
  projectCreate: prisma.project.create.bind(prisma.project),
  projectUpdate: prisma.project.update.bind(prisma.project),
  taskFindFirst: prisma.task.findFirst.bind(prisma.task),
  taskCreate: prisma.task.create.bind(prisma.task),
  taskUpdate: prisma.task.update.bind(prisma.task),
  taskDeleteMany: prisma.task.deleteMany.bind(prisma.task),
  commentCreate: prisma.comment.create.bind(prisma.comment),
};

let tmpFile: string;
let projects: AnyRecord[];
let tasks: AnyRecord[];
let comments: AnyRecord[];
let users: AnyRecord[];

beforeEach(() => {
  projects = [];
  tasks = [];
  comments = [];
  users = [];

  (prisma.user as any).upsert = async ({ where, create }: AnyRecord) => {
    const found = users.find((u) => u.email === where.email);
    if (found) return found;
    const u = { id: `u-${users.length + 1}`, ...create };
    users.push(u);
    return u;
  };
  (prisma.project as any).findUnique = async ({ where }: AnyRecord) => {
    return projects.find((p) => (where.id ? p.id === where.id : p.key === where.key)) || null;
  };
  (prisma.project as any).create = async ({ data }: AnyRecord) => {
    const p = { id: `p-${projects.length + 1}`, columns: null, ...data };
    projects.push(p);
    return p;
  };
  (prisma.project as any).update = async ({ where, data }: AnyRecord) => {
    const idx = projects.findIndex((p) => p.id === where.id);
    projects[idx] = { ...projects[idx], ...data };
    return projects[idx];
  };
  (prisma.task as any).findFirst = async ({ where }: AnyRecord) => {
    return tasks.find((t) => t.key === where.key && t.projectId === where.projectId) || null;
  };
  (prisma.task as any).create = async ({ data }: AnyRecord) => {
    const t = { id: `t-${tasks.length + 1}`, ...data };
    tasks.push(t);
    return t;
  };
  (prisma.task as any).update = async ({ where, data }: AnyRecord) => {
    const idx = tasks.findIndex((t) => t.id === where.id);
    tasks[idx] = { ...tasks[idx], ...data };
    return tasks[idx];
  };
  (prisma.task as any).deleteMany = async ({ where = {} }: AnyRecord = {}) => {
    const before = tasks.length;
    tasks = tasks.filter((t) => (where.projectId ? t.projectId !== where.projectId : false));
    return { count: before - tasks.length };
  };
  (prisma.comment as any).create = async ({ data }: AnyRecord) => {
    const c = { id: `c-${comments.length + 1}`, ...data };
    comments.push(c);
    return c;
  };
});

after(() => {
  prisma.user.upsert = originals.userUpsert;
  prisma.project.findUnique = originals.projectFindUnique;
  prisma.project.create = originals.projectCreate;
  prisma.project.update = originals.projectUpdate;
  prisma.task.findFirst = originals.taskFindFirst;
  prisma.task.create = originals.taskCreate;
  prisma.task.update = originals.taskUpdate;
  prisma.task.deleteMany = originals.taskDeleteMany;
  prisma.comment.create = originals.commentCreate;

  if (tmpFile && fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile);
  }
});

describe('Jira CSV Importer Service', () => {
  it('throws when CSV file does not exist', async () => {
    await assert.rejects(
      () => importJiraCSV('/tmp/non-existent-jira-file.csv', { defaultOwnerId: 'owner-1' }),
      /Arquivo não encontrado/
    );
  });

  it('imports projects, multiline tasks, custom status columns, users, and comments from CSV', async () => {
    const csvContent = [
      'Resumo,Chave da item,Tipo de item,Status,Chave do projeto,Nome do projeto,Prioridade,Responsável,Relator,Descrição,Data de entrega,Sprint,Campo personalizado (Story Points),Categorias,Ambiente,Componentes,Chave pai,Resolução,Comentar',
      '"Corrigir ""bug"" crítico",LR-10,Bug,Em Teste,LR,Logística,Gravíssima,Maria Silva,João Souza,"Linha 1\nLinha 2",15/mai/24 10:00 AM,Sprint 10,5,backend,PROD,API,LR-1,Em andamento,"24/fev/20 3:26 PM;Maria Silva;Comentário de teste"',
      'Nova História,LR-11,História,Concluído,LR,Logística,Low,João Souza,João Souza,Simples,,Sprint 11,8,frontend,HLG,Web,,Feito,',
      'Terceira Linha,LR-12,Tarefa,Backlog,LR,Logística,Medium,,,,,,,,,,,""',
    ].join('\n');

    tmpFile = path.join(os.tmpdir(), `jira-test-${Date.now()}.csv`);
    fs.writeFileSync(tmpFile, csvContent, 'utf-8');

    const stats = await importJiraCSV(tmpFile, {
      limit: 2,
      defaultOwnerId: 'owner-1',
    });

    assert.equal(stats.projectsCreatedOrFound, 1);
    assert.equal(stats.tasksCreated, 2);
    assert.equal(stats.commentsCreated, 1);
    assert.equal(tasks.length, 2);

    assert.equal(tasks[0].key, 'LR-10');
    assert.equal(tasks[0].type, 'BUG');
    assert.equal(tasks[0].priority, 'URGENT');
    assert.equal(tasks[0].status, 'EM TESTE');
    assert.equal(tasks[0].description, 'Linha 1\nLinha 2');
    assert.equal(tasks[0].storyPoints, 5);
    assert.equal(tasks[0].environment, 'PROD');
    assert.equal(tasks[0].parentKey, 'LR-1');

    assert.equal(tasks[1].type, 'STORY');
    assert.equal(tasks[1].priority, 'LOW');

    const savedCols = JSON.parse(projects[0].columns);
    assert.ok(savedCols.some((c: { id: string }) => c.id === 'EM TESTE'));
    assert.ok(savedCols.some((c: { id: string }) => c.id === 'DONE'));
  });

  it('normalizes Portuguese Jira statuses and handles UTF-8 BOM + clearExisting in importJiraCSVContent', async () => {
    assert.equal(normalizeJiraStatus('Concluído'), 'DONE');
    assert.equal(normalizeJiraStatus('PARA FAZER'), 'TODO');
    assert.equal(normalizeJiraStatus('Em Desenvolvimento'), 'IN_PROGRESS');
    assert.equal(normalizeJiraStatus('Refinado'), 'REFINADO');

    projects.push({ id: 'p-1', key: 'LR', name: 'Logística', columns: null });
    tasks.push({ id: 'old-1', key: 'LR-OLD', projectId: 'p-1', title: 'Antiga' });

    const csvWithBom =
      '\uFEFFResumo,Chave da item,Tipo de item,Status,Chave do projeto,Nome do projeto,Prioridade,Campo personalizado (Data de Entrega Planejada),Campo personalizado (Quarter de Entrega)\n' +
      'Item Novo,LR-200,História,Em Desenvolvimento,LR,Logística,High,27/mai/26 12:00 AM,Q2 -> 2026\n';

    const stats = await importJiraCSVContent(csvWithBom, {
      clearExisting: true,
      defaultOwnerId: 'owner-1',
    });

    assert.equal(stats.tasksDeleted, 1);
    assert.equal(stats.tasksCreated, 1);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].key, 'LR-200');
    assert.equal(tasks[0].status, 'IN_PROGRESS');
    assert.equal(tasks[0].sprint, 'Q2 -> 2026');
    assert.ok(tasks[0].dueDate instanceof Date);
  });
});
