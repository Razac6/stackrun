import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  FormControlLabel,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CheckIcon from '@mui/icons-material/Check';
import CodeArea from './CodeArea';
import { parseRequest, toHttpClient } from './httpConvert';
import useCopy from './useCopy';

// DevTools request ("Copy as cURL" bash/cmd, or "Copy as fetch") -> JetBrains HTTP Client
// request for a .http file in WebStorm. Browser-only headers can be dropped and JSON
// bodies pretty-printed; the result is editable, copyable and can be kept as a note.

export default function HttpConverter({
  onSaveAsNote,
}: {
  onSaveAsNote: (content: string, title: string) => void;
}) {
  const [input, setInput] = useState('');
  const [name, setName] = useState('');
  const [dropNoise, setDropNoise] = useState(true);
  const [prettyBody, setPrettyBody] = useState(true);
  const [edited, setEdited] = useState<string | null>(null);
  const { copy, copied } = useCopy();

  const result = useMemo(() => {
    if (!input.trim()) return { output: '', error: null as string | null };
    try {
      const req = parseRequest(input);
      return {
        output: toHttpClient(req, {
          name: name || undefined,
          dropNoise,
          prettyBody,
        }),
        error: null,
      };
    } catch (e: any) {
      return { output: '', error: String(e?.message || e) };
    }
  }, [input, name, dropNoise, prettyBody]);

  const output = edited ?? result.output;
  const resetEdits = () => setEdited(null);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: 2,
        height: '100%',
        minHeight: 0,
      }}
    >
      <Paper
        sx={{ p: 2, display: 'flex', flexDirection: 'column', minHeight: 360 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2">From the browser</Typography>
          <Button
            size="small"
            startIcon={<ContentPasteIcon fontSize="small" />}
            onClick={async () => {
              setInput(await navigator.clipboard.readText());
              resetEdits();
            }}
            sx={{ ml: 'auto' }}
          >
            Paste
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
          DevTools → Network → right-click a request → Copy →{' '}
          <b>Copy as cURL</b> (bash or cmd) or <b>Copy as fetch</b>.
        </Typography>
        <Box sx={{ flex: 1, minHeight: 200 }}>
          <CodeArea
            value={input}
            onChange={(v) => {
              setInput(v);
              resetEdits();
            }}
            language="plain"
            ariaLabel="cURL or fetch request"
            placeholder={
              "curl 'https://api.example.com/orders' \\\n  -H 'authorization: Bearer …' \\\n  --data-raw '{\"id\":1}'"
            }
          />
        </Box>
        {result.error && (
          <Typography variant="caption" color="error.main" sx={{ mt: 0.5 }}>
            {result.error}
          </Typography>
        )}
      </Paper>

      <Paper
        sx={{ p: 2, display: 'flex', flexDirection: 'column', minHeight: 360 }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 1,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="subtitle2">WebStorm HTTP Client</Typography>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
            <Button
              size="small"
              disabled={!output}
              startIcon={
                copied ? (
                  <CheckIcon fontSize="small" />
                ) : (
                  <ContentCopyIcon fontSize="small" />
                )
              }
              onClick={() => copy(output)}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              size="small"
              disabled={!output}
              onClick={() =>
                onSaveAsNote(
                  `\`\`\`http\n${output.trimEnd()}\n\`\`\`\n`,
                  name ||
                    output.split('\n')[0].replace(/^###\s*/, '') ||
                    'HTTP request',
                )
              }
            >
              Save as note
            </Button>
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            gap: 2,
            alignItems: 'center',
            flexWrap: 'wrap',
            mb: 1,
          }}
        >
          <TextField
            size="small"
            label="Request name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              resetEdits();
            }}
            sx={{ flex: '1 1 160px' }}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={dropNoise}
                onChange={(e) => {
                  setDropNoise(e.target.checked);
                  resetEdits();
                }}
              />
            }
            label={
              <Typography variant="body2">Drop browser headers</Typography>
            }
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={prettyBody}
                onChange={(e) => {
                  setPrettyBody(e.target.checked);
                  resetEdits();
                }}
              />
            }
            label={<Typography variant="body2">Format JSON body</Typography>}
          />
        </Box>
        <Box sx={{ flex: 1, minHeight: 200 }}>
          <CodeArea
            value={output}
            onChange={setEdited}
            language="http"
            ariaLabel="HTTP Client request"
          />
        </Box>
      </Paper>
    </Box>
  );
}
