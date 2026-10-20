import { useRef, useState } from 'react';
import {
  createVaultPath,
  NO_LINKS,
  noteNames,
  type EditorDocument,
  type PropertyDef,
} from '@atlas/domain';
import {
  LinkPreviewCard,
  NoteNamesProvider,
  NotePane,
  PeekDialog,
  previewPlacement,
  useHoveredLink,
  useLinkHover,
  type HoveredLinkStore,
  type LinkPreview,
  type PreviewTarget,
  type PropertyRow,
} from '@atlas/ui';

/** The rows of a Task table the peek steps through. */
const ROWS = [
  { title: 'Phase 16 — The look, rebuilt', status: 'Review', phase: 16 },
  { title: 'Book the hall for the autumn fête', status: 'Doing', phase: 15 },
  { title: 'Leftovers from A15-02: templates in views', status: 'Backlog', phase: 15 },
  { title: 'Water the garden', status: 'Done', phase: 14 },
] as const;

const def = (key: string, kind: PropertyDef['kind'], more: Partial<PropertyDef> = {}) => ({
  key,
  kind,
  label: key.charAt(0).toUpperCase() + key.slice(1),
  required: false,
  options: [],
  target: null,
  many: false,
  ...more,
});

const STATUS = def('status', 'select', { options: ['Backlog', 'Doing', 'Review', 'Done'] });
const PHASE = def('phase', 'number');
const BLOCKED = def('blocked', 'relation', { label: 'Blocked by', target: 'task' });
const EMPTY = ['estimate', 'due', 'owner', 'notes'].map((key) => def(key, 'text'));

const NAMES = noteNames([{ path: createVaultPath('Tasks/A15-02.md'), title: 'A15-02' }]);

function rowsOf(row: (typeof ROWS)[number]): readonly PropertyRow[] {
  return [
    { def: STATUS, value: row.status, error: null },
    { def: PHASE, value: row.phase, error: null },
    { def: BLOCKED, value: '[[A15-02]]', error: null },
    ...EMPTY.map((empty) => ({ def: empty, value: null, error: null })),
  ];
}

/** A short body with a wikilink, the thing a preview card is shown for. */
function bodyOf(title: string): EditorDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `${title}. Done in ` },
          { type: 'wikiLink', attrs: { target: 'P16-04' } },
          { type: 'text', text: ': every path under .atlas/ is left out of views.' },
        ],
      },
    ],
  } as unknown as EditorDocument;
}

const PREVIEWS: Readonly<Record<string, LinkPreview>> = {
  'P16-04': {
    title: 'P16-04',
    kicker: 'Task · Phase 16',
    excerpt:
      'Leave .atlas/ out of every view, dashboard and aggregate. A Task template is type: task, so the table counted it as a task until compileViewQuery skipped the folder.',
  },
  'Tasks/A15-02.md': {
    title: 'A15-02',
    kicker: 'Task · Phase 15',
    excerpt: 'Templates in views, short query pages, and the create race.',
  },
};

const previewOf = (target: PreviewTarget): LinkPreview =>
  PREVIEWS[target.kind === 'link' ? target.link : target.path] ?? {
    title: target.kind === 'link' ? target.link : target.path,
    kicker: null,
    excerpt: null,
  };

/**
 * The center peek over a list of rows (slice 6a): open a row, step with
 * ↑ ↓ or ⌥↑ ⌥↓, close with Esc. The note is the real `NotePane` with
 * `chrome="peek"`, and resting on its wikilink or its relation value shows
 * the preview card. Drawn inside this panel, so it wears the panel's theme.
 */
export function PeekSpecimen() {
  const host = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<number | null>(null);
  const { watch, store } = useLinkHover();
  const row = at === null ? null : ROWS[at];

  return (
    <div className="gallery-page__peek" ref={host}>
      <ul className="gallery-page__peek-rows">
        {ROWS.map((each, index) => (
          <li key={each.title}>
            <button type="button" className="btn btn--ghost" onClick={() => setAt(index)}>
              {each.title}
            </button>
          </li>
        ))}
      </ul>
      {row !== null && row !== undefined && at !== null && (
        <PeekDialog
          title={row.title}
          position={{ index: at, count: ROWS.length, within: 'Task table' }}
          status="Saved"
          onStep={setAt}
          onClose={() => setAt(null)}
          onExpand={() => {}}
          onOpenInNewTab={() => {}}
          onOpenInSplit={() => {}}
          container={host}
        >
          <div ref={watch}>
            <NoteNamesProvider value={NAMES}>
              <PeekNote title={row.title} rows={rowsOf(row)} />
            </NoteNamesProvider>
          </div>
          <PreviewCard store={store} />
        </PeekDialog>
      )}
    </div>
  );
}

/** The card alone re-renders as links are hovered: the peek holding them does not. */
function PreviewCard({ store }: { store: HoveredLinkStore }) {
  const hovered = useHoveredLink(store);
  if (hovered === null) return null;
  return (
    <LinkPreviewCard
      preview={previewOf(hovered.target)}
      placement={previewPlacement(hovered.anchor, {
        width: window.innerWidth,
        height: window.innerHeight,
      })}
    />
  );
}

const noop = () => {};

function PeekNote({ title, rows }: { title: string; rows: readonly PropertyRow[] }) {
  return (
    <NotePane
      chrome="peek"
      // Keyed by the row, as the app keys an editor by its note.
      key={title}
      state={{
        kind: 'ready',
        title,
        doc: bodyOf(title),
        dirty: false,
        saving: false,
        saveError: null,
      }}
      heading={{
        kind: 'note',
        crumb: { icon: 'task', parent: 'Tasks' },
        title: { text: title, source: 'file' },
        description: null,
        path: `Tasks/${title}.md`,
        sql: null,
      }}
      arrangement={{}}
      onChange={noop}
      onSave={noop}
      onFollowLink={noop}
      suggestNotes={() => []}
      links={NO_LINKS}
      mentions={{ kind: 'idle' }}
      onFindMentions={noop}
      onLinkMention={noop}
      onOpenNote={noop}
      loadImage={async () => null}
      typeName="task"
      properties={rows}
      propertyKeys={[]}
      relationChoices={{}}
      typeLabel="Task"
      relationTargets={[]}
      onChangeProperty={noop}
      onAddProperty={async (property) => property.key}
      onRename={noop}
      onOverwrite={noop}
      onDiscard={noop}
      favorite={false}
      onToggleFavorite={noop}
    />
  );
}
