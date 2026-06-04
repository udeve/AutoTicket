import React from "react";
import { Box, Text } from "ink";

export function InfoRow({ label, value, color = "white" }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Box width={14}>
        <Text color="gray">{label}</Text>
      </Box>
      <Text color={color}>{value}</Text>
    </Box>
  );
}
