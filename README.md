# Jiramone — Gerenciador de Projetos Ágil (Jira Clone)

O **Jiramone** é uma plataforma de gerenciamento ágil de projetos inspirada na experiência do **Jira Software**, oferecendo Quadros Kanban interativos com suporte a Drag & Drop, Backlog com estimativas de Story Points, Gestão de Sprints, Comentários por Issue e Painel de Métricas e Velocidade.

---

## 🚀 Como Rodar o Projeto

A forma mais simples e recomendada de executar todo o ecossistema (PostgreSQL + API Backend + Interface Web) é utilizando **Docker Compose**.

### 1. Pré-requisitos
- [Docker](https://docs.docker.com/get-docker/) e [Docker Compose](https://docs.docker.com/compose/) instalados na sua máquina.

### 2. Subindo a Aplicação via Docker (Recomendado)

Na raiz do projeto (`teste-opencode`), execute:

```bash
docker compose up --build -d
```

Esse comando irá:
1. Subir o banco de dados **PostgreSQL 15** na porta `5432`.
2. Aguardar o banco ficar saudável (`healthy`).
3. Construir o container do **Backend** (Node 20 / TypeScript / Prisma), sincronizar as migrações no banco e iniciar na porta `3000`.
4. Popular automaticamente o banco de dados com dados de demonstração (Projetos, Sprints, Issues e Usuários).
5. Construir e iniciar o container do **Frontend** na porta `3001`.

### 3. Acessando a Aplicação

- **Interface Web (Frontend)**: [http://localhost:3001](http://localhost:3001)
- **API REST (Backend)**: [http://localhost:3000](http://localhost:3000)
- **Healthcheck da API**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

> **💡 Dica de Acesso Rápido**:  
> No canto inferior esquerdo do frontend, clique em **"Entrar / Demo"** e selecione o botão verde **"⚡ Entrar com Conta Demo (1-Clique)"** para logar imediatamente sem precisar digitar senha.

---

## 🛠️ Como Rodar em Modo Desenvolvimento (Sem Docker)

Se preferir rodar os serviços separadamente na sua máquina:

### 1. Subir apenas o PostgreSQL
```bash
docker compose up db -d
```

### 2. Configurar e rodar o Backend
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run start:dev
```
A API estará rodando em `http://localhost:3000`.

### 3. Configurar e rodar o Frontend
Em outro terminal:
```bash
cd frontend
npm start
```
A interface estará disponível em `http://localhost:3001`.

---

## 📌 Funcionalidades Implementadas

- **Quadro Kanban Interativo & Customizável**:
  - Colunas padrão: *Backlog*, *A Fazer*, *Em Progresso*, *Em Revisão* e *Concluído*.
  - **Customização Total de Colunas**: Adicione novas colunas (ex: *Code Review*, *QA/Homologação*, *Bloqueado*), reordene para esquerda/direita e remova colunas pelo botão **"⚙️ Gerenciar Colunas"**.
  - Arrastar e soltar cartões (**Drag and Drop**) com sincronização imediata no backend.
  - Indicadores de tipo de issue (Story, Task, Bug, Epic), prioridade (Urgente, Alta, Média, Baixa) e Story Points.
- **Backlog & Visão em Lista**:
  - Tabela organizada com detalhes de sprints, pontuação e responsáveis.
- **Painel de Métricas & Velocity**:
  - Taxa de conclusão de tarefas em tempo real.
  - Acompanhamento de Story Points entregues vs. planejados.
  - Distribuição percentual de carga por coluna.
- **Importador de CSV do Jira (Novo)**:
  - Aba lateral dedicada **"📥 Importar Jira CSV"**.
  - Reconhece automaticamente o arquivo `Jira.csv` presente na raiz do projeto (12 MB, ~3.467 issues).
  - Importa dados com suporte a lotes (50, 250, 1.000 ou todas as 3.467 linhas).
  - Cria automaticamente os usuários (responsáveis, relatores), o projeto Jira com sua chave oficial (ex: `LR`), mapeia os status dinâmicos descobertos nas colunas do Kanban, converte estimativas de Story Points, Sprints, datas de entrega, ambientes e histórico de comentários.
- **Painel de Exclusão & Limpeza**:
  - Aba lateral dedicada **"🗑️ Painel de Exclusão"**.
  - **Excluir Projetos**: Permite apagar qualquer projeto e automaticamente limpar em cascata todas as issues, sprints e comentários atrelados a ele.
  - **Exclusão de Issues em Massa**: Seleção múltipla via checkboxes com botão para apagar selecionadas.
  - **Limpeza Total do Projeto**: Botão para apagar todas as tarefas do projeto ativo de uma só vez mantendo as configurações do projeto.
- **Filtros Avançados**:
  - Busca em tempo real por título, chave da issue (ex: `JIR-1`) ou tags.
  - Filtro por tipo de item, prioridade e clique rápido nos avatares da equipe.
- **Detalhes da Tarefa & Colaboração**:
  - Modal com edição completa de campos.
  - Histórico de comentários com identificação dos membros da equipe.
- **Autenticação & Segurança**:
  - Proteção de rotas via JWT (Bearer Token).
  - Rate limiting contra abuso/força bruta.
  - Senhas criptografadas com `bcryptjs`.
  - Cabeçalhos de segurança via `helmet` e suporte a CORS.
