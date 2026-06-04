import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

const SELECTED_STYLE = "\u001b[48;2;185;182;255m\u001b[38;2;0;0;0m";
const RESET_STYLE = "\u001b[0m";

export interface MenuOption<V> {
  key?: string;
  label: string;
  value: V;
  disabled?: boolean;
}

export function Menu<V>({
  items,
  initialIndex = 0,
  onHighlight,
  onSelect
}: {
  items: Array<MenuOption<V>>;
  initialIndex?: number;
  onHighlight?: (index: number, item: MenuOption<V>) => void;
  onSelect: (item: MenuOption<V>) => void;
}) {
  const itemsRef = useRef(items);
  const onHighlightRef = useRef(onHighlight);
  const onSelectRef = useRef(onSelect);
  itemsRef.current = items;
  onHighlightRef.current = onHighlight;
  onSelectRef.current = onSelect;

  const itemsKey = items.map((item) => `${String(item.value)}:${item.disabled ? "1" : "0"}`).join("|");
  const selectableIndexes = useMemo(() => items.map((item, index) => item.disabled ? -1 : index).filter((index) => index >= 0), [itemsKey]);
  const [selectedIndex, setSelectedIndex] = useState(() => nearestSelectableIndex(items, initialIndex));

  useEffect(() => {
    const nextIndex = nearestSelectableIndex(itemsRef.current, initialIndex);
    setSelectedIndex(nextIndex);
    const item = itemsRef.current[nextIndex];
    if (item) onHighlightRef.current?.(nextIndex, item);
  }, [itemsKey, initialIndex]);

  useInput((_input, key) => {
    if (!selectableIndexes.length) return;
    const currentPosition = Math.max(0, selectableIndexes.indexOf(selectedIndex));
    if (key.upArrow) {
      const nextPosition = currentPosition === 0 ? selectableIndexes.length - 1 : currentPosition - 1;
      updateSelected(selectableIndexes[nextPosition]);
    } else if (key.downArrow) {
      const nextPosition = currentPosition === selectableIndexes.length - 1 ? 0 : currentPosition + 1;
      updateSelected(selectableIndexes[nextPosition]);
    } else if (key.return) {
      const item = itemsRef.current[selectedIndex];
      if (item && !item.disabled) onSelectRef.current(item);
    }
  });

  function updateSelected(index: number) {
    setSelectedIndex(index);
    const item = itemsRef.current[index];
    if (item) onHighlightRef.current?.(index, item);
  }

  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <Box key={item.key ?? String(item.value)}>
          <MenuIndicator isSelected={index === selectedIndex && !item.disabled} />
          <MenuItem isSelected={index === selectedIndex && !item.disabled} label={item.label} disabled={item.disabled} />
        </Box>
      ))}
    </Box>
  );
}

function nearestSelectableIndex<V>(items: Array<MenuOption<V>>, preferredIndex: number): number {
  if (!items.length) return 0;
  const clamped = Math.max(0, Math.min(preferredIndex, items.length - 1));
  if (!items[clamped]?.disabled) return clamped;
  for (let offset = 1; offset < items.length; offset += 1) {
    const down = clamped + offset;
    if (down < items.length && !items[down]?.disabled) return down;
    const up = clamped - offset;
    if (up >= 0 && !items[up]?.disabled) return up;
  }
  return 0;
}

function MenuIndicator({ isSelected }: { isSelected?: boolean }) {
  return (
    <Box width={2}>
      <Text>{isSelected ? " " : " "}</Text>
    </Box>
  );
}

function MenuItem({ isSelected, label, disabled }: { isSelected?: boolean; label: string; disabled?: boolean }) {
  if (disabled) {
    return <Text color="cyan">{`  ${label}`}</Text>;
  }

  if (isSelected) {
    return (
      <Text>
        {`${SELECTED_STYLE} ${label} ${RESET_STYLE}`}
      </Text>
    );
  }

  return <Text color="white">{` ${label} `}</Text>;
}
