import React, { type ReactNode } from "react";
import { Box, Text } from "ink";

export function Frame({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} width={88}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
        {subtitle ? <Text color="gray">{subtitle}</Text> : null}
      </Box>
      {children}
      {footer ? (
        <Box marginTop={1}>
          <Text color="gray">{footer}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
