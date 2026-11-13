import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, optionalAuth } from '../middleware/auth';

const router = Router();

router.get('/stats', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
    const whereTask = projectId ? { projectId } : {};

    const [totalProjects, totalUsers, tasks, recentComments] = await Promise.all([
      prisma.project.count(),
      prisma.user.count(),
      prisma.task.findMany({
        where: whereTask,
        include: {
          project: { select: { id: true, key: true, name: true } },
          assignee: { select: { id: true, name: true, avatarColor: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.comment.findMany({
        where: projectId ? { task: { projectId } } : {},
        include: {
          author: { select: { id: true, name: true, avatarColor: true } },
          task: { select: { id: true, key: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    const byStatus: Record<string, number> = {
      BACKLOG: 0,
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
    };

    const byPriority: Record<string, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      URGENT: 0,
    };

    const byType: Record<string, number> = {
      STORY: 0,
      TASK: 0,
      BUG: 0,
      EPIC: 0,
    };

    let totalStoryPoints = 0;
    let completedStoryPoints = 0;

    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      byType[t.type] = (byType[t.type] || 0) + 1;

      const pts = t.storyPoints || 0;
      totalStoryPoints += pts;
      if (t.status === 'DONE') {
        completedStoryPoints += pts;
      }
    }

    const totalTasks = tasks.length;
    const completionRate =
      totalTasks > 0 ? Math.round(((byStatus.DONE || 0) / totalTasks) * 100) : 0;

    res.json({
      totalProjects,
      totalUsers,
      totalTasks,
      completionRate,
      storyPoints: {
        total: totalStoryPoints,
        completed: completedStoryPoints,
      },
      byStatus,
      byPriority,
      byType,
      recentTasks: tasks.slice(0, 6),
      recentComments,
    });
  } catch (error) {
    console.error('Erro ao buscar métricas do dashboard:', error);
    res.status(500).json({ error: 'Erro ao calcular estatísticas do dashboard.' });
  }
});

export default router;
