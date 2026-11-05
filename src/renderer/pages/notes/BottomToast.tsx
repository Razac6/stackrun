// Short messages ("Copied…", "Removed 3 volumes", errors) at the bottom centre of the app
// window, the same place for every Dev Notes tool. The caller decides when it goes away.
import React, { useEffect, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';

export default function BottomToast({
  text,
  error = false,
  onClose,
}: {
  text: string | null;
  error?: boolean;
  onClose?: () => void;
}) {
  // keep the last text while it fades out
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (text) setShown(text);
  }, [text]);

  return (
    <Snackbar
      open={!!text}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      onClose={(_, reason) => {
        if (reason !== 'clickaway') onClose?.();
      }}
    >
      <Alert
        severity={error ? 'error' : 'success'}
        variant="filled"
        onClose={onClose}
        sx={{
          borderRadius: 3,
          boxShadow: 6,
          alignItems: 'center',
          py: 0.25,
          maxWidth: 560,
        }}
      >
        {shown}
      </Alert>
    </Snackbar>
  );
}
