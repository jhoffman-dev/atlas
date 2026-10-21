import { describe, expect, it } from 'vitest';
import { TASK_TYPE_FILE } from '../gtd/task-type.ts';
import { checkAtlasQuery } from '../query-language/check.ts';
import { parseAtlasQuery } from '../query-language/parse.ts';
import { PARA_TYPE_FILES } from '../types/para.ts';
import { parseObjectType, type ObjectType } from '../types/property-def.ts';
import { isLinkedPageType, linkedSectionPlans, type LinkedSectionPlan } from './linked-sections.ts';

const PERSON = parseObjectType({
  name: 'person',
  properties: { role: 'text', company: { kind: 'relation', target: 'company' } },
});
const COMPANY = parseObjectType({ name: 'company', properties: {} });
const MEETING = parseObjectType({
  name: 'meeting',
  properties: {
    date: 'date',
    people: { kind: 'relation', target: 'person', many: true },
    companies: { kind: 'relation', target: 'company', many: true },
    project: { kind: 'relation', target: ['project', 'area'] },
  },
});
const DECISION = parseObjectType({
  name: 'decision',
  properties: {
    date: 'date',
    meeting: { kind: 'relation', target: 'meeting' },
    project: { kind: 'relation', target: 'project' },
  },
});
const PROPOSAL = parseObjectType({ name: 'proposal', properties: {} });
/** The Area and Resource types as DFAI wrote them before PARA became a property (#213). */
const AREA = parseObjectType({ name: 'area', label: 'Area', properties: { description: 'text' } });
const RESOURCE = parseObjectType({
  name: 'resource',
  label: 'Resource',
  properties: {
    project: { kind: 'relation', target: ['project', 'area'] },
    url: 'url',
    description: 'text',
  },
});
/** PARA's types as a vault set up before #213 has them: Project, and Area and Resource beside it. */
const PARA_TYPES: readonly ObjectType[] = [
  ...PARA_TYPE_FILES.map((file) => file.type),
  AREA,
  RESOURCE,
];

/** A vault as DFAI sets one up: GTD tasks, PARA, meetings and decisions. */
const TYPES: readonly ObjectType[] = [
  PERSON,
  COMPANY,
  MEETING,
  DECISION,
  PROPOSAL,
  TASK_TYPE_FILE.type,
  ...PARA_TYPES,
];

const PAGE_TYPES = ['person', 'company', 'project', 'area', 'meeting', 'task', 'decision'];

function section(plans: readonly LinkedSectionPlan[], id: string): LinkedSectionPlan {
  const found = plans.find((plan) => plan.id === id);
  if (found === undefined) throw new Error(`no ${id} section among ${plans.map((p) => p.id)}`);
  return found;
}

const ids = (typeName: string, types = TYPES) =>
  linkedSectionPlans(typeName, types).map((plan) => plan.id);

