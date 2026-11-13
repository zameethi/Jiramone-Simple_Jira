import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { importJiraCSV, importJiraCSVContent } from '../services/jiraImporter';

const router = Router();

function findDefaultCsvPath(): string | null {
  const rootCsvPath = path.resolve(process.cwd(), '..', 'Jira.csv');
  const localCsvPath = path.resolve(process.cwd(), 'Jira.csv');
  if (fs.existsSync(rootCsvPath)) return rootCsvPath;
  if (fs.existsSync(localCsvPath)) return localCsvPath;
  return null;
}

// Informações sobre o arquivo Jira.csv disponível na raiz
router.get('/info', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const targetPath = findDefaultCsvPath();

    if (!targetPath) {
      res.json({
        available: false,
        message: 'Arquivo Jira.csv não encontrado na raiz do projeto. Você ainda pode selecionar um arquivo CSV do seu computador.',
      });
      return;
    }

    const stat = fs.statSync(targetPath);
    res.json({
      available: true,
      fileName: 'Jira.csv',
      path: targetPath,
      sizeBytes: stat.size,
      sizeFormatted: `${(stat.size / (1024 * 1024)).toFixed(2)} MB`,
    });
  } catch (error) {
    console.error('Erro ao verificar info do CSV:', error);
    res.status(500).json({ error: 'Erro ao analisar arquivo CSV.' });
  }
});

// Importar do arquivo selecionado (csvContent) ou do arquivo Jira.csv da raiz
router.post('/run', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const {
      limit,
      projectKeyOverride,
      projectNameOverride,
      clearExisting,
      csvContent,
    } = req.body;

    const defaultOwnerId = req.user!.userId;
    const parsedLimit = limit !== undefined && limit !== null ? Number(limit) : 250;

    const importOptions = {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 250,
      projectKeyOverride: projectKeyOverride ? String(projectKeyOverride).trim() : undefined,
      projectNameOverride: projectNameOverride ? String(projectNameOverride).trim() : undefined,
      clearExisting: Boolean(clearExisting),
      defaultOwnerId,
    };

    if (typeof csvContent === 'string' && csvContent.trim()) {
      const stats = await importJiraCSVContent(csvContent, importOptions);
      res.json({
        message: 'Importação do arquivo selecionado concluída com sucesso!',
        stats,
      });
      return;
    }

    const targetPath = findDefaultCsvPath();
    if (!targetPath) {
      res.status(404).json({
        error: 'Arquivo Jira.csv não encontrado na raiz e nenhum arquivo foi selecionado.',
      });
      return;
    }

    const stats = await importJiraCSV(targetPath, importOptions);

    res.json({
      message: 'Importação concluída com sucesso!',
      stats,
    });
  } catch (error) {
    console.error('Erro na importação do Jira CSV:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Erro interno na importação.',
    });
  }
});

export default router;
