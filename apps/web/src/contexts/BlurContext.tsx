import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from "react";

const STORAGE_KEY = "mf_blur_values";

interface BlurContextValue {
  blurred: boolean;
  toggle: () => void;
}

const BlurContext = createContext<BlurContextValue>({ blurred: false, toggle: () => {} });

export function BlurProvider({ children }: PropsWithChildren) {
  const [blurred, setBlurred] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, blurred ? "1" : "0"); } catch {}
  }, [blurred]);

  const toggle = useCallback(() => setBlurred((b) => !b), []);

  return <BlurContext.Provider value={{ blurred, toggle }}>{children}</BlurContext.Provider>;
}

export function useBlur() {
  return useContext(BlurContext);
}