describe('linkedSectionPlans', () => {
  it('gives each page type its sections, in the order they are read', () => {
    expect(ids('person')).toEqual(['meetings', 'waiting', 'tasks', 'decisions', 'notes']);
    expect(ids('company')).toEqual([
      'people',
      'meetings',
      'waiting',
      'tasks',
      'projects',
      'decisions',
      'notes',
    ]);
    expect(ids('project')).toEqual(['waiting', 'tasks', 'meetings', 'decisions', 'notes']);
    expect(ids('area')).toEqual(['waiting', 'tasks', 'projects', 'meetings', 'decisions', 'notes']);
    expect(ids('meeting')).toEqual(['people', 'companies', 'tasks', 'decisions']);
    expect(ids('task')).toEqual(['meetings']);
    expect(ids('decision')).toEqual(['meetings']);
  });

  it('gives a type that is no linked page, or that the vault lacks, nothing', () => {
    expect(ids('resource')).toEqual([]);
    expect(linkedSectionPlans(null, TYPES)).toEqual([]);
    expect(ids('person', [MEETING])).toEqual([]);
    expect(isLinkedPageType('Person ')).toBe(true);
    expect(isLinkedPageType('resource')).toBe(false);
    expect(isLinkedPageType(null)).toBe(false);
  });

  it.each(PAGE_TYPES)('writes only queries the vault can answer: %s', (typeName) => {
    for (const plan of linkedSectionPlans(typeName, TYPES)) {
      for (const text of [plan.query, plan.recentQuery]) {
        if (text === null) continue;
        expect(() => checkAtlasQuery(parseAtlasQuery(text), TYPES, 'page.md')).not.toThrow();
      }
    }
  });

  it("lists a person's meetings by the relation made for people, newest first", () => {
    const meetings = section(linkedSectionPlans('person', TYPES), 'meetings');
    expect(meetings.query).toBe(
      'FROM meeting WHERE people = this SORT BY date DESC SHOW date LIMIT 202',
    );
    expect(meetings.recentQuery).toBe(
      'FROM meeting WHERE people = this AND (date >= @-30d OR date IS EMPTY) SORT BY date DESC SHOW date LIMIT 202',
    );
  });

  it('lists what a person is waited on for, longest untouched first, and leaves it out of their open tasks', () => {
    const plans = linkedSectionPlans('person', TYPES);
    const waiting = section(plans, 'waiting');
    expect(waiting.query).toBe(
      'FROM task WHERE status = waiting AND waiting_on = this SORT BY modified ASC SHOW project, modified LIMIT 202',
    );
    expect(waiting).toMatchObject({ waited: true, recentQuery: null });
    expect(section(plans, 'tasks').query).toBe(
      'FROM task WHERE CONNECTED TO this AND status != archive AND NOT (status = waiting AND waiting_on = this) ' +
        'SORT BY due, title GROUP BY status SHOW due LIMIT 202',
    );
    expect(section(plans, 'tasks')).toMatchObject({ waited: false, wantsNextAction: false });
  });

  it("reaches a company's people by any link, and its waiting-fors and tasks through them", () => {
    const plans = linkedSectionPlans('company', TYPES);
    expect(section(plans, 'people').query).toBe(
      'FROM person WHERE CONNECTED TO this SORT BY title SHOW role LIMIT 202',
    );
    expect(section(plans, 'waiting').query).toBe(
      'FROM task WHERE status = waiting AND waiting_on CONNECTED TO this SORT BY modified ASC SHOW project, modified LIMIT 202',
    );
    expect(section(plans, 'tasks').query).toContain(
      'WHERE (CONNECTED TO this OR waiting_on CONNECTED TO this) AND status != archive AND NOT (status = waiting AND waiting_on CONNECTED TO this)',
    );
    expect(section(plans, 'meetings').query).toContain('WHERE companies = this');
  });

  it("files a project's tasks, meetings and decisions by the relation that points at it", () => {
    const plans = linkedSectionPlans('project', TYPES);
    expect(section(plans, 'tasks').query).toBe(
      'FROM task WHERE project = this AND status != archive AND NOT (status = waiting) ' +
        'SORT BY due, title GROUP BY status SHOW due LIMIT 202',
    );
    expect(section(plans, 'tasks').wantsNextAction).toBe(true);
    expect(section(plans, 'waiting').query).toBe(
      'FROM task WHERE project = this AND status = waiting SORT BY modified ASC SHOW waiting_on, modified LIMIT 202',
    );
    expect(section(plans, 'meetings').query).toContain('FROM meeting WHERE project = this ');
    expect(section(plans, 'decisions').query).toContain('FROM decision WHERE project = this ');
  });

  it("lists an area's projects, and its meetings where a meeting can be filed under one", () => {
    const plans = linkedSectionPlans('area', TYPES);
    expect(section(plans, 'projects').query).toBe(
      'FROM project WHERE area = this SORT BY title SHOW status LIMIT 202',
    );
    expect(section(plans, 'meetings').query).toContain('WHERE project = this');
    // An area is never finished, so nothing says it should be moving.
    expect(section(plans, 'tasks').wantsNextAction).toBe(false);
    // A decision's `project` points at projects alone, so an area's are found by any link.
    expect(section(plans, 'decisions').query).toContain('WHERE CONNECTED TO this');
  });

  it('joins a meeting with its tasks and decisions by any link, either way, and back', () => {
    const meeting = linkedSectionPlans('meeting', TYPES);
    expect(section(meeting, 'tasks').query).toBe(
      'FROM task WHERE CONNECTED TO this SORT BY due, title SHOW status, waiting_on, due LIMIT 202',
    );
    expect(section(meeting, 'decisions').query).toBe(
      'FROM decision WHERE CONNECTED TO this SORT BY title SHOW title LIMIT 202',
    );
    expect(section(meeting, 'people').query).toBe(
      'FROM person WHERE CONNECTED TO this SORT BY title SHOW company, role LIMIT 202',
    );
    for (const typeName of ['task', 'decision']) {
      const [source] = linkedSectionPlans(typeName, TYPES);
      expect(source).toMatchObject({
        title: 'Meetings',
        query: 'FROM meeting WHERE CONNECTED TO this SORT BY date DESC SHOW date LIMIT 202',
        recentQuery: null,
      });
    }
  });

  it('keeps recent to the sections with a day to judge it by', () => {
    const recent = (typeName: string) =>
      linkedSectionPlans(typeName, TYPES)
        .filter((plan) => plan.recentQuery !== null)
        .map((plan) => plan.id);
    expect(recent('person')).toEqual(['meetings', 'decisions', 'notes']);
    expect(recent('company')).toEqual(['meetings', 'decisions', 'notes']);
    expect(recent('meeting')).toEqual([]);
  });

  it('lists under Linked notes every other type, and what a listed type links outside its relation', () => {
    const notes = section(linkedSectionPlans('person', TYPES), 'notes');
    // A meeting she was in is under Meetings; one that only mentions her is here. Never a proposal.
    expect(notes.query).toBe(
      'FROM meeting, person, company, project, area, resource WHERE CONNECTED TO this ' +
        'AND NOT (type = meeting AND people = this) SORT BY modified DESC SHOW title LIMIT 202',
    );
    expect(notes.recentQuery).toContain('AND modified >= @-30d');
    expect(notes.showsType).toBe(true);
    expect(section(linkedSectionPlans('company', TYPES), 'notes').query).toContain(
      'FROM meeting, company, area, resource WHERE CONNECTED TO this AND NOT (type = meeting AND companies = this) ',
    );
    expect(section(linkedSectionPlans('project', TYPES), 'notes').query).toContain(
      'FROM task, meeting, decision, person, company, project, area, resource WHERE CONNECTED TO this ' +
        'AND NOT (type = task AND project = this) AND NOT (type = meeting AND project = this) ' +
        'AND NOT (type = decision AND project = this) ',
    );
  });
});

