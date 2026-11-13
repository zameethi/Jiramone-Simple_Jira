import fs from 'fs';
import readline from 'readline';
import { Readable } from 'stream';
import prisma from '../lib/prisma';

// Mapeamento de meses em português do Jira para números
const PT_MONTHS: Record<string, string> = {
  jan: '01',
  fev: '02',
  mar: '03',
  abr: '04',
  mai: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  set: '09',
  out: '10',
  nov: '11',
  dez: '12',
};

const STANDARD_STATUS_MAP: Record<string, string> = {
  BACKLOG: 'BACKLOG',
  'PARA FAZER': 'TODO',
  'TO DO': 'TODO',
  TODO: 'TODO',
  'EM DESENVOLVIMENTO': 'IN_PROGRESS',
  'EM PROGRESSO': 'IN_PROGRESS',
  'IN PROGRESS': 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  'EM REVISÃO': 'IN_REVIEW',
  'IN REVIEW': 'IN_REVIEW',
  IN_REVIEW: 'IN_REVIEW',
  CONCLUÍDO: 'DONE',
  CONCLUIDO: 'DONE',
  DONE: 'DONE',
};

export function normalizeJiraStatus(rawStatus?: string | null): string {
  const upper = (rawStatus || 'TODO').toUpperCase().trim();
  return STANDARD_STATUS_MAP[upper] || upper;
}

export function parseJiraDate(dateStr?: string | null): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  const clean = dateStr.trim();
  // Formato: "07/abr/21 3:49 PM" ou "07/abr/2021 15:49"
  const match = clean.match(/^(\d{1,2})\/([a-z]{3})\/(\d{2,4})/i);
  if (match) {
    const day = match[1].padStart(2, '0');
    const monthStr = match[2].toLowerCase();
    const month = PT_MONTHS[monthStr] || '01';
    let year = match[3];
    if (year.length === 2) {
      year = Number(year) > 70 ? `19${year}` : `20${year}`;
    }
    const iso = `${year}-${month}-${day}T12:00:00Z`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(clean);
  return isNaN(fallback.getTime()) ? null : fallback;
}

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

export interface ImportOptions {
  limit?: number;
  projectKeyOverride?: string;
  projectNameOverride?: string;
  clearExisting?: boolean;
  defaultOwnerId: string;
}

export interface ImportStats {
  totalRowsRead: number;
  projectsCreatedOrFound: number;
  tasksDeleted: number;
  tasksCreated: number;
  tasksUpdated: number;
  commentsCreated: number;
  usersCreatedOrFound: number;
}

