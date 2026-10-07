import { useCallback, useRef } from 'react';
import { DndContext, DragOverlay, pointerWithin, useDraggable, useDroppable } from '@dnd-kit/core';
import { GRID_COLUMNS, type Widget } from '@atlas/domain';
import type { WidgetResult } from '@atlas/application';
import { dashboardWords } from '../drag/announcements.ts';
import {
  moveHandleId,
  sizeHandleId,
  useWidgetDrag,
  type WidgetPlacement,
} from '../drag/widget-drag.ts';
import { Icon } from '../icon.tsx';
import type { OverlaySlots } from '../overlay-slot.ts';
import type { WidgetActions } from './widget-frame.tsx';
import { WidgetTile } from './widget-tile.tsx';

/**
 * A dashboard being arranged: every widget with a handle to move it by and an
 * edge to resize it by, and a card at the end to add one.
 */
export function ArrangeGrid({
  results,
  onOpenNote,
  popups,
  actionsFor,
  onPlace,
  onAdd,
  failed,
}: {
  results: readonly WidgetResult[];
  onOpenNote: (path: string) => void;
  popups?: OverlaySlots | undefined;
  actionsFor: (widget: Widget) => WidgetActions;
  onPlace: (placement: WidgetPlacement) => void;
  onAdd: () => void;
  /** The last change to the dashboard could not be written. */
  failed: boolean;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const measureColumn = useCallback(() => columnWidth(grid.current), []);
  const drag = useWidgetDrag({ results, onPlace, measureColumn, failed });
  const ghost =
    drag.held?.grip === 'pointer'
      ? results.find((result) => result.widget.id === drag.held?.id)
      : undefined;

  return (
    <DndContext
      sensors={drag.sensors}
      collisionDetection={pointerWithin}
      accessibility={{
        announcements: drag.announcements,
        screenReaderInstructions: { draggable: dashboardWords.instructions },
      }}
      onDragStart={drag.onDragStart}
      onDragMove={drag.onDragMove}
      onDragOver={drag.onDragOver}
      onDragEnd={drag.onDragEnd}
      onDragCancel={drag.onDragCancel}
    >
      <div ref={grid} className="dashboard dashboard--arranging" aria-label="Dashboard">
        {drag.arranged.map((result) => (
          <ArrangedWidget
            key={result.widget.id}
            result={result}
            onOpenNote={onOpenNote}
            menuSlot={popups?.(`widget-${result.widget.id}`)}
            actions={actionsFor(result.widget)}
            held={drag.held?.id === result.widget.id ? drag.held.grip : null}
            handleRef={drag.handleRef(result.widget.entry)}
            settling={drag.settling}
          />
        ))}
        <button type="button" className="dashboard__add" onClick={onAdd}>
          <Icon name="plus" size={20} />
          Add widget
        </button>
      </div>
      <DragOverlay dropAnimation={null}>
        {ghost !== undefined && (
          <div className="widget-ghost">
            <Icon name="grip" size={16} />
            {ghost.widget.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * One column and the gap after it, in pixels: how far the right edge has to
 * travel to take one more column.
 */
function columnWidth(grid: HTMLElement | null): number {
  if (grid === null) return 0;
  const style = getComputedStyle(grid);
  const gap = parseFloat(style.columnGap) || 0;
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const inner = grid.getBoundingClientRect().width - padding;
  return (inner + gap) / GRID_COLUMNS;
}

function ArrangedWidget({
  result,
  onOpenNote,
  menuSlot,
  actions,
  held,
  handleRef,
  settling,
}: {
  result: WidgetResult;
  onOpenNote: (path: string) => void;
  menuSlot: ReturnType<OverlaySlots> | undefined;
  actions: WidgetActions;
  held: 'pointer' | 'keyboard' | 'resize' | null;
  handleRef: (element: HTMLElement | null) => void;
  settling: boolean;
}) {
  const { widget } = result;
  const { setNodeRef: setDropRef } = useDroppable({ id: widget.id });
  const {
    setNodeRef: setMoveRef,
    setActivatorNodeRef,
    attributes: moveAttributes,
    listeners: moveListeners,
  } = useDraggable({ id: moveHandleId(widget), disabled: settling });
  const { setNodeRef: setSizeRef, listeners: sizeListeners } = useDraggable({
    id: sizeHandleId(widget),
    disabled: settling,
  });

  // The widget is both what the pointer drops on and what is measured as held.
  const frameRef = useCallback(
    (element: HTMLElement | null) => {
      setDropRef(element);
      setMoveRef(element);
    },
    [setDropRef, setMoveRef],
  );
  const gripRef = useCallback(
    (element: HTMLElement | null) => {
      setActivatorNodeRef(element);
      handleRef(element);
    },
    [setActivatorNodeRef, handleRef],
  );

  const handles = (
    <>
      <button
        type="button"
        ref={gripRef}
        className="widget__grip"
        {...moveAttributes}
        {...moveListeners}
        aria-label={`Move ${widget.title}`}
      >
        <Icon name="grip" size={16} />
      </button>
      {/* The pointer's way to resize. The keyboard's is Shift and the arrows on
          the grip, so this edge is not a second stop in the tab order. */}
      <span
        ref={setSizeRef}
        className="widget__resize"
        {...sizeListeners}
        aria-hidden="true"
        title={`${widget.span} of ${GRID_COLUMNS} columns — drag to resize`}
      />
    </>
  );

  return (
    <WidgetTile
      result={result}
      onOpenNote={onOpenNote}
      menuSlot={menuSlot}
      actions={actions}
      arranging={{
        frameRef,
        className: [
          'widget--arranging',
          held === 'pointer' ? 'widget--placeholder' : '',
          held === 'keyboard' || held === 'resize' ? 'widget--held' : '',
        ].join(' '),
        handles,
      }}
    />
  );
}
