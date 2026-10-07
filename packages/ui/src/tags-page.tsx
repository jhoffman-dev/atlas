import { useState } from 'react';
import type { TaggedNote } from '@atlas/application';
import { formatTag, type TagSort, type TagTreeNode, type VaultPath } from '@atlas/domain';
import { Icon } from './icon.tsx';
import { SegmentedControl } from './segmented-control.tsx';
import { TagRenameForm, type TagRenameControls } from './tag-rename-form.tsx';

export type TaggedNotesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly notes: readonly TaggedNote[] };

/** The vault's tags, or where reading them has got to. */
export type TagTreeState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly tree: readonly TagTreeNode[] };

const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'frequency', label: 'Frequency' },
] as const;

const uses = (n: number) => `${n} ${n === 1 ? 'use' : 'uses'}`;

/**
 * The tags page: every tag in the vault as a tree — `#para/resource` under
 * `para` — each with how many times it is used, sorted by name or by how
 * often. Choosing one lists the notes using it, and offers to rename it.
 */
export function TagsPage({
  tags,
  sort,
  onSortChange,
  selected,
  onSelect,
  notes,
  onOpenNote,
  rename,
  notice,
}: {
  tags: TagTreeState;
  sort: TagSort;
  onSortChange: (sort: TagSort) => void;
  /** The chosen tag, or null. */
  selected: TagTreeNode | null;
  onSelect: (key: string) => void;
  notes: TaggedNotesState;
  onOpenNote: (path: VaultPath) => void;
  rename: TagRenameControls;
  /** What the last rename did, until something else is done. */
  notice: string | null;
}) {
  return (
    <div className="tags">
      <section className="tags__index" aria-label="All tags">
        <div className="tags__toolbar">
          <SegmentedControl
            label="Sort tags"
            options={SORTS}
            value={sort}
            onChange={onSortChange}
          />
        </div>
        <TagIndex tags={tags} selectedKey={selected?.key ?? null} onSelect={onSelect} />
      </section>
      <section className="tags__detail" aria-label="Notes with the tag">
        {notice !== null && (
          <p className="tags__notice" role="status">
            {notice}
          </p>
        )}
        {selected === null ? (
          <p className="tags__hint">Choose a tag to see the notes that use it.</p>
        ) : (
          <TagDetail
            key={selected.key}
            tag={selected}
            notes={notes}
            onOpenNote={onOpenNote}
            rename={rename}
          />
        )}
      </section>
    </div>
  );
}

function TagIndex({
  tags,
  selectedKey,
  onSelect,
}: {
  tags: TagTreeState;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (tags.kind === 'loading') return <p className="tags__hint">Reading the tags…</p>;
  if (tags.kind === 'failed') {
    return (
      <p className="tags__hint" role="alert">
        {tags.message}
      </p>
    );
  }
  if (tags.tree.length === 0) {
    return <p className="tags__hint">No tags yet. Type # and a word in any note to add one.</p>;
  }
  return (
    <ul className="tags__tree" aria-label="Tags">
      {tags.tree.map((node) => (
        <TagRow
          key={node.key}
          node={node}
          depth={0}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function TagRow({
  node,
  depth,
  selectedKey,
  onSelect,
}: {
  node: TagTreeNode;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const on = node.key === selectedKey;
  return (
    <li className={on ? 'tags__item tags__item--on' : 'tags__item'}>
      <button
        type="button"
        className="tags__row"
        style={{ paddingInlineStart: 10 + depth * 18 }}
        aria-current={on ? 'true' : undefined}
        aria-label={`${node.label} ${uses(node.total)}`}
        title={formatTag(node.name)}
        onClick={() => onSelect(node.key)}
      >
        <Icon name="tag" size={15} className="tags__icon" />
        <span className="tags__name">{node.label}</span>
        <span className="tags__count" aria-hidden="true">
          {node.total}
        </span>
      </button>
      {node.children.length > 0 && (
        <ul className="tags__children">
          {node.children.map((child) => (
            <TagRow
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function TagDetail({
  tag,
  notes,
  onOpenNote,
  rename,
}: {
  tag: TagTreeNode;
  notes: TaggedNotesState;
  onOpenNote: (path: VaultPath) => void;
  rename: TagRenameControls;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <header className="tags__detail-head">
        <h2 className="tags__title">{formatTag(tag.name)}</h2>
        <span className="tags__uses">{uses(tag.total)}</span>
        {!renaming && (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setRenaming(true)}
          >
            Rename
          </button>
        )}
      </header>
      {renaming && (
        <TagRenameForm name={tag.name} rename={rename} onClose={() => setRenaming(false)} />
      )}
      <TaggedNotes notes={notes} onOpenNote={onOpenNote} />
    </>
  );
}

function TaggedNotes({
  notes,
  onOpenNote,
}: {
  notes: TaggedNotesState;
  onOpenNote: (path: VaultPath) => void;
}) {
  if (notes.kind === 'loading') return <p className="tags__hint">Finding the notes…</p>;
  if (notes.kind === 'failed') {
    return (
      <p className="tags__hint" role="alert">
        {notes.message}
      </p>
    );
  }
  return (
    <ul className="tags__notes" aria-label="Notes">
      {notes.notes.map((note) => (
        <li key={note.path}>
          <button
            type="button"
            className="tags__note"
            aria-label={`${note.title} ${uses(note.count)}`}
            onClick={() => onOpenNote(note.path)}
          >
            <Icon name="doc" size={15} className="tags__icon" />
            <span className="tags__note-title">{note.title}</span>
            <span className="tags__count" aria-hidden="true">
              {note.count}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
