import { useState } from 'react';
import {
  createVaultPath,
  sidebarEntry,
  sidebarTreeRows,
  STATUS_TONES,
  type ActiveSidebarPage,
  type SidebarSectionId,
} from '@atlas/domain';
import {
  Icon,
  KeyHints,
  SegmentedControl,
  Sidebar,
  StatusPill,
  TabStrip,
  Toast,
  Toggle,
  type SectionStore,
  type TabStripTab,
} from '@atlas/ui';

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

/** A menu as Base UI would lay it out, standing still: rows, a highlight, a shortcut, a divider. */
function MenuSpecimen() {
  return (
    <ul className="menu" role="presentation">
      <li>
        <button type="button">
          <Icon name="doc" size={14} />
          <span className="menu__label">Blank note</span>
          <kbd className="key menu__shortcut">⌘N</kbd>
        </button>
      </li>
      <li>
        <button type="button" data-highlighted="">
          <Icon name="calendar" size={14} />
          <span className="menu__label">Today&apos;s note</span>
        </button>
      </li>
      <li>
        <button type="button" data-disabled="">
          <Icon name="template" size={14} />
          <span className="menu__label">From template</span>
        </button>
      </li>
      <li className="menu__divider" role="separator" />
      <li>
        <button type="button">
          <Icon name="archive" size={14} />
          <span className="menu__label">Archive</span>
        </button>
      </li>
    </ul>
  );
}

/**
 * The toast stands on a stage of its own, since it places itself top right of
 * whatever holds it. Its words are the longest the app says — a refused
 * Granola key and its remedy — so the stage shows them wrapping, whole.
 */
function ToastSpecimen() {
  return (
    <div className="gallery-page__stage">
      <Toast
        message="Granola refused the API key. Create one in Granola → Settings → Connectors → API keys, and paste it in Settings → Granola."
        onUndo={() => {}}
        action={{ label: 'Open', onClick: () => {} }}
        onDismiss={() => {}}
      />
    </div>
  );
}

const PANE_TABS: readonly TabStripTab[] = [
  { id: 't1', title: 'Task table', icon: 'table' },
  { id: 't2', title: 'Weekly review', icon: 'check' },
  { id: 't3', title: 'Leftovers from the autumn review: templates in views', icon: 'doc' },
];

/** A pane's strip, live: clicking shows, × and middle-click close, + adds. */
function TabStripSpecimen({ focused }: { focused: boolean }) {
  const [tabs, setTabs] = useState(PANE_TABS);
  const [active, setActive] = useState(focused ? 't3' : 't1');
  const [minted, setMinted] = useState(4);
  const close = (id: string) => {
    const at = tabs.findIndex((tab) => tab.id === id);
    const left = tabs.filter((tab) => tab.id !== id);
    if (left.length === 0) return;
    setTabs(left);
    if (id === active) setActive((left[at] ?? left[at - 1] ?? left[0]!).id);
  };
  const add = () => {
    const id = `t${minted}`;
    setMinted(minted + 1);
    setTabs([...tabs, { id, title: 'New tab' }]);
    setActive(id);
  };
  return (
    <div className="gallery-page__pane">
      <TabStrip
        label={focused ? 'Focused pane tabs' : 'Other pane tabs'}
        tabs={tabs}
        active={active}
        focused={focused}
        onActivate={setActive}
        onClose={close}
        onNew={add}
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
          New task
        </button>
        <button type="button" className="btn btn--positive">
          Accept
        </button>
        <button type="button" className="btn btn--destructive">
          Reject
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

      <Row title="Status pill">
        {STATUS_TONES.map((tone) => (
          <StatusPill key={tone} value={tone} />
        ))}
      </Row>

      <Row title="Status dot">
        {STATUS_TONES.map((tone) => (
          <StatusPill key={tone} value={tone} variant="dot" />
        ))}
      </Row>

      <Row title="Menu">
        <MenuSpecimen />
      </Row>

      <Row title="Key hints">
        <KeyHints
          hints={[
            ['esc', 'close'],
            ['↑ ↓', 'previous / next row'],
            ['⌘↵', 'open in tab'],
          ]}
        />
      </Row>

      <Row title="Toast">
        <ToastSpecimen />
      </Row>

      <Row title="Sidebar">
        <SidebarSpecimen />
      </Row>

      <Row title="Tab strip">
        <TabStripSpecimen focused />
        <TabStripSpecimen focused={false} />
      </Row>

      <Row title="Elevation">
        <div className="card">Hairline — content never floats</div>
        <div className="card gallery-page__overlay">Popover shadow — a menu, the peek, a toast</div>
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
