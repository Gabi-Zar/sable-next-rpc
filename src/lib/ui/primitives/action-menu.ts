import { createContext } from 'svelte';

export interface ActionMenuSurface {
  readonly sheet: boolean;
  close: () => void;
}

const [getSurface, setSurface, hasSurface] = createContext<ActionMenuSurface>();

const anchored: ActionMenuSurface = {
  sheet: false,
  close: () => {},
};

export function setActionMenuSurface(surface: ActionMenuSurface): void {
  setSurface(surface);
}

export function useActionMenuSurface(): ActionMenuSurface {
  return hasSurface() ? getSurface() : anchored;
}
