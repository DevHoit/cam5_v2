"use client";

import { useCallback, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

const STORAGE_SYNC_EVENT = "cam5:storage-sync";
const memoryStore = new Map<string, string>();

function parseStoredValue<T>(serialized: string, fallback: T): T {
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return fallback;
  }
}

/**
 * Persistencia temporal del prototipo. Mantiene el contrato de React.useState
 * para que la futura capa API pueda reemplazarla sin cambiar los componentes.
 */
export function usePersistentState<T>(key: string, initialValue: T) {
  const fallbackSerialized = useMemo(() => JSON.stringify(initialValue), [initialValue]);

  const getClientSnapshot = useCallback(() => {
    const memoryValue = memoryStore.get(key);
    if (memoryValue !== undefined) return memoryValue;

    try {
      return window.localStorage.getItem(key) ?? fallbackSerialized;
    } catch {
      return fallbackSerialized;
    }
  }, [fallbackSerialized, key]);

  const subscribe = useCallback((onStoreChange: () => void) => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) onStoreChange();
    };
    const handleLocalSync = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === key) onStoreChange();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(STORAGE_SYNC_EVENT, handleLocalSync);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(STORAGE_SYNC_EVENT, handleLocalSync);
    };
  }, [key]);

  const serialized = useSyncExternalStore(subscribe, getClientSnapshot, () => fallbackSerialized);
  const value = useMemo(() => parseStoredValue(serialized, initialValue), [initialValue, serialized]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    const previousValue = parseStoredValue(getClientSnapshot(), initialValue);
    const resolvedValue = typeof nextValue === "function"
      ? (nextValue as (previous: T) => T)(previousValue)
      : nextValue;
    const nextSerialized = JSON.stringify(resolvedValue);
    if (nextSerialized === undefined) return;

    memoryStore.set(key, nextSerialized);
    try {
      window.localStorage.setItem(key, nextSerialized);
    } catch {
      // El modo privado o una cuota agotada no deben bloquear la interfaz.
    }
    window.dispatchEvent(new CustomEvent(STORAGE_SYNC_EVENT, { detail: { key } }));
  }, [getClientSnapshot, initialValue, key]);

  return [value, setValue] as const;
}
