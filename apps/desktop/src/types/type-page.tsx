import {
  createVaultPath,
  objectTypeIcon,
  pageCrumb,
  TYPE_ICONS,
  typeDeleteRefusal,
  type ObjectType,
  type VaultPath,
  type ViewTab,
} from '@atlas/domain';
import type {
  DefinedType,
  IndexPort,
  MarkdownPort,
  OpenNotes,
  VaultFsPort,
} from '@atlas/application';
import {
  EditableTitle,
  Icon,
  PageBar,
  PageHead,
  SegmentedControl,
  TableView,
  TypeEditor,
  ViewTabs,
  type PageHistory,
  type ViewTabEditing,
} from '@atlas/ui';
import { schemaOf } from '../panes/table-schema.ts';
import type { useTypeTable } from './use-type-table.ts';
import { useTypeEditor } from './use-type-editor.ts';

/** What the type page shows: the type's notes, or the type itself to edit. */
export type TypePageMode = 'notes' | 'edit';

const MODES = [
  { value: 'notes', label: 'Notes' },
  { value: 'edit', label: 'Edit type' },
] as const;

/**
 * A type's own page: its definition, edited in place, and — for a type with no
 * views — its default table under the one tab it has (ADR-0023). A type with
 * views opens on one of them instead; reached by Back, this page lists them.
 */
export function TypePage({
  table,
  types,
  mode,
  onModeChange,
  ports,
  onSaved,
  onOpenNote,
  onNewNote,
  tabs,
  tabEditing,
  onOpenView,
  onDelete,
  onEditTemplate,
  onShowSidebar,
  history,
}: {
  table: ReturnType<typeof useTypeTable>;
  types: readonly DefinedType[];
  mode: TypePageMode;
  onModeChange: (mode: TypePageMode) => void;
  ports: {
    fs: VaultFsPort;
    markdown: MarkdownPort;
    index: IndexPort;
    openNotes: Pick<OpenNotes, 'setPropertiesIfOpen'>;
  };
  onSaved: () => void;
  onOpenNote: (path: VaultPath) => void;
  /** Makes a note of this type, from the foot of its table. */
  onNewNote: (type: ObjectType) => void;
  /** The type's tabs: its views, or its default table while it has none. */
  tabs: readonly ViewTab[];
  /** What the tabs can do: add a view, rename or copy the default table. */
  tabEditing: ViewTabEditing | undefined;
  onOpenView: (path: VaultPath) => void;
  /** Asks to put the type's file in the Trash, through the same question as any note. */
  onDelete: (path: VaultPath) => void;
  /** Opens the template the type's new notes start as, made if it has none. */
  onEditTemplate: (type: ObjectType) => void;
  onShowSidebar?: () => void;
  history?: PageHistory;
}) {
  const defined = types.find((candidate) => candidate.name === table.type?.name) ?? null;
  const editor = useTypeEditor({ ...ports, type: defined, types, onSaved });
  const type = editor.draft ?? table.type;
  if (type === null) return null;
  const page = { kind: 'type', typeName: type.name } as const;

  return (
    <>
      <PageBar
        crumb={{ ...pageCrumb(page, null), icon: objectTypeIcon(type) }}
        name={type.label}
        {...(onShowSidebar !== undefined && { onShowSidebar })}
        {...(history !== undefined && { history })}
      />
      <div className="panel__body">
        <article className="page page--wide" aria-label={type.label}>
          <PageHead
            icon={objectTypeIcon(type)}
            title={
              <EditableTitle
                value={type.label}
                label="Type name"
                hint="Rename this type"
                onCommit={(label) => editor.edit({ kind: 'setLabel', label })}
              />
            }
            actions={
              <>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => onEditTemplate(type)}
                >
                  <Icon name="template" size={15} />
                  Edit template
                </button>
                <SegmentedControl
                  label="Show"
                  options={MODES}
                  value={mode}
                  onChange={onModeChange}
                />
              </>
            }
          >
            {mode === 'notes' && (
              <div className="view-toolbar">
                <ViewTabs
                  tabs={tabs}
                  onOpenView={(path) => onOpenView(createVaultPath(path))}
                  // The page's own controls already open the type and its template.
                  editing={
                    tabEditing && {
                      ...tabEditing,
                      onEditType: undefined,
                      onEditTemplate: undefined,
                    }
                  }
                />
              </div>
            )}
          </PageHead>
          {mode === 'edit' ? (
            <TypeEditor
              type={type}
              icons={TYPE_ICONS}
              targets={types.map(({ name, label }) => ({ name, label }))}
              prompt={editor.prompt}
              notice={editor.notice}
              onEdit={editor.edit}
              {...(defined !== null && {
                deletion: {
                  refusal: typeDeleteRefusal(type),
                  onDelete: () => onDelete(defined.path),
                },
              })}
            />
          ) : (
            <TableView
              result={table.result}
              sorts={table.sorts}
              error={table.error}
              schema={schemaOf(table.type, type.name)}
              onOpenNote={(path) => onOpenNote(createVaultPath(path))}
              onEditCell={table.editCell}
              onToggleSort={table.toggleSort}
              onNewNote={() => onNewNote(type)}
            />
          )}
        </article>
      </div>
    </>
  );
}
