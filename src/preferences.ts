export type Preferences = {
  text: "normal" | "large" | "extra";
  contrast: boolean;
  reduceMotion: boolean;
  language: "es" | "en";
};
export const defaultPreferences: Preferences = {
  text: "normal",
  contrast: false,
  reduceMotion: false,
  language: "es",
};
export function readPreferences(): Preferences {
  try {
    const raw = JSON.parse(
      localStorage.getItem("bloquea-accessibility") || "{}",
    );
    return {
      text: ["normal", "large", "extra"].includes(raw.text)
        ? raw.text
        : "normal",
      contrast: raw.contrast === true,
      reduceMotion: raw.reduceMotion === true,
      language: raw.language === "en" ? "en" : "es",
    };
  } catch {
    return { ...defaultPreferences };
  }
}
export function applyPreferences(p: Preferences) {
  document.documentElement.dataset.text = p.text;
  document.documentElement.lang = p.language;
  document.documentElement.dataset.contrast = p.contrast ? "high" : "normal";
  document.documentElement.dataset.motion = p.reduceMotion
    ? "reduce"
    : "normal";
}
export function savePreferences(p: Preferences) {
  applyPreferences(p);
  window.dispatchEvent(new Event("registro-language"));
  try {
    localStorage.setItem("bloquea-accessibility", JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
