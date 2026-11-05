import React from 'react';
import { Button, SxProps, Theme } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

// The page's main "add" action ("New task", "New sprint"...) - one size everywhere, sitting
// in the page's toolbar row
export default function NewItemButton({
  label,
  onClick,
  disabled,
  sx,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}) {
  return (
    <Button
      variant="contained"
      size="small"
      startIcon={<AddIcon fontSize="small" />}
      onClick={onClick}
      disabled={disabled}
      sx={[{ whiteSpace: 'nowrap' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {label}
    </Button>
  );
}

NewItemButton.defaultProps = {
  disabled: false,
  sx: undefined,
};
