import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { getAppearance, setAppearance } from "../lib/appearance";
export default function ThemeControl() {
  const [value, setValue] = useState(getAppearance);
  useEffect(() => {
    const changed = () => setValue(getAppearance());
    window.addEventListener("zen:appearance", changed);
    return () => window.removeEventListener("zen:appearance", changed);
  }, []);
  const Icon = value === "dark" ? Moon : value === "light" ? Sun : Monitor;
  return (
    <label className="zen-theme-control" title="Aparência dos aplicativos">
      <Icon size={17} aria-hidden="true" />
      <select
        aria-label="Aparência"
        value={value}
        onChange={(e) => setAppearance(e.target.value)}
      >
        <option value="light">Claro</option>
        <option value="dark">Escuro</option>
        <option value="system">Automático</option>
      </select>
    </label>
  );
}