export async function importJiraCSV(
  filePath: string,
  options: ImportOptions
): Promise<ImportStats> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado no caminho: ${filePath}`);
  }
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  return importJiraFromStream(fileStream, options);
}

export async function importJiraCSVContent(
  csvContent: string,
  options: ImportOptions
): Promise<ImportStats> {
  const stream = Readable.from([csvContent]);
  return importJiraFromStream(stream, options);
}

export async function importJiraFromStream(
  inputStream: NodeJS.ReadableStream,
  options: ImportOptions
): Promise<ImportStats> {
  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let isFirstLine = true;

  // Caches em memória para performance máxima durante o batch
  const userMap = new Map<string, string>(); // Name -> User.id
  const projectMap = new Map<string, string>(); // ProjectKey -> Project.id
  const projectColumnsMap = new Map<string, Set<string>>(); // ProjectKey -> Set de status
  const clearedProjects = new Set<string>();

  const stats: ImportStats = {
    totalRowsRead: 0,
    projectsCreatedOrFound: 0,
    tasksDeleted: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    commentsCreated: 0,
    usersCreatedOrFound: 0,
  };

  async function getOrCreateUser(rawName: string | null | undefined): Promise<string | null> {
    if (!rawName || !rawName.trim()) return null;
    const name = rawName.trim();
    if (userMap.has(name)) return userMap.get(name)!;

    const emailSlug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '.');
    const email = `${emailSlug || 'usuario'}@jira.import`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name,
        password: '$2a$10$demohashedpasswordsaltedforimportedusers...',
        avatarColor: '#0052cc',
        role: 'MEMBER',
      },
    });

    userMap.set(name, user.id);
    stats.usersCreatedOrFound++;
    return user.id;
  }

  let headerIndexMap: Record<string, number> = {};
  let commentColIndices: number[] = [];
  let sprintColIndices: number[] = [];
  let labelColIndices: number[] = [];

  const limit = options.limit && options.limit > 0 ? options.limit : Infinity;
  let multiLineBuffer = '';
  let stopped = false;

  async function processLine(rawLine: string): Promise<void> {
    if (stopped) return;

    if (isFirstLine) {
      headers = parseCSVLine(rawLine);
      headerIndexMap = {};
      commentColIndices = [];
      sprintColIndices = [];
      labelColIndices = [];

      headers.forEach((h, idx) => {
        const clean = h.replace(/^\uFEFF/, '').trim();
        if (!(clean in headerIndexMap)) {
          headerIndexMap[clean] = idx;
        }
        if (clean === 'Comentar') {
          commentColIndices.push(idx);
        }
        if (clean.toLowerCase().includes('sprint')) {
          sprintColIndices.push(idx);
        }
        if (clean.toLowerCase() === 'categorias' || clean.toLowerCase() === 'labels') {
          labelColIndices.push(idx);
        }
      });

      isFirstLine = false;
      return;
    }

    if (multiLineBuffer) {
      multiLineBuffer += '\n' + rawLine;
    } else {
      multiLineBuffer = rawLine;
    }

    const quoteCount = (multiLineBuffer.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      return;
    }

    const currentLine = multiLineBuffer;
    multiLineBuffer = '';

    if (stats.totalRowsRead >= limit) {
      stopped = true;
      rl.close();
      return;
    }

    stats.totalRowsRead++;

    const row = parseCSVLine(currentLine);

    const getVal = (colName: string): string => {
      const idx = headerIndexMap[colName];
      return idx !== undefined && idx < row.length ? row[idx].trim() : '';
    };

    const title = getVal('Resumo');
    if (!title) return;

    const issueKey = getVal('Chave da item');
    const projectKey =
      options.projectKeyOverride || getVal('Chave do projeto') || (issueKey ? issueKey.split('-')[0] : 'PRJ');
    const projectName =
      options.projectNameOverride || getVal('Nome do projeto') || `Projeto ${projectKey}`;
    const projectDesc = getVal('Descrição do projeto') || null;

    let projectId = projectMap.get(projectKey);
    if (!projectId) {
      let existingProj = await prisma.project.findUnique({ where: { key: projectKey } });
      if (!existingProj) {
        existingProj = await prisma.project.create({
          data: {
            key: projectKey,
            name: projectName,
            description: projectDesc,
            category: 'SOFTWARE',
            ownerId: options.defaultOwnerId,
          },
        });
        stats.projectsCreatedOrFound++;
      }
      projectId = existingProj.id;
      projectMap.set(projectKey, projectId);
      projectColumnsMap.set(projectKey, new Set<string>());
    }

    if (options.clearExisting && !clearedProjects.has(projectId)) {
      const deleted = await prisma.task.deleteMany({ where: { projectId } });
      stats.tasksDeleted += deleted.count;
      clearedProjects.add(projectId);
    }

    const status = normalizeJiraStatus(getVal('Status'));
    projectColumnsMap.get(projectKey)?.add(status);

    const rawType = getVal('Tipo de item');
    let type = 'TASK';
    const typeLower = rawType.toLowerCase();
    if (typeLower.includes('bug') || typeLower.includes('defeito')) type = 'BUG';
    else if (typeLower.includes('história') || typeLower.includes('story')) type = 'STORY';
    else if (typeLower.includes('epic') || typeLower.includes('épico')) type = 'EPIC';
    else if (typeLower.includes('subtarefa')) type = 'TASK';

    const rawPriority = getVal('Prioridade');
    let priority = 'MEDIUM';
    const prioLower = rawPriority.toLowerCase();
    if (prioLower.includes('gravíssima') || prioLower.includes('urgente') || prioLower.includes('crítica')) {
      priority = 'URGENT';
    } else if (prioLower.includes('high') || prioLower.includes('alta')) {
      priority = 'HIGH';
    } else if (prioLower.includes('low') || prioLower.includes('baixa')) {
      priority = 'LOW';
    }

    const description = getVal('Descrição') || null;
    const environment = getVal('Ambiente') || getVal('Campo personalizado (Ambiente)') || null;
    const components = getVal('Componentes') || null;
    const rawParentKey = getVal('Chave pai') || getVal('Pai');
    const parentKey = rawParentKey ? rawParentKey.trim().toUpperCase() : null;
    const resolution = getVal('Resolução') || null;

    let sprintVal: string | null = null;
    for (const sIdx of sprintColIndices) {
      if (row[sIdx] && row[sIdx].trim()) {
        sprintVal = row[sIdx].trim();
        break;
      }
    }
    if (!sprintVal) {
      sprintVal =
        getVal('Campo personalizado (Quarter de Entrega)') ||
        getVal('Campo personalizado (Quarter Previsto de Entrega)') ||
        null;
    }

    const ptsRaw =
      getVal('Campo personalizado (Story Points)') || getVal('Campo personalizado (Story point estimate)');
    const storyPoints = ptsRaw && !isNaN(Number(ptsRaw)) ? Math.round(Number(ptsRaw)) : null;

    const labelsFound: string[] = [];
    for (const lIdx of labelColIndices) {
      if (row[lIdx] && row[lIdx].trim()) {
        labelsFound.push(row[lIdx].trim());
      }
    }
    const labels = labelsFound.length > 0 ? labelsFound.join(',') : null;

    const dueDate =
      parseJiraDate(getVal('Data de entrega')) ||
      parseJiraDate(getVal('Campo personalizado (Data de Entrega Replanejada)')) ||
      parseJiraDate(getVal('Campo personalizado (Data de Entrega Planejada)'));

    const assigneeName = getVal('Responsável');
    const reporterName = getVal('Relator') || getVal('Criador');

    const assigneeId = await getOrCreateUser(assigneeName);
    const reporterId = (await getOrCreateUser(reporterName)) || options.defaultOwnerId;

    let createdOrUpdatedTask;
    if (issueKey) {
      const existingTask = await prisma.task.findFirst({
        where: { key: issueKey, projectId },
      });
      if (existingTask) {
        createdOrUpdatedTask = await prisma.task.update({
          where: { id: existingTask.id },
          data: {
            title,
            description,
            status,
            priority,
            type,
            storyPoints,
            sprint: sprintVal,
            labels,
            environment,
            components,
            parentKey,
            resolution,
            dueDate,
            assigneeId,
            reporterId,
          },
        });
        stats.tasksUpdated++;
      }
    }

    if (!createdOrUpdatedTask) {
      createdOrUpdatedTask = await prisma.task.create({
        data: {
          key: issueKey || undefined,
          title,
          description,
          status,
          priority,
          type,
          storyPoints,
          sprint: sprintVal,
          labels,
          environment,
          components,
          parentKey,
          resolution,
          dueDate,
          projectId,
          assigneeId,
          reporterId,
        },
      });
      stats.tasksCreated++;
    }

    for (const cIdx of commentColIndices) {
      const commentRaw = row[cIdx];
      if (!commentRaw || !commentRaw.trim()) continue;

      const parts = commentRaw.split(';');
      let commentContent = commentRaw;
      let authorName: string | null = null;
      if (parts.length >= 3) {
        authorName = parts[1].trim();
        commentContent = parts.slice(2).join(';').trim();
      }

      if (commentContent) {
        const commentAuthorId = (await getOrCreateUser(authorName)) || options.defaultOwnerId;
        await prisma.comment.create({
          data: {
            content: commentContent,
            taskId: createdOrUpdatedTask.id,
            authorId: commentAuthorId,
          },
        });
        stats.commentsCreated++;
      }
    }
  }

  // Processa linhas sequencialmente preservando ordem e aguardando o término completo antes de resolver
  await new Promise<void>((resolve, reject) => {
    let chain = Promise.resolve();
    let failed = false;

    rl.on('line', (rawLine: string) => {
      if (failed || stopped) return;
      chain = chain.then(() => processLine(rawLine)).catch((err) => {
        failed = true;
        rl.close();
        reject(err);
      });
    });

    rl.on('close', () => {
      chain.then(() => {
        if (!failed) resolve();
      }).catch((err) => {
        if (!failed) reject(err);
      });
    });

    rl.on('error', (err: Error) => {
      failed = true;
      reject(err);
    });
  });

  // Atualiza as colunas personalizadas do projeto com os status descobertos no CSV
  for (const [projKey, statusSet] of projectColumnsMap.entries()) {
    const projId = projectMap.get(projKey);
    if (!projId || statusSet.size === 0) continue;

    const existingProject = await prisma.project.findUnique({ where: { id: projId } });
    if (existingProject) {
      let currentCols: Array<{ id: string; title: string }> = [];
      try {
        if (existingProject.columns) {
          currentCols = JSON.parse(existingProject.columns);
        }
      } catch {
        currentCols = [];
      }

      const existingColIds = new Set(currentCols.map((c) => c.id));
      for (const st of statusSet) {
        if (!existingColIds.has(st)) {
          const title = st
            .split('_')
            .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
            .join(' ');
          currentCols.push({ id: st, title });
        }
      }

      await prisma.project.update({
        where: { id: projId },
        data: { columns: JSON.stringify(currentCols) },
      });
    }
  }

  return stats;
}
