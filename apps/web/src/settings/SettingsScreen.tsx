/**
 * Settings (GDD §6.9): sound on/off (M), master / music / sfx volume via @pl/audio, reduced motion (defaults to the OS),
 * no flashes. Saved on this device; failures fall back to defaults.
 */
import { useId } from "react";
import type { PageProps } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { useStore } from "../lib/store.js";
import { Button, Card } from "../ui/kit.js";
import { DEFAULT_SETTINGS, osReducedMotion, type Settings } from "./settings.js";

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="setting">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
      {hint && <span className="mono hint">{hint}</span>}
    </div>
  );
}

function Volume({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange(v: number): void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="setting setting-range">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${Math.round(value * 100)} %`}
      />
      <span className="num">{Math.round(value * 100)}</span>
    </div>
  );
}

/** `/settings` */
export default function SettingsScreen(_props: PageProps) {
  const { settings, audio } = useServices();
  const s = useStore(settings);
  const set = (patch: Partial<Settings>): void => settings.set((v) => ({ ...v, ...patch }));
  const os = osReducedMotion();
  return (
    <div className="page">
      <Card title="settings">
        <fieldset>
          <legend className="display">sound</legend>
          <Toggle label="mute all" hint="M key" checked={s.muted} onChange={(muted) => set({ muted })} />
          <Volume label="master" value={s.master} disabled={s.muted} onChange={(master) => set({ master })} />
          <Volume label="music" value={s.music} disabled={s.muted} onChange={(music) => set({ music })} />
          <Volume label="sfx" value={s.sfx} disabled={s.muted} onChange={(sfx) => set({ sfx })} />
          <Button
            onClick={() => {
              void audio.unlock().then(() => audio.play("ui.confirm"));
            }}
          >
            test sound
          </Button>
        </fieldset>
        <fieldset>
          <legend className="display">motion</legend>
          <Toggle
            label="reduced motion"
            hint={s.reducedMotion === null ? `following your system (${os ? "on" : "off"})` : "set here"}
            checked={s.reducedMotion ?? os}
            onChange={(v) => set({ reducedMotion: v })}
          />
          <Toggle
            label="no flashes"
            hint="no 1-bit impact frames"
            checked={s.noFlash}
            onChange={(noFlash) => set({ noFlash })}
          />
          {s.reducedMotion !== null && (
            <Button variant="quiet" onClick={() => set({ reducedMotion: null })}>
              follow my system
            </Button>
          )}
        </fieldset>
        <Button variant="quiet" onClick={() => settings.set({ ...DEFAULT_SETTINGS })}>
          reset to defaults
        </Button>
        <p className="mono">Saved on this device.</p>
      </Card>
    </div>
  );
}
