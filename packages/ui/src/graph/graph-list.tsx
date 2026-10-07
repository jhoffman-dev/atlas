import { noteLinks, type VaultGraph, type VaultPath } from '@atlas/domain';
import { Icon } from '../icon.tsx';
import type { OpenRequest } from './graph-canvas.tsx';

/**
 * The same graph as text, for the keyboard and a screen reader: every note in
 * the picture, then what it links to and what links to it. Each is a button,
 * so the graph can be walked with Tab and opened with Enter.
 */
export function GraphList({
  graph,
  typeLabel,
  onOpen,
}: {
  graph: VaultGraph;
  typeLabel: (type: string | null) => string;
  onOpen: (path: VaultPath, request: OpenRequest) => void;
}) {
  if (graph.nodes.length === 0) return <p className="graph__empty">No notes to show.</p>;

  const open = (path: VaultPath) => (event: { metaKey: boolean; ctrlKey: boolean }) =>
    onOpen(path, { split: event.metaKey || event.ctrlKey });

  return (
    <ul className="graph__list" aria-label="Notes in the graph">
      {graph.nodes.map((node) => {
        // The graph on screen is already scoped; archived notes in it were asked for.
        const links = noteLinks(graph, node.path, { includeArchived: true });
        const connected = [...links.outgoing, ...links.incoming];
        return (
          <li key={node.path} className="graph__list-item" data-path={node.path}>
            <button type="button" className="graph__list-note" onClick={open(node.path)}>
              <Icon name="doc" size={16} />
              <span className="graph__list-title">{node.title}</span>
              <span className="graph__list-type">{typeLabel(node.type)}</span>
            </button>
            {connected.length > 0 && (
              <ul className="graph__list-links" aria-label={`Connected to ${node.title}`}>
                {links.outgoing.map((entry) => (
                  <li key={`out:${entry.path}:${entry.via ?? ''}`}>
                    <button type="button" className="graph__list-link" onClick={open(entry.path)}>
                      <span className="graph__list-way">{entry.via ?? 'Links to'}</span>
                      {entry.title}
                    </button>
                  </li>
                ))}
                {links.incoming.map((entry) => (
                  <li key={`in:${entry.path}:${entry.via ?? ''}`}>
                    <button type="button" className="graph__list-link" onClick={open(entry.path)}>
                      <span className="graph__list-way">
                        {entry.via === null ? 'Linked from' : `${entry.via} of`}
                      </span>
                      {entry.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
