import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export function TextPrompt({
  label,
  mask,
  initialValue = "",
  onSubmit,
  onCancel
}: {
  label: string;
  mask?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text color="cyan">{label}</Text>
      <Box>
        <Text color="gray">{"› "}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={onSubmit} mask={mask} />
      </Box>
      <Text color="gray">Enter 确认 / Esc 返回</Text>
    </Box>
  );
}
