import { useEffect, useState } from "react";
import { getSetting, setSetting } from "@/client/storage/repositories";

/** Comme useState, mais relu puis enregistré dans le stockage du navigateur. `isValid` doit être une fonction stable. */
export function useSettingState<T>(key: string, initial: T, isValid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSetting<unknown>(key, null)
      .then((saved) => {
        if (!cancelled && isValid(saved)) setValue(saved);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, isValid]);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => void setSetting(key, value).catch(() => undefined), 500);
    return () => clearTimeout(timer);
  }, [key, value, loaded]);

  return [value, setValue, loaded] as const;
}