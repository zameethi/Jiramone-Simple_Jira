import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Response, NextFunction } from 'express';

import {
  generateToken,
  authenticateToken,
  optionalAuth,
  type AuthRequest,
} from '../src/middleware/auth';
import { parseJiraDate, parseCSVLine } from '../src/services/jiraImporter';
import { generateProjectKey, parseValidColumns } from '../src/routes/projects';
import { parseStoryPoints, parseDueDate } from '../src/routes/tasks';

function createMockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('Auth Middleware', () => {
  it('generateToken creates a JWT verified by authenticateToken', () => {
    const token = generateToken({ userId: 'u1', email: 'a@b.com', name: 'Ana' });
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createMockRes();
    let nextCalled = false;

    authenticateToken(req, res as unknown as Response, (() => {
      nextCalled = true;
    }) as NextFunction);

    assert.equal(nextCalled, true);
    assert.equal(req.user?.userId, 'u1');
    assert.equal(req.user?.email, 'a@b.com');
  });

  it('authenticateToken returns 401 when Authorization header is missing', () => {
    const req = { headers: {} } as AuthRequest;
    const res = createMockRes();
    let nextCalled = false;

    authenticateToken(req, res as unknown as Response, (() => {
      nextCalled = true;
    }) as NextFunction);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  it('authenticateToken returns 403 for invalid token', () => {
    const req = { headers: { authorization: 'Bearer invalid.jwt.token' } } as AuthRequest;
    const res = createMockRes();
    let nextCalled = false;

    authenticateToken(req, res as unknown as Response, (() => {
      nextCalled = true;
    }) as NextFunction);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('optionalAuth populates req.user for valid token and continues for invalid/missing token', () => {
    const token = generateToken({ userId: 'u2', email: 'b@c.com' });
    const reqValid = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    let calledValid = false;
    optionalAuth(reqValid, {} as Response, (() => {
      calledValid = true;
    }) as NextFunction);
    assert.equal(calledValid, true);
    assert.equal(reqValid.user?.userId, 'u2');

    const reqInvalid = { headers: { authorization: 'Bearer bad' } } as AuthRequest;
    let calledInvalid = false;
    optionalAuth(reqInvalid, {} as Response, (() => {
      calledInvalid = true;
    }) as NextFunction);
    assert.equal(calledInvalid, true);
    assert.equal(reqInvalid.user, undefined);
  });
});

describe('Jira Importer Pure Helpers', () => {
  it('parseJiraDate parses Portuguese Jira dates correctly', () => {
    const d1 = parseJiraDate('07/abr/21 3:49 PM');
    assert.ok(d1 instanceof Date);
    assert.equal(d1.toISOString().slice(0, 10), '2021-04-07');

    const d2 = parseJiraDate('24/fev/2020 15:26');
    assert.ok(d2 instanceof Date);
    assert.equal(d2.toISOString().slice(0, 10), '2020-02-24');

    const d3 = parseJiraDate('15/dez/99 10:00 AM');
    assert.ok(d3 instanceof Date);
    assert.equal(d3.toISOString().slice(0, 10), '1999-12-15');
  });

  it('parseJiraDate returns null for empty or invalid values', () => {
    assert.equal(parseJiraDate(''), null);
    assert.equal(parseJiraDate(null), null);
    assert.equal(parseJiraDate(undefined), null);
    assert.equal(parseJiraDate('not-a-date'), null);
  });

  it('parseCSVLine handles commas inside quotes and escaped double quotes', () => {
    const line = 'LR-1,"Título, com vírgula","Texto ""citado"" aqui",Concluído,';
    const parsed = parseCSVLine(line);
    assert.deepEqual(parsed, [
      'LR-1',
      'Título, com vírgula',
      'Texto "citado" aqui',
      'Concluído',
      '',
    ]);
  });
});

describe('Project Route Helpers', () => {
  it('generateProjectKey builds initials for multi-word names and pads single words', () => {
    assert.equal(generateProjectKey('Logística Abastecimento'), 'LA');
    assert.equal(generateProjectKey('Jiramone Core Platform Ops Extra'), 'JCPO');
    assert.equal(generateProjectKey('App'), 'APP');
    assert.equal(generateProjectKey('Go'), 'GOX');
    assert.equal(generateProjectKey('!!!'), 'PRJ');
  });

  it('parseValidColumns validates arrays and JSON strings of columns', () => {
    const valid = parseValidColumns([
      { id: 'TODO', title: 'A Fazer' },
      { id: 'DONE', title: 'Concluído' },
    ]);
    assert.equal(
      valid,
      JSON.stringify([
        { id: 'TODO', title: 'A Fazer' },
        { id: 'DONE', title: 'Concluído' },
      ])
    );

    const fromJson = parseValidColumns('[{"id":"QA","title":"Em Teste"}]');
    assert.equal(fromJson, '[{"id":"QA","title":"Em Teste"}]');

    assert.equal(parseValidColumns([]), null);
    assert.equal(parseValidColumns('invalid-json'), null);
    assert.equal(parseValidColumns([{ id: '', title: 'Sem ID' }]), null);
  });
});

describe('Task Route Helpers', () => {
  it('parseStoryPoints accepts empty/null or integers from 0 to 100', () => {
    assert.deepEqual(parseStoryPoints(undefined), { ok: true, value: null });
    assert.deepEqual(parseStoryPoints(''), { ok: true, value: null });
    assert.deepEqual(parseStoryPoints(0), { ok: true, value: 0 });
    assert.deepEqual(parseStoryPoints('13'), { ok: true, value: 13 });
    assert.equal(parseStoryPoints(-1).ok, false);
    assert.equal(parseStoryPoints(101).ok, false);
    assert.equal(parseStoryPoints(3.5).ok, false);
    assert.equal(parseStoryPoints('abc').ok, false);
  });

  it('parseDueDate accepts empty/null or valid date strings', () => {
    assert.deepEqual(parseDueDate(null), { ok: true, value: null });
    assert.deepEqual(parseDueDate(''), { ok: true, value: null });
    const res = parseDueDate('2026-12-01');
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.ok(res.value instanceof Date);
    }
    assert.equal(parseDueDate('invalid-date').ok, false);
  });
});
