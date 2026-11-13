import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest, optionalAuth } from '../middleware/auth';

const router = Router();

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const VALID_TYPES = ['TASK', 'BUG', 'STORY', 'EPIC'];

export function parseStoryPoints(value: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > 100) {
    return { ok: false, error: 'Story Points deve ser um número inteiro entre 0 e 100.' };
  }
  return { ok: true, value: num };
}

export function parseDueDate(value: unknown): { ok: true; value: Date | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'Data de entrega inválida.' };
  }
  return { ok: true, value: date };
}

async function generateNextIssueKey(projectId: string, projectKey: string): Promise<string> {
  const existingTasks = await prisma.task.findMany({
    where: { projectId },
    select: { key: true },
  });
  let maxNumber = 0;
  const prefix = `${projectKey}-`;
  for (const t of existingTasks) {
    if (t.key && t.key.startsWith(prefix)) {
      const num = Number.parseInt(t.key.slice(prefix.length), 10);
      if (!Number.isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }
  return `${projectKey}-${maxNumber + 1}`;
}

router.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, status, priority, type, assigneeId, sprint, search } = req.query;

    const where: Record<string, unknown> = {};

    if (projectId) where.projectId = String(projectId);
    if (status) where.status = String(status).toUpperCase();
    if (priority) where.priority = String(priority).toUpperCase();
    if (type) where.type = String(type).toUpperCase();
    if (assigneeId) {
      where.assigneeId = assigneeId === 'UNASSIGNED' ? null : String(assigneeId);
    }
    if (sprint) where.sprint = String(sprint);

    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { key: { contains: q, mode: 'insensitive' } },
        { labels: { contains: q, mode: 'insensitive' } },
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        project: {
          select: { id: true, key: true, name: true },
        },
        assignee: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
        reporter: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
        _count: {
          select: { comments: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    res.json(tasks);
  } catch (error) {
    console.error('Erro ao listar tarefas:', error);
    res.status(500).json({ error: 'Erro ao listar tarefas.' });
  }
});

router.get('/:id', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const task = await prisma.task.findFirst({
      where: {
        OR: [{ id }, { key: id.toUpperCase() }],
      },
      include: {
        project: {
          select: { id: true, key: true, name: true },
        },
        assignee: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
        reporter: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
        comments: {
          include: {
            author: {
              select: { id: true, name: true, email: true, avatarColor: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!task) {
      res.status(404).json({ error: 'Tarefa não encontrada.' });
      return;
    }

    res.json(task);
  } catch (error) {
    console.error('Erro ao buscar tarefa:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes da tarefa.' });
  }
});

router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const {
      title,
      description,
      status,
      priority,
      type,
      storyPoints,
      sprint,
      labels,
      environment,
      components,
      parentKey,
      resolution,
      dueDate,
      projectId,
      assigneeId,
    } = req.body;

    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'O título da tarefa é obrigatório.' });
      return;
    }

    if (!projectId) {
      res.status(400).json({ error: 'O ID do projeto (projectId) é obrigatório.' });
      return;
    }

    const project = await prisma.project.findUnique({ where: { id: String(projectId) } });
    if (!project) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }

    const parsedPoints = parseStoryPoints(storyPoints);
    if (!parsedPoints.ok) {
      res.status(400).json({ error: parsedPoints.error });
      return;
    }

    const parsedDueDate = parseDueDate(dueDate);
    if (!parsedDueDate.ok) {
      res.status(400).json({ error: parsedDueDate.error });
      return;
    }

    const issueKey = await generateNextIssueKey(project.id, project.key);

    const normalizedStatus =
      status && String(status).trim()
        ? String(status).trim().toUpperCase()
        : 'TODO';
    const normalizedPriority =
      priority && VALID_PRIORITIES.includes(String(priority).toUpperCase())
        ? String(priority).toUpperCase()
        : 'MEDIUM';
    const normalizedType =
      type && VALID_TYPES.includes(String(type).toUpperCase())
        ? String(type).toUpperCase()
        : 'TASK';

    const task = await prisma.task.create({
      data: {
        key: issueKey,
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        status: normalizedStatus,
        priority: normalizedPriority,
        type: normalizedType,
        storyPoints: parsedPoints.value,
        sprint: sprint ? String(sprint).trim() : null,
        labels: labels ? String(labels).trim() : null,
        environment: environment ? String(environment).trim() : null,
        components: components ? String(components).trim() : null,
        parentKey: parentKey ? String(parentKey).trim().toUpperCase() : null,
        resolution: resolution ? String(resolution).trim() : null,
        dueDate: parsedDueDate.value,
        projectId: project.id,
        assigneeId: assigneeId ? String(assigneeId) : null,
        reporterId: req.user!.userId,
      },
      include: {
        project: { select: { id: true, key: true, name: true } },
        assignee: { select: { id: true, name: true, email: true, avatarColor: true } },
        reporter: { select: { id: true, name: true, email: true, avatarColor: true } },
        _count: { select: { comments: true } },
      },
    });

    res.status(201).json(task);
  } catch (error) {
    console.error('Erro ao criar tarefa:', error);
    res.status(500).json({ error: 'Erro ao criar tarefa.' });
  }
});

