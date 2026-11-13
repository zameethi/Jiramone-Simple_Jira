import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest, optionalAuth } from '../middleware/auth';

const router = Router();

export function generateProjectKey(name: string): string {
  const words = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length >= 2) {
    return words
      .slice(0, 4)
      .map((w) => w[0])
      .join('');
  }
  const single = words[0] || 'PRJ';
  return single.substring(0, 4).padEnd(3, 'X');
}

router.get('/', optionalAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const projects = await prisma.project.findMany({
      include: {
        owner: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
        tasks: {
          select: { id: true, status: true, priority: true, type: true, storyPoints: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formatted = projects.map((project) => {
      const totalTasks = project.tasks.length;
      const doneTasks = project.tasks.filter((t) => t.status === 'DONE').length;
      const inProgressTasks = project.tasks.filter((t) => t.status === 'IN_PROGRESS').length;
      const totalPoints = project.tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
      const donePoints = project.tasks
        .filter((t) => t.status === 'DONE')
        .reduce((sum, t) => sum + (t.storyPoints || 0), 0);

      return {
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        category: project.category,
        columns: project.columns,
        ownerId: project.ownerId,
        owner: project.owner,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        stats: {
          totalTasks,
          doneTasks,
          inProgressTasks,
          completionRate: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
          totalPoints,
          donePoints,
        },
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error('Erro ao listar projetos:', error);
    res.status(500).json({ error: 'Erro ao listar projetos.' });
  }
});

router.get('/:id', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const project = await prisma.project.findFirst({
      where: {
        OR: [{ id }, { key: id.toUpperCase() }],
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
        tasks: {
          include: {
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
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }

    res.json(project);
  } catch (error) {
    console.error('Erro ao buscar projeto:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes do projeto.' });
  }
});

router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, key, category } = req.body;

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'O nome do projeto é obrigatório.' });
      return;
    }

    let projectKey = key
      ? String(key)
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .substring(0, 6)
      : generateProjectKey(String(name));

    if (!projectKey) {
      projectKey = 'PRJ';
    }

    const existingKey = await prisma.project.findUnique({ where: { key: projectKey } });
    if (existingKey) {
      projectKey = `${projectKey}${Math.floor(10 + Math.random() * 90)}`;
    }

    const project = await prisma.project.create({
      data: {
        key: projectKey,
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        category: category ? String(category).toUpperCase() : 'SOFTWARE',
        ownerId: req.user!.userId,
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
      },
    });

    res.status(201).json(project);
  } catch (error) {
    console.error('Erro ao criar projeto:', error);
    res.status(500).json({ error: 'Erro ao criar projeto.' });
  }
});

export function parseValidColumns(columns: unknown): string | null {
  let parsed: unknown = columns;
  if (typeof columns === 'string') {
    try {
      parsed = JSON.parse(columns);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null;
  }
  const normalized = parsed.map((col) => {
    if (!col || typeof col !== 'object') return null;
    const id = String((col as Record<string, unknown>).id || '').trim();
    const title = String((col as Record<string, unknown>).title || '').trim();
    if (!id || !title) return null;
    return { id, title };
  });
  if (normalized.some((c) => c === null)) {
    return null;
  }
  return JSON.stringify(normalized);
}

async function updateProjectHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const { name, description, category, key, columns } = req.body;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }

    if (name !== undefined && !String(name).trim()) {
      res.status(400).json({ error: 'O nome do projeto não pode ser vazio.' });
      return;
    }

    let serializedColumns: string | undefined;
    if (columns !== undefined) {
      const valid = parseValidColumns(columns);
      if (!valid) {
        res.status(400).json({ error: 'Formato inválido para colunas do projeto.' });
        return;
      }
      serializedColumns = valid;
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(description !== undefined
          ? { description: description ? String(description).trim() : null }
          : {}),
        ...(category !== undefined ? { category: String(category).toUpperCase() } : {}),
        ...(key !== undefined ? { key: String(key).trim().toUpperCase() } : {}),
        ...(serializedColumns !== undefined ? { columns: serializedColumns } : {}),
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true, avatarColor: true },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar projeto:', error);
    res.status(500).json({ error: 'Erro ao atualizar projeto.' });
  }
}

router.patch('/:id', authenticateToken, updateProjectHandler);
router.put('/:id', authenticateToken, updateProjectHandler);

router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }

    // Permite excluir se for o dono ou se for ADMIN, ou usuário autenticado da workspace
    await prisma.project.delete({ where: { id } });
    res.json({ message: 'Projeto e todas as suas issues foram excluídos com sucesso.' });
  } catch (error) {
    console.error('Erro ao excluir projeto:', error);
    res.status(500).json({ error: 'Erro ao excluir projeto.' });
  }
});

export default router;
