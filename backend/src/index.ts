import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import prisma from './lib/prisma';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import taskRoutes from './routes/tasks';
import dashboardRoutes from './routes/dashboard';
import importRoutes from './routes/import';
import { ensureDemoData } from './seed';

const app = express();
const PORT = Number(process.env.PORT || process.env.BACKEND_PORT || 3000);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Jiramone API - Jira Clone Project Manager',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      projects: '/api/projects',
      tasks: '/api/tasks',
      dashboard: '/api/dashboard/stats',
    },
  });
});

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Database connection error',
    });
  }
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/import', importRoutes);

app.get('/api/users', async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        avatarColor: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

app.post('/api/seed', async (_req: Request, res: Response) => {
  try {
    const demoUser = await ensureDemoData();
    res.json({ message: 'Dados de demonstração garantidos com sucesso!', demoUser: demoUser.email });
  } catch (error) {
    console.error('Erro ao executar seed:', error);
    res.status(500).json({ error: 'Erro ao popular dados de demonstração.' });
  }
});

app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof SyntaxError && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
    return;
  }
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`Backend Jiramone rodando na porta ${PORT}`);
    try {
      await ensureDemoData();
      console.log('Dados iniciais de demonstração verificados com sucesso.');
    } catch (err) {
      console.warn('Aviso: Não foi possível inicializar seed automático na partida:', err);
    }
  });
}

export default app;
