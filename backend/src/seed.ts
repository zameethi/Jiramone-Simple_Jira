import bcrypt from 'bcryptjs';
import prisma from './lib/prisma';

export async function ensureDemoData() {
  const passwordHash = await bcrypt.hash('demo123', 10);

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@jiramone.dev' },
    update: {},
    create: {
      email: 'demo@jiramone.dev',
      name: 'Alex Rivera (Tech Lead)',
      password: passwordHash,
      avatarColor: '#0052CC',
      role: 'ADMIN',
    },
  });

  const devUser = await prisma.user.upsert({
    where: { email: 'bia@jiramone.dev' },
    update: {},
    create: {
      email: 'bia@jiramone.dev',
      name: 'Beatriz Costa (Fullstack)',
      password: passwordHash,
      avatarColor: '#00875A',
      role: 'MEMBER',
    },
  });

  const qaUser = await prisma.user.upsert({
    where: { email: 'carlos@jiramone.dev' },
    update: {},
    create: {
      email: 'carlos@jiramone.dev',
      name: 'Carlos Mendes (Product & QA)',
      password: passwordHash,
      avatarColor: '#6554C0',
      role: 'MEMBER',
    },
  });

  const existingProjects = await prisma.project.count();
  if (existingProjects === 0) {
    const coreProject = await prisma.project.create({
      data: {
        key: 'JIR',
        name: 'Jiramone Core Platform',
        description: 'Plataforma principal de gestão ágil de projetos, sprints, backlog e quadros Kanban.',
        category: 'SOFTWARE',
        ownerId: demoUser.id,
      },
    });

    const mobileProject = await prisma.project.create({
      data: {
        key: 'MOB',
        name: 'App Mobile & Notificações',
        description: 'Aplicativo móvel iOS/Android com notificações push em tempo real para os times.',
        category: 'SOFTWARE',
        ownerId: devUser.id,
      },
    });

    const tasksData = [
      {
        key: 'JIR-1',
        title: 'Estruturar autenticação JWT e proteção de rotas na API',
        description: 'Implementar endpoints de registro, login, validação de sessão via token Bearer e rate-limiting contra força bruta.',
        status: 'DONE',
        priority: 'HIGH',
        type: 'STORY',
        storyPoints: 5,
        sprint: 'Sprint 14',
        labels: 'backend,security,auth',
        projectId: coreProject.id,
        assigneeId: demoUser.id,
        reporterId: demoUser.id,
      },
      {
        key: 'JIR-2',
        title: 'Modelagem Prisma para Projetos, Issues e Comentários',
        description: 'Definir schema relacional no PostgreSQL com suporte a tipos de item (Story, Task, Bug, Epic), prioridades e story points.',
        status: 'DONE',
        priority: 'HIGH',
        type: 'TASK',
        storyPoints: 3,
        sprint: 'Sprint 14',
        labels: 'database,prisma',
        projectId: coreProject.id,
        assigneeId: devUser.id,
        reporterId: demoUser.id,
      },
      {
        key: 'JIR-3',
        title: 'Quadro Kanban interativo com suporte a Drag and Drop',
        description: 'Permitir arrastar cartões entre Backlog, A Fazer, Em Progresso, Em Revisão e Concluído atualizando o status instantaneamente.',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        type: 'STORY',
        storyPoints: 8,
        sprint: 'Sprint 14',
        labels: 'frontend,kanban,ux',
        projectId: coreProject.id,
        assigneeId: devUser.id,
        reporterId: demoUser.id,
      },
      {
        key: 'JIR-4',
        title: 'Corrigir filtro combinado de busca por responsável e prioridade',
        description: 'Ao selecionar simultaneamente um membro da equipe e a prioridade Urgente, a listagem do backlog precisa manter a ordenação.',
        status: 'IN_REVIEW',
        priority: 'HIGH',
        type: 'BUG',
        storyPoints: 2,
        sprint: 'Sprint 14',
        labels: 'bug,filters',
        projectId: coreProject.id,
        assigneeId: qaUser.id,
        reporterId: qaUser.id,
      },
      {
        key: 'JIR-5',
        title: 'Modal de detalhes da Issue com thread de comentários',
        description: 'Exibir detalhes completos da tarefa, edição rápida de status, story points, responsável e histórico de comentários do time.',
        status: 'TODO',
        priority: 'MEDIUM',
        type: 'STORY',
        storyPoints: 5,
        sprint: 'Sprint 14',
        labels: 'frontend,collaboration',
        projectId: coreProject.id,
        assigneeId: demoUser.id,
        reporterId: devUser.id,
      },
      {
        key: 'JIR-6',
        title: 'Dashboard de métricas de Sprint e Velocity do projeto',
        description: 'Criar visão geral com distribuição de tarefas por status, prioridade, tipos de item e progresso de Story Points concluídos.',
        status: 'TODO',
        priority: 'MEDIUM',
        type: 'EPIC',
        storyPoints: 8,
        sprint: 'Sprint 15',
        labels: 'analytics,dashboard',
        projectId: coreProject.id,
        assigneeId: qaUser.id,
        reporterId: demoUser.id,
      },
      {
        key: 'JIR-7',
        title: 'Exportação de relatórios de Sprint em CSV/JSON',
        description: 'Adicionar opção para gestores exportarem os itens concluídos da sprint para análise externa.',
        status: 'BACKLOG',
        priority: 'LOW',
        type: 'TASK',
        storyPoints: 3,
        sprint: 'Sprint 15',
        labels: 'export,reporting',
        projectId: coreProject.id,
        assigneeId: null,
        reporterId: qaUser.id,
      },
      {
        key: 'MOB-1',
        title: 'Configurar pipeline de push notifications via Firebase',
        description: 'Enviar alerta quando um usuário for mencionado em um comentário ou tiver uma issue atribuída.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        type: 'STORY',
        storyPoints: 5,
        sprint: 'Sprint 14',
        labels: 'mobile,notifications',
        projectId: mobileProject.id,
        assigneeId: devUser.id,
        reporterId: demoUser.id,
      },
      {
        key: 'MOB-2',
        title: 'Modo offline para visualização de tarefas atribuídas',
        description: 'Sincronizar cache local no dispositivo quando a conexão for restabelecida.',
        status: 'BACKLOG',
        priority: 'MEDIUM',
        type: 'EPIC',
        storyPoints: 13,
        sprint: 'Sprint 15',
        labels: 'mobile,offline',
        projectId: mobileProject.id,
        assigneeId: demoUser.id,
        reporterId: devUser.id,
      },
    ];

    for (const item of tasksData) {
      const createdTask = await prisma.task.create({ data: item });
      if (item.key === 'JIR-3') {
        await prisma.comment.createMany({
          data: [
            {
              content: 'Implementei as colunas principais e os indicadores de Story Points em cada card.',
              taskId: createdTask.id,
              authorId: devUser.id,
            },
            {
              content: 'Excelente! Vamos garantir também que dê para mudar o status direto no modal para acessibilidade.',
              taskId: createdTask.id,
              authorId: demoUser.id,
            },
          ],
        });
      }
    }
  }

  return demoUser;
}
