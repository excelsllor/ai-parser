import type { RunPolicies } from '@api/runs';

const POLICIES: Array<{ key: keyof RunPolicies; label: string }> = [
  { key: 'dedup', label: 'Склейка дубликатов' },
  { key: 'injection_guard', label: 'Защита Prompt Injection' },
  { key: 'neutral', label: 'Без оценочных суждений' },
];

interface PolicySwitchesProps {
  value: RunPolicies;
  onChange: (key: keyof RunPolicies) => void;
  className?: string;
}

export default function PolicySwitches({
  value,
  onChange,
  className,
}: PolicySwitchesProps) {
  return (
    <div className={className ? `ws-policies ${className}` : 'ws-policies'}>
      {POLICIES.map(({ key, label }) => (
        <label className="ws-switch-label ws-switch-label--interactive" key={key}>
          <input
            checked={value[key]}
            className="ws-switch-input"
            type="checkbox"
            onChange={() => onChange(key)}
          />
          <span className="ws-switch-track" />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}
