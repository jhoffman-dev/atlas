/** A choice in a dropdown: what is stored, and what is shown. */
export interface Choice<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
  /** Why it cannot be picked here, when it cannot. */
  readonly problem?: string | null;
}

/**
 * A native dropdown over a fixed list of choices — native so WebKit's own menu
 * opens, as every other select in the app does. A value the list does not hold
 * is never reported: only a picked choice is.
 */
export function ChoiceSelect<Value extends string>({
  label,
  value,
  choices,
  onChange,
  className,
}: {
  label: string;
  value: Value;
  choices: readonly Choice<Value>[];
  onChange: (value: Value) => void;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      {...(className !== undefined && { className })}
      onChange={(event) => {
        const picked = choices.find((choice) => choice.value === event.target.value);
        if (picked !== undefined) onChange(picked.value);
      }}
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}
