"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import { CommandPalette } from "./command-palette";

interface Ctx {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

/**
 * Default no-op context so components that use the palette (e.g. the
 * visible trigger button) can render in isolation — tests, storybook,
 * or pages not wrapped in the provider. Opening the palette becomes
 * a silent no-op rather than a thrown error.
 */
const PaletteContext = createContext<Ctx>({
  open: () => {},
  close: () => {},
  isOpen: false,
});

/**
 * Global provider that mounts the command palette once and exposes
 * ``open`` / ``close`` to any descendant. Wraps the axiom subtree so
 * the palette is available on every Axiom page, not just the landing.
 *
 * The global ⌘K shortcut is retired for now: palette results navigate
 * into the corpus tree, and the corpus has no entry points from the
 * graph app at the moment. Explicit triggers (the corpus browser's
 * own search button) still call ``open()``.
 */
export function CommandPaletteProvider({
  children,
  hrefPrefix,
}: {
  children: React.ReactNode;
  /** Passed through to the palette: keeps section-depth navigation
   *  inside the v2 reader when the provider wraps v2 pages. */
  hrefPrefix?: string;
}) {
  const [isOpen, setOpen] = useState(false);

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <PaletteContext.Provider value={{ open, close, isOpen }}>
      {children}
      <CommandPalette open={isOpen} onClose={close} hrefPrefix={hrefPrefix} />
    </PaletteContext.Provider>
  );
}

export function useCommandPalette(): Ctx {
  return useContext(PaletteContext);
}
