import { useEffect, useState } from "react";
import { readPreferences } from "./preferences.ts";
export function useLanguage() {
  const [lang, setLang] = useState(readPreferences().language);
  useEffect(() => {
    const change = () =>
      setLang(document.documentElement.lang === "en" ? "en" : "es");
    window.addEventListener("registro-language", change);
    return () => window.removeEventListener("registro-language", change);
  }, []);
  return {
    lang,
    t: (es: string, en?: string) => (lang === "en" ? en || es : es),
  };
}