describe('linkedSectionPlans, in a vault whose types are its own', () => {
  it('finds meetings by any link when Meeting declares no relation to the page, dated by the file', () => {
    const bare = parseObjectType({ name: 'meeting', properties: {} });
    const [meetings] = linkedSectionPlans('person', [PERSON, bare]);
    expect(meetings).toMatchObject({
      query: 'FROM meeting WHERE CONNECTED TO this SORT BY modified DESC SHOW title LIMIT 202',
      recentQuery:
        'FROM meeting WHERE CONNECTED TO this AND modified >= @-30d SORT BY modified DESC SHOW title LIMIT 202',
    });
  });

  it('has no waiting section for tasks that are not GTD’s, and quotes a status of several words', () => {
    const own = parseObjectType({
      name: 'task',
      properties: {
        status: { kind: 'select', options: ['todo', "won't do", 'done'], done: "won't do" },
      },
    });
    const plans = linkedSectionPlans('person', [PERSON, own]);
    expect(plans.map((plan) => plan.id)).toEqual(['tasks', 'notes']);
    expect(plans[0]?.query).toBe(
      "FROM task WHERE CONNECTED TO this AND status != 'won''t do' SORT BY title GROUP BY status SHOW title LIMIT 202",
    );
    expect(() =>
      checkAtlasQuery(parseAtlasQuery(plans[0]?.query ?? ''), [PERSON, own], 'p.md'),
    ).not.toThrow();

    const plain = parseObjectType({ name: 'task', properties: { notes: 'text' } });
    expect(linkedSectionPlans('person', [PERSON, plain])[0]?.query).toBe(
      'FROM task WHERE CONNECTED TO this SORT BY title SHOW title LIMIT 202',
    );
  });

  it('never names a key or a type a query cannot spell', () => {
    const odd = parseObjectType({
      name: 'meeting',
      properties: { 'who came': { kind: 'relation', target: 'person', many: true } },
    });
    const spaced = parseObjectType({ name: 'field notes', properties: {} });
    const plans = linkedSectionPlans('person', [PERSON, odd, spaced]);
    expect(section(plans, 'meetings').query).toContain('WHERE CONNECTED TO this');
    expect(section(plans, 'notes').query).toContain('FROM person WHERE');
  });

  it('follows any relation of a task to people, one that may point at a company too', () => {
    const task = parseObjectType({
      name: 'task',
      properties: {
        status: { kind: 'select', options: ['waiting', 'archive'], done: 'archive' },
        waiting_on: { kind: 'relation', target: ['person', 'company'] },
        owner: { kind: 'relation', target: 'person' },
      },
    });
    const types = [PERSON, COMPANY, task];
    const plans = linkedSectionPlans('company', types);
    expect(plans.map((plan) => plan.id)).toEqual(['people', 'waiting', 'tasks', 'notes']);
    expect(section(plans, 'tasks').query).toContain(
      'WHERE (CONNECTED TO this OR waiting_on CONNECTED TO this OR owner CONNECTED TO this) AND status != archive',
    );
    for (const plan of plans) {
      expect(() => checkAtlasQuery(parseAtlasQuery(plan.query), types, 'c.md')).not.toThrow();
    }
  });

  it('leaves a listed type out of Linked notes when a query would read its relation as another kind', () => {
    // Task is listed first and declares `initiative` as text: one field, as the first declares it,
    // so a decision's `initiative = this` could not be checked beside it.
    const task = parseObjectType({
      name: 'task',
      properties: { project: { kind: 'relation', target: 'project' }, initiative: 'text' },
    });
    const decision = parseObjectType({
      name: 'decision',
      properties: { initiative: { kind: 'relation', target: 'project' } },
    });
    const types = [task, decision, ...PARA_TYPES];
    const notes = section(linkedSectionPlans('project', types), 'notes');
    expect(notes.query).toContain(
      'FROM task, project, area, resource WHERE CONNECTED TO this AND NOT (type = task AND project = this) SORT',
    );
    expect(() => checkAtlasQuery(parseAtlasQuery(notes.query), types, 'p.md')).not.toThrow();
  });

  it('knows a built-in type whatever case the vault names it in', () => {
    const titled = parseObjectType({ name: 'Person', properties: {} });
    const meeting = parseObjectType({
      name: 'meeting',
      properties: { people: { kind: 'relation', target: 'Person', many: true } },
    });
    const [meetings] = linkedSectionPlans('person', [titled, meeting]);
    expect(meetings?.query).toContain('WHERE people = this');
  });
});
