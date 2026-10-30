import type { Attachment } from 'svelte/attachments';
import { on } from 'svelte/events';
import {
  draggable,
  dropTargetForElements,
  type ElementDropTargetEventBasePayload,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';

import type { DropInstruction } from '#src/generated/protocol';

export const REORDER_DRAG_TYPE = 'application/x-sable-reorder';

export type DropEdge = 'above' | 'below';
export type { DropInstruction };

const INTO_BAND = 0.3;

export type DropState<T> = { item: T; instruction: DropInstruction };

export function dropInstructionAt(
  offsetY: number,
  height: number,
  allowInto: boolean
): DropInstruction {
  if (height <= 0) return 'above';

  const position = Math.min(Math.max(offsetY / height, 0), 1);
  if (!allowInto) return position < 0.5 ? 'above' : 'below';
  if (position < INTO_BAND) return 'above';
  if (position > 1 - INTO_BAND) return 'below';

  return 'into';
}

export interface DropTargetOptions<T> {
  allowInto?: boolean;
  axis?: 'vertical' | 'horizontal';
  accepts?: (source: T) => boolean;
  onState: (state: DropState<T> | null) => void;
  onDrop: (source: T, target: T, instruction: DropInstruction) => void;
}

export interface DragList<T> {
  draggable: (item: T, onDragging: (dragged: T | null) => void) => Attachment<HTMLElement>;
  dropTarget: (item: T, options: DropTargetOptions<T>) => Attachment<HTMLElement>;
  autoScroll: () => Attachment<HTMLElement>;
}

export function createDragList<T>(equals: (left: T, right: T) => boolean): DragList<T> {
  const owner = Symbol('drag-list');
  let activeSource: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  const belongs = (data: Record<string, unknown>): boolean =>
    data.owner === owner && data.available === true;

  return {
    draggable(item, onDragging) {
      return (node) => {
        const data = { owner, item, available: true };
        const stopMoveEffect = on(node, 'dragstart', (event) => {
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        const finish = (): void => {
          if (activeSource !== node) return;
          activeSource = null;
          onDragging(null);
        };
        const release = draggable({
          element: node,
          getInitialData: () => data,
          getInitialDataForExternal: () => ({ 'text/plain': '', [REORDER_DRAG_TYPE]: '' }),
          onGenerateDragPreview: () => {
            activeSource = node;
            onDragging(item);
          },
          onDrop: finish,
        });
        return () => {
          data.available = false;
          stopMoveEffect();
          release();
          finish();
        };
      };
    },

    dropTarget(item, { allowInto = false, axis = 'vertical', accepts, onState, onDrop }) {
      return (node) => {
        const clear = (): void => {
          if (hovered !== node) return;
          hovered = null;
          onState(null);
        };
        const instruction = ({ location }: ElementDropTargetEventBasePayload): DropInstruction => {
          const box = node.getBoundingClientRect();
          const input = location.current.input;
          return axis === 'horizontal'
            ? dropInstructionAt(input.clientX - box.left, box.width, allowInto)
            : dropInstructionAt(input.clientY - box.top, box.height, allowInto);
        };
        const nearest = ({ location }: ElementDropTargetEventBasePayload): boolean =>
          location.current.dropTargets[0]?.element === node;
        const update = (payload: ElementDropTargetEventBasePayload): void => {
          if (!nearest(payload)) return;
          const source = payload.source.data.item as T;
          if (equals(source, item)) {
            clear();
            return;
          }
          hovered = node;
          onState({ item, instruction: instruction(payload) });
        };
        const release = dropTargetForElements({
          element: node,
          canDrop: ({ source }) =>
            belongs(source.data) && (accepts?.(source.data.item as T) ?? true),
          getDropEffect: () => 'move',
          onDragEnter: update,
          onDrag: update,
          onDragLeave: clear,
          onDrop: (payload) => {
            if (!nearest(payload) || !belongs(payload.source.data)) return;
            clear();
            const source = payload.source.data.item as T;
            if (!equals(source, item)) onDrop(source, item, instruction(payload));
          },
        });
        return () => {
          release();
          clear();
        };
      };
    },

    autoScroll() {
      return (node) =>
        autoScrollForElements({
          element: node,
          canScroll: ({ source }) => belongs(source.data),
          getAllowedAxis: () => 'vertical',
        });
    },
  };
}
