import { useState } from 'react';
import {
  createVaultPath,
  sidebarEntry,
  sidebarTreeRows,
  type ActiveSidebarPage,
  type SidebarSectionId,
} from '@atlas/domain';
import { SegmentedControl, Sidebar, Toggle, type SectionStore } from '@atlas/ui';

/**
 * Every primitive, in both themes, side by side.
 *
 * Dev-only: `gallery.html` is not one of the build's inputs, so none of this
 * reaches the shipped bundle. Open it with `pnpm dev` and
 * http://localhost:1420/gallery.html.
 */

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="gallery-page__row">
      <h2 className="gallery-page__heading">{title}</h2>
      <div className="gallery-page__specimens">{children}</div>
    </section>
  );
}

/** The gallery is two sidebars side by side, so neither remembers for the other. */
function memoryStore(): SectionStore {
  let collapsed: readonly SidebarSectionId[] = [];
  return {
    read: () => collapsed,
    write: (next) => {
      collapsed = next;
    },
  };
}

const entry = (path: string) => sidebarEntry(createVaultPath(path));

function SidebarSpecimen() {
  const [store] = useState(memoryStore);
  const [active, setActive] = useState<ActiveSidebarPage>({ kind: 'type', name: 'task' });

  return (
    <div className="gallery-page__sidebar">
      <Sidebar
        favorites={[entry('Acme.md'), entry('.atlas/views/Board.md')]}
        types={[
          { name: 'task', label: 'Task', count: 62, icon: 'task' },
          { name: 'person', label: 'Person', count: 8, icon: 'person' },
        ]}
        views={[entry('.atlas/views/Board.md'), entry('.atlas/views/Today.md')]}
        dashboards={[entry('.atlas/dashboards/Progress.md')]}
        quick={[{ id: 'today', entry: entry('.atlas/views/Today.md'), count: 4 }]}
        tree={{
          rows: sidebarTreeRows([
            {
              entry: { kind: 'directory', name: 'Notes', path: createVaultPath('Notes') },
              depth: 0,
              isExpanded: true,
              isLoaded: true,
            },
            {
              entry: { kind: 'file', name: 'Acme.md', path: createVaultPath('Notes/Acme.md') },
              depth: 1,
              isExpanded: false,
              isLoaded: true,
            },
          ]),
          onToggleDirectory: () => {},
        }}
        active={active}
        sectionStore={store}
        onSearch={() => {}}
        onOpen={(path) => setActive({ kind: 'note', path })}
        onOpenType={(name) => setActive({ kind: 'type', name })}
        onToggleFavorite={() => {}}
      />
    </div>
  );
}

function Specimens() {
  const [view, setView] = useState<'board' | 'table' | 'calendar'>('board');
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);

  return (
    <>
      <Row title="Card">
        <div className="card">
          <p className="card__label">Resting</p>
          <p className="gallery-page__value">18</p>
        </div>
        <div className="card card--raised">
          <p className="card__label">Raised</p>
          <p className="gallery-page__value">4</p>
        </div>
        <button type="button" className="card card--interactive">
          <p className="card__label">Interactive</p>
          <p className="gallery-page__value">7</p>
        </button>
      </Row>

      <Row title="Button">
        <button type="button" className="btn btn--primary">
          Primary
        </button>
        <button type="button" className="btn btn--secondary">
          Secondary
        </button>
        <button type="button" className="btn btn--ghost">
          Ghost
        </button>
        <button type="button" className="btn btn--primary btn--sm">
          Small
        </button>
        <button type="button" className="btn btn--primary" disabled>
          Disabled
        </button>
      </Row>

      <Row title="Segmented control">
        <SegmentedControl
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: 'Board' },
            { value: 'table', label: 'Table' },
            { value: 'calendar', label: 'Calendar' },
          ]}
        />
      </Row>

      <Row title="Input and select">
        <input className="field" placeholder="Search the vault" aria-label="Search the vault" />
        <textarea
          className="field field--block"
          rows={2}
          placeholder="A few lines"
          aria-label="A few lines"
        />
        <input className="field field--invalid" defaultValue="not a date" aria-label="Due" />
        <span className="select">
          <select className="field select__control" aria-label="Status">
            <option>Backlog</option>
            <option>Doing</option>
            <option>Done</option>
          </select>
        </span>
      </Row>

      <Row title="Toggle">
        <Toggle label="On" checked={on} onChange={setOn} />
        <Toggle label="Off" checked={off} onChange={setOff} />
        <Toggle label="Disabled" checked disabled onChange={() => {}} />
      </Row>

      <Row title="Chip">
        <span className="chip">due 2026-09-21</span>
        <span className="chip chip--accent">favourite</span>
        <span className="chip chip--danger">overdue</span>
      </Row>

      <Row title="Sidebar">
        <SidebarSpecimen />
      </Row>

      <Row title="Elevation">
        <div className="card">Shadow 1 — a resting card</div>
        <div className="card card--raised">Shadow 2 — raised: interactive or foremost</div>
        <div className="card gallery-page__overlay">Shadow 3 — an overlay above the app</div>
      </Row>
    </>
  );
}

function Panel({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div className="gallery-page__panel" data-theme={theme}>
      <h1 className="gallery-page__title">{theme === 'light' ? 'Light' : 'Dark'}</h1>
      <Specimens />
    </div>
  );
}

export function Gallery() {
  return (
    <div className="gallery-page">
      <Panel theme="light" />
      <Panel theme="dark" />
    </div>
  );
}