async function updateTaskHandler(req: AuthRequest, res: Response) {
  try {
    const id = String(req.params.id);
    const {
      title,
      description,
      status,
      priority,
      type,
      storyPoints,
      sprint,
      labels,
      environment,
      components,
      parentKey,
      resolution,
      dueDate,
      assigneeId,
    } = req.body;

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Tarefa não encontrada.' });
      return;
    }

    if (title !== undefined && !String(title).trim()) {
      res.status(400).json({ error: 'O título da tarefa não pode ser vazio.' });
      return;
    }

    let nextStoryPoints: number | null | undefined;
    if (storyPoints !== undefined) {
      const parsedPoints = parseStoryPoints(storyPoints);
      if (!parsedPoints.ok) {
        res.status(400).json({ error: parsedPoints.error });
        return;
      }
      nextStoryPoints = parsedPoints.value;
    }

    let nextDueDate: Date | null | undefined;
    if (dueDate !== undefined) {
      const parsedDueDate = parseDueDate(dueDate);
      if (!parsedDueDate.ok) {
        res.status(400).json({ error: parsedDueDate.error });
        return;
      }
      nextDueDate = parsedDueDate.value;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: String(title).trim() } : {}),
        ...(description !== undefined
          ? { description: description ? String(description).trim() : null }
          : {}),
        ...(status !== undefined && String(status).trim()
          ? { status: String(status).trim().toUpperCase() }
          : {}),
        ...(priority !== undefined && VALID_PRIORITIES.includes(String(priority).toUpperCase())
          ? { priority: String(priority).toUpperCase() }
          : {}),
        ...(type !== undefined && VALID_TYPES.includes(String(type).toUpperCase())
          ? { type: String(type).toUpperCase() }
          : {}),
        ...(nextStoryPoints !== undefined ? { storyPoints: nextStoryPoints } : {}),
        ...(sprint !== undefined ? { sprint: sprint ? String(sprint).trim() : null } : {}),
        ...(labels !== undefined ? { labels: labels ? String(labels).trim() : null } : {}),
        ...(environment !== undefined ? { environment: environment ? String(environment).trim() : null } : {}),
        ...(components !== undefined ? { components: components ? String(components).trim() : null } : {}),
        ...(parentKey !== undefined ? { parentKey: parentKey ? String(parentKey).trim().toUpperCase() : null } : {}),
        ...(resolution !== undefined ? { resolution: resolution ? String(resolution).trim() : null } : {}),
        ...(nextDueDate !== undefined ? { dueDate: nextDueDate } : {}),
        ...(assigneeId !== undefined
          ? { assigneeId: assigneeId ? String(assigneeId) : null }
          : {}),
      },
      include: {
        project: { select: { id: true, key: true, name: true } },
        assignee: { select: { id: true, name: true, email: true, avatarColor: true } },
        reporter: { select: { id: true, name: true, email: true, avatarColor: true } },
        _count: { select: { comments: true } },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar tarefa:', error);
    res.status(500).json({ error: 'Erro ao atualizar tarefa.' });
  }
}

router.patch('/:id', authenticateToken, updateTaskHandler);
router.put('/:id', authenticateToken, updateTaskHandler);

router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Tarefa não encontrada.' });
      return;
    }

    await prisma.task.delete({ where: { id } });
    res.json({ message: 'Tarefa excluída com sucesso.' });
  } catch (error) {
    console.error('Erro ao excluir tarefa:', error);
    res.status(500).json({ error: 'Erro ao excluir tarefa.' });
  }
});

router.get('/:id/comments', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const taskId = String(req.params.id);
    const comments = await prisma.comment.findMany({
      where: { taskId },
      include: {
        author: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(comments);
  } catch (error) {
    console.error('Erro ao listar comentários:', error);
    res.status(500).json({ error: 'Erro ao listar comentários.' });
  }
});

router.post('/:id/comments', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const taskId = String(req.params.id);
    const { content } = req.body;

    if (!content || !String(content).trim()) {
      res.status(400).json({ error: 'O conteúdo do comentário é obrigatório.' });
      return;
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      res.status(404).json({ error: 'Tarefa não encontrada.' });
      return;
    }

    const comment = await prisma.comment.create({
      data: {
        content: String(content).trim(),
        taskId,
        authorId: req.user!.userId,
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
      },
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error('Erro ao adicionar comentário:', error);
    res.status(500).json({ error: 'Erro ao adicionar comentário.' });
  }
});

router.delete(
  '/:taskId/comments/:commentId',
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const taskId = String(req.params.taskId);
      const commentId = String(req.params.commentId);
      const existing = await prisma.comment.findUnique({ where: { id: commentId } });
      if (!existing || existing.taskId !== taskId) {
        res.status(404).json({ error: 'Comentário não encontrado.' });
        return;
      }

      if (existing.authorId !== req.user!.userId) {
        res.status(403).json({ error: 'Você só pode excluir seus próprios comentários.' });
        return;
      }

      await prisma.comment.delete({ where: { id: commentId } });
      res.json({ message: 'Comentário removido com sucesso.' });
    } catch (error) {
      console.error('Erro ao excluir comentário:', error);
      res.status(500).json({ error: 'Erro ao excluir comentário.' });
    }
  }
);

export default router;
